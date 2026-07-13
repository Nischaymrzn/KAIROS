/**
 * ANIMATION CONTROLLER — owns a rig's motion.
 *
 * Idle and state changes blend toward a target pose. A shot instead SAMPLES its
 * keyframe timeline, so phase timing is exact and the release lands on the frame
 * the ball expects rather than wherever a damped follow happened to arrive.
 *
 * The chain is sampled proximal to distal: legs read the timeline first, then
 * spine, shoulder, elbow, wrist, each a fraction of `chainSpread` behind. That
 * lag is what makes the motion read as one coordinated action instead of a jump
 * followed by an arm swing. Sampling is done once per tier (5 evaluations), not
 * once per bone.
 */
import * as THREE from "three";
import { PlayerRig, BoneName } from "../rig/buildRig";
import { POSES, PoseName, Pose } from "./poses";
import { shotSequence, adaptShot, ShotSequence } from "./sequences";

const POSE_BLEND_SPEED = 6;
/** Slower blend for the first moment after a shot, so the follow-through is HELD
 *  rather than snapping back to idle. Real shooters hold the gooseneck; letting
 *  the arm fall at the same rate it rose is the single clearest tell that a
 *  finish was interpolated rather than acted. */
const FOLLOW_BLEND_SPEED = 1.9;
const FOLLOW_HOLD_S = 0.75;

/** Landing impact: the body compresses on contact and springs back out. A jump
 *  that ends by pinning the root to y=0 reads as the player being switched off
 *  at the moment of touchdown.
 *
 *  The give is expressed as KNEE AND HIP FLEXION, not as a root dip. This rig is
 *  pure FK with no foot solver, so root y = 0 is what puts the soles on the
 *  floor; lowering the root to fake a crouch drives the feet through it, which is
 *  precisely what animcheck's grounded assertion exists to catch. Bending the
 *  joints that actually absorb a landing is both anatomically right and keeps the
 *  contact invariant intact. */
const LAND_HIP_RAD = 0.20;
const LAND_KNEE_RAD = 0.34;
const LAND_SETTLE_S = 0.46;
/** Jump height, in feet, that earns the full absorb. Below this the give scales
 *  down: a free throw leaves the floor by about four inches and does not need a
 *  dunk's landing. Scaling it is also what keeps the absorb from contaminating
 *  the pose a fraction of a second after release on the low-lift verbs. */
const LAND_REF_LIFT_FT = 1.4;
/** How quickly the shooter walks back to the shot spot after landing. */
const RESET_SPEED = 2.4;

/** How much of the torso's twist the neck cancels so the eyes stay on the rim.
 *  Not the whole of it — a hook turns the shoulders past what a neck can undo,
 *  and forcing it to zero would snap the head straight in a way a person cannot. */
const GAZE_RECOVERY = 0.72;
const GAZE_LIMIT = 1.15; // radians, about 66 degrees off the chest

/** Position along the kinematic chain, 0 = proximal. */
const TIERS: [number, BoneName[]][] = [
  [0.0, ["Hips", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot"]],
  [0.3, ["Spine", "Spine1", "Spine2"]],
  [0.6, ["Neck", "Head", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm"]],
  [0.85, ["LeftForeArm", "RightForeArm"]],
  [1.0, ["LeftHand", "RightHand"]],
];

const LEG_BONES = new Set<BoneName>(["LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"]);
const BONE_NAMES: BoneName[] = TIERS.flatMap(([, b]) => b);
const ZERO: [number, number, number] = [0, 0, 0];

const _euler = new THREE.Euler();
const _q = new THREE.Quaternion();
const _rot: [number, number, number] = [0, 0, 0];

export class AnimationController {
  private rig: PlayerRig;
  private target: Pose = POSES.idle;
  private current = new Map<BoneName, [number, number, number]>();
  private jumpState: { start: number; dur: number; height: number } | null = null;
  private shot: { seq: ShotSequence; start: number; load: number } | null = null;

  private basePose: Pose = POSES.idle;

  /** Airborne translation, in the rig's LOCAL frame: +z is toward the rim (the
   *  rig is built facing +z and yawed at the target), +x is the shooter's right.
   *  Player reads this every frame and adds it to the court position, so React
   *  owning the base spot and the controller owning the motion never fight. */
  readonly travel = { x: 0, z: 0 };
  /** Extra downward give on touchdown, decaying. Feet stay on the floor. */
  private landing: { start: number; force: number } | null = null;
  /** Seconds since the shot timeline ended, for the follow-through hold. */
  private sinceShot = Infinity;
  /** Current strength of the landing absorb, 0 when standing. */
  private landAmount = 0;

  constructor(rig: PlayerRig, initial: PoseName = "idle") {
    this.rig = rig;
    this.target = POSES[initial];
    for (const [name, rot] of Object.entries(this.target) as [BoneName, [number, number, number]][]) {
      this.current.set(name, [...rot]);
    }
  }

  setPose(name: PoseName) {
    this.basePose = POSES[name];
    if (!this.shot) this.target = this.basePose;
  }

  jump(height: number, dur = 0.9) {
    this.jumpState = { start: -1, dur, height };
  }

  /**
   * Play a shot's timeline. `distFt` adapts the motion the way the kinematics
   * literature describes: deeper leg flexion and a slightly bigger jump as the
   * shot gets longer. The jump apex is timed to land on releaseAt.
   */
  playShot(verb: string, jumpScale = 1, distFt = 18) {
    const seq = shotSequence(verb);
    const adapt = adaptShot(seq, distFt);
    this.shot = { seq, start: -1, load: adapt.load };
    this.travel.x = 0;
    this.travel.z = 0;
    this.landing = null;
    this.sinceShot = 0;
    const dur = Math.max(2 * (seq.releaseAt - seq.liftAt), 0.3);
    this.jumpState = {
      start: -2 - seq.liftAt,
      dur,
      height: seq.jumpHeight * jumpScale * adapt.lift,
    };
  }

  /** Release angle this shot wants, degrees. ShotArc reads it for the arc. */
  releaseAngle(verb: string, distFt: number): number {
    return adaptShot(shotSequence(verb), distFt).releaseDeg;
  }

  /**
   * Interpolated pose at time `t`, Catmull-Rom across the surrounding keyframes.
   *
   * A spline rather than per-segment easing because easing curves are only C0 at
   * the joins: an ease-out decelerates to zero and the next segment restarts at
   * speed, which shows up as a visible hitch on fast joints. Catmull-Rom derives
   * its tangents from the neighbouring keys, so velocity carries through the
   * boundary. Rhythm is controlled by keyframe SPACING, the way it is authored
   * in any keyframe tool.
   */
  private sample(seq: ShotSequence, t: number, out: Pose): Pose {
    const f = seq.frames;
    let i = 0;
    while (i + 1 < f.length && f[i + 1].at <= t) i++;
    if (i + 1 >= f.length) return POSES[f[f.length - 1].pose as PoseName];

    const span = f[i + 1].at - f[i].at;
    const k = span > 0 ? Math.min(Math.max((t - f[i].at) / span, 0), 1) : 1;
    const p0 = POSES[f[Math.max(i - 1, 0)].pose as PoseName];
    const p1 = POSES[f[i].pose as PoseName];
    const p2 = POSES[f[i + 1].pose as PoseName];
    const p3 = POSES[f[Math.min(i + 2, f.length - 1)].pose as PoseName];
    const k2 = k * k;
    const k3 = k2 * k;

    // A pose omitting a bone means REST, not "hold the previous value". All four
    // keys must default the same way or the bone pops when it reappears.
    for (const name of BONE_NAMES) {
      if (!p1[name] && !p2[name] && !p0[name] && !p3[name]) continue;
      const a = p0[name] ?? ZERO;
      const b = p1[name] ?? ZERO;
      const c = p2[name] ?? ZERO;
      const d = p3[name] ?? ZERO;
      const v = out[name] ?? (out[name] = [0, 0, 0]);
      for (let j = 0; j < 3; j++) {
        v[j] = 0.5 * (
          2 * b[j] +
          (c[j] - a[j]) * k +
          (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * k2 +
          (3 * b[j] - a[j] - 3 * c[j] + d[j]) * k3
        );
      }
    }
    return out;
  }

  private write(name: BoneName, rot: [number, number, number]) {
    const b = this.rig.bones[name];
    if (!b) return;
    const rest = this.rig.restQuat?.[name];
    if (rest) {
      _q.setFromEuler(_euler.set(rot[0], rot[1], rot[2]));
      b.quaternion.copy(rest).multiply(_q);
    } else {
      b.rotation.set(rot[0], rot[1], rot[2]);
    }
  }

  update(time: number, dt: number) {
    this.sinceShot += dt;

    if (this.jumpState) {
      if (this.jumpState.start < -1) {
        this.jumpState.start = time + (-this.jumpState.start - 2);
      }
      const f = (time - this.jumpState.start) / this.jumpState.dur;
      if (f >= 1) {
        // read the height BEFORE clearing the jump: the absorb is scaled by how
        // far the body actually fell
        const fell = this.jumpState.height;
        this.jumpState = null;
        this.rig.root.position.y = 0;
        // touchdown: start the absorb rather than stopping dead on the floor
        this.landing = {
          start: time,
          // impact scales with the drop, capped so a dunk does not fold the player
          force: Math.min(fell / LAND_REF_LIFT_FT, 1.25),
        };
      } else if (f >= 0) {
        // A parabola is the correct physics AND the contract animcheck asserts:
        // the apex has to land exactly on releaseAt, which 4h.f(1-f) gives at
        // f = 0.5. The sense of hang comes from the knees tucking at the top,
        // which is in the poses, not from bending the flight path.
        this.rig.root.position.y = 4 * this.jumpState.height * f * (1 - f);

        // Airborne translation. Feet only leave the floor once, so this is the
        // only window in which the body may move without the feet sliding.
        const tr = this.shot?.seq.travel;
        if (tr) {
          // ease-out: most of the ground is covered early, the way real
          // horizontal momentum decays against nothing but air
          const e = 1 - (1 - f) * (1 - f);
          this.travel.z = -tr.back * e;   // +z is toward the rim
          this.travel.x = tr.side * e;
        }
      }
    }

    // Once down, the shooter re-sets to the spot the scenario says the shot was
    // taken from. Without this the travel is permanent: a step-back would leave
    // the player two and a half feet behind the shot marker, and firing five in a
    // row would walk him off the court. Decayed rather than snapped, so it reads
    // as gathering himself rather than sliding home.
    if (!this.jumpState && (this.travel.x !== 0 || this.travel.z !== 0)) {
      const back = Math.min(dt * RESET_SPEED, 1);
      this.travel.x += (0 - this.travel.x) * back;
      this.travel.z += (0 - this.travel.z) * back;
      if (Math.abs(this.travel.x) < 1e-3) this.travel.x = 0;
      if (Math.abs(this.travel.z) < 1e-3) this.travel.z = 0;
    }

    // Landing absorb, as a decaying flexion the legs carry. One compression and a
    // small rebound, rather than a linear ramp that arrives instead of settling.
    this.landAmount = 0;
    if (this.landing) {
      const e = (time - this.landing.start) / LAND_SETTLE_S;
      if (e >= 1) {
        this.landing = null;
      } else {
        this.landAmount =
          this.landing.force * Math.exp(-4.0 * e) * Math.sin(Math.PI * e * 1.55);
      }
    }

    if (this.shot) {
      if (this.shot.start < 0) this.shot.start = time;
      const t = time - this.shot.start;
      if (t >= this.shot.seq.duration) {
        this.shot = null;
        this.target = this.basePose;
      } else {
        const { seq, load } = this.shot;
        const buf: Pose = {};
        for (const [tier, bones] of TIERS) {
          const sampled = this.sample(seq, t - tier * seq.mech.chainSpread, buf);
          for (const name of bones) {
            const r = sampled[name];
            if (!r) continue;
            _rot[0] = LEG_BONES.has(name) ? r[0] * load : r[0];
            _rot[1] = r[1];
            _rot[2] = r[2];
            this.current.set(name, [_rot[0], _rot[1], _rot[2]]);
            this.write(name, _rot);
          }
        }
        // during the shot is exactly when the torso twists furthest
        this.absorb();
        this.gaze();
        return;
      }
    }

    // The finish is held. Blending out of a follow-through at the same rate the
    // arm came up drops it like a dead limb; a shooter keeps the hand in the rim
    // for a beat. Only the moment right after a shot is slowed.
    const speed = this.sinceShot < FOLLOW_HOLD_S ? FOLLOW_BLEND_SPEED : POSE_BLEND_SPEED;
    const k = Math.min(dt * speed, 1);

    // Idle life, folded into the pose values BEFORE they are written.
    //
    // These used to be applied afterwards as `bone.rotation.x += ...`, which is a
    // real bug and not only a style point: `write()` composes onto a rest
    // quaternion for GLB characters, and assigning `.rotation` afterwards
    // recomputes the quaternion from Euler alone and discards that rest pose. The
    // procedural rig has no rest quaternions so it never showed, but any imported
    // character would have collapsed toward its T-pose whenever it stood still.
    const breathe = Math.sin(time * 1.7) * 0.012;
    const sway = Math.sin(time * 0.45) * 0.02;
    const look = Math.sin(time * 0.23) * 0.06;
    const OVERLAY: Partial<Record<BoneName, [number, number, number]>> = {
      Spine1: [breathe, 0, 0],
      Spine2: [breathe * 0.6, 0, 0],
      Hips: [0, 0, sway * 0.4],
      Spine: [0, 0, -sway * 0.55],
      Neck: [0, look, 0],
      LeftArm: [0, 0, sway * 0.35 + breathe * 0.5],
      RightArm: [0, 0, -(sway * 0.35 + breathe * 0.5)],
    };

    const names = new Set<BoneName>([
      ...(Object.keys(this.target) as BoneName[]),
      ...this.current.keys(),
    ]);
    for (const name of names) {
      const goal = this.target[name] ?? [0, 0, 0];
      const cur = this.current.get(name) ?? [0, 0, 0];
      cur[0] += (goal[0] - cur[0]) * k;
      cur[1] += (goal[1] - cur[1]) * k;
      cur[2] += (goal[2] - cur[2]) * k;
      this.current.set(name, cur);

      const ov = OVERLAY[name];
      if (ov) {
        _rot[0] = cur[0] + ov[0];
        _rot[1] = cur[1] + ov[1];
        _rot[2] = cur[2] + ov[2];
        this.write(name, _rot);
      } else {
        this.write(name, cur);
      }
    }

    this.gaze();
  }

  /**
   * Keep the eyes on the rim.
   *
   * The rig is yawed so the rim lies straight ahead, which means the gaze target
   * is a fixed direction and the only thing taking the head off it is the
   * shooter's own torso twist. A hook turns the chest most of the way to the
   * sideline and, before this, the head went with it — the player finished a hook
   * looking at the crowd. Cancelling most of the accumulated yaw at the neck puts
   * the eyes back on the target without pinning the head rigidly forward.
   */
  /**
   * Fold the landing absorb into the leg chain. Called after the bones are
   * written, so it rides on top of whatever pose is current rather than fighting
   * the timeline for ownership of the legs.
   */
  private absorb() {
    if (this.landAmount <= 0) return;
    const b = this.rig.bones;
    const hip = -LAND_HIP_RAD * this.landAmount;
    const knee = LAND_KNEE_RAD * this.landAmount;
    for (const side of ["Left", "Right"] as const) {
      const up = b[`${side}UpLeg` as BoneName];
      const lo = b[`${side}Leg` as BoneName];
      const ft = b[`${side}Foot` as BoneName];
      if (up) up.rotation.x += hip;
      if (lo) lo.rotation.x += knee;
      // ankle takes the remainder so the shin does not drive the toe into the floor
      if (ft) ft.rotation.x -= knee * 0.55;
    }
    if (b.Spine) b.Spine.rotation.x += 0.12 * this.landAmount;
  }

  private gaze() {
    const b = this.rig.bones;
    if (!b.Neck) return;
    // The RESIDUAL, not the torso twist. Several poses already turn the head back
    // by hand — the hook authors Neck at -0.5 against a chest turned +0.85 — so
    // correcting the torso alone would count that work twice and crank the head
    // past the shoulder. Summing the whole chain, head included, leaves only what
    // is still off the target.
    const residual =
      (b.Hips?.rotation.y ?? 0) +
      (b.Spine?.rotation.y ?? 0) +
      (b.Spine1?.rotation.y ?? 0) +
      (b.Spine2?.rotation.y ?? 0) +
      (b.Neck?.rotation.y ?? 0) +
      (b.Head?.rotation.y ?? 0);
    if (Math.abs(residual) < 1e-4) return;
    const correct = Math.max(-GAZE_LIMIT, Math.min(GAZE_LIMIT, -residual * GAZE_RECOVERY));
    // split across neck and head so neither joint carries an impossible angle
    b.Neck.rotation.y += correct * 0.6;
    if (b.Head) b.Head.rotation.y += correct * 0.4;
  }
}
