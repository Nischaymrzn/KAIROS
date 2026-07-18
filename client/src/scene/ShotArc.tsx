/**
 * SHOT ARC v2 — trajectory preview + the LIVE ball flight with real outcomes:
 *   • the preview line comes from physics/ballistics for the current shooter
 *   • on SHOOT the ball flies a TIMED path: jumpers ride the solved arc; angled
 *     layups fly release → glass aim point → rim (the bank actually banks);
 *     dunks are carried and slammed
 *   • the ENDING is sampled from the model's own make probability: makes drop
 *     through the net, misses catch the rim and rattle out with a bounce
 * One module (physics/ballistics) supplies every number — the drawn line, the
 * flight, and the Physics Lab's readouts can never disagree.
 */
import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import * as D from "../constants/dimensions";
import { useShotStore } from "../state/shotStore";
import { usePhysicsStore } from "../state/physicsStore";
import { usePlayersStore } from "../state/playersStore";
import {
  solveArc, minSpeedAngleDeg, releaseHeight, measureFromProfile, arcPoints, bankAimPoint,
} from "../physics/ballistics";
import { shotSequence, sequenceKeyFor } from "../player/animation/sequences";
import { Basketball, BALL_RADIUS } from "./Basketball";
import { focusTracker } from "./focusTracker";
import { handTracker, ballHold } from "./handTracker";
import { netImpact } from "./netImpact";
import { madeFor } from "../game/outcome";

const RIM: [number, number, number] = [D.basketX(-1), 10, 0];
const _hold = new THREE.Vector3();
const _travel = new THREE.Vector3();
const _spin = new THREE.Vector3();

interface FlightPoint { p: [number, number, number]; t: number }

/** deterministic per-shot rand so replays of the same signal agree */
function seededRand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** timed make ending: drop through the net */
function makeEnding(t0: number): FlightPoint[] {
  return [
    { p: [RIM[0], 9.4, 0], t: t0 + 0.1 },
    { p: [RIM[0], 7.4, 0], t: t0 + 0.32 },
  ];
}

/** timed miss ending — three real miss types, seeded per shot:
 *  rim-out (side rattle), back-iron (long bounce back at the shooter),
 *  and off-glass brick (catches the board, drops in front of the rim). */
function missEnding(t0: number, seed: number): FlightPoint[] {
  const kind = seededRand(seed * 3.7);
  if (kind < 0.45) {
    // rim-out: pop off the lip sideways
    const a = seededRand(seed) * Math.PI * 2;
    const dx = Math.cos(a) * 2.6;
    const dz = Math.sin(a) * 2.2;
    return [
      { p: [RIM[0] + dx * 0.25, 10.9, dz * 0.25], t: t0 + 0.14 },
      { p: [RIM[0] + dx * 0.7, 10.1, dz * 0.7], t: t0 + 0.34 },
      { p: [RIM[0] + dx, 6.0, dz], t: t0 + 0.62 },
      { p: [RIM[0] + dx * 1.25, 0.6, dz * 1.25], t: t0 + 0.95 },
    ];
  }
  if (kind < 0.75) {
    // back-iron: hits the front lip square, bounces long toward the floor line
    const dz = (seededRand(seed * 1.9) - 0.5) * 1.6;
    return [
      { p: [RIM[0] + 0.4, 11.2, dz * 0.3], t: t0 + 0.12 },
      { p: [RIM[0] + 4.5, 9.6, dz], t: t0 + 0.4 },
      { p: [RIM[0] + 9, 4.2, dz * 1.6], t: t0 + 0.75 },
      { p: [RIM[0] + 12, 0.6, dz * 2], t: t0 + 1.0 },
    ];
  }
  // brick off the glass: catches the board above the square, drops short
  const dz = (seededRand(seed * 2.3) - 0.5) * 2.4;
  return [
    { p: [RIM[0] - 0.7, 11.6, dz * 0.4], t: t0 + 0.12 }, // board contact
    { p: [RIM[0] + 1.2, 10.2, dz * 0.7], t: t0 + 0.3 },
    { p: [RIM[0] + 2.4, 5.5, dz], t: t0 + 0.58 },
    { p: [RIM[0] + 3.2, 0.6, dz * 1.3], t: t0 + 0.85 },
  ];
}

interface Props {
  /** always show the arc line (physics mode); otherwise only during ball flight */
  persistent: boolean;
}

export function ShotArc({ persistent }: Props) {
  const x = useShotStore((s) => s.scenario.x);
  const z = useShotStore((s) => s.scenario.z);
  const verb = useShotStore((s) => s.scenario.shotType);
  const shootSignal = useShotStore((s) => s.shootSignal);
  const launchOverride = usePhysicsStore((s) => s.launchDeg);
  const active = usePlayersStore((s) => s.active);

  const ballRef = useRef<THREE.Group>(null);
  const flight = useRef<{
    pts: FlightPoint[];
    start: number;
    total: number;
    release: number;
    /** Where the ball actually was in the hand at the instant of release, minus
     *  where the solved arc begins. Applied to the flight and faded out, so the
     *  ball leaves the hand it was in rather than teleporting to a computed
     *  launch point. */
    handoff: THREE.Vector3;
    handoffFor: number;
  } | null>(null);
  const prevY = useRef(99);

  // solve the preview arc for the current spot/shooter/angle
  const solved = useMemo(() => {
    const dist = Math.hypot(RIM[0] - x, RIM[2] - z);
    if (dist < 1.5 || verb === "dunk") return null; // at the rim / carried to it
    const m = measureFromProfile(active?.profile);
    const h0 = releaseHeight(m, verb);
    const deg = launchOverride ?? minSpeedAngleDeg(dist, h0) + 4;
    const sol = solveArc(dist, h0, deg);
    if (!sol) return null;
    return { sol, h0, pts: arcPoints({ x, z }, h0, sol), dist };
  }, [x, z, verb, launchOverride, active]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (solved) g.setFromPoints(solved.pts.map((p) => new THREE.Vector3(...p)));
    return g;
  }, [solved]);

  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#4c6ef5", transparent: true, opacity: 0 }),
    []
  );

  // bank aim preview for angled layups
  const bank = useMemo(() => {
    if (verb !== "driving_layup" || Math.abs(z) < 1.5) return null;
    const m = measureFromProfile(active?.profile);
    return bankAimPoint({ x, z }, releaseHeight(m, verb));
  }, [x, z, verb, active]);

  // ---- build the timed flight when the user shoots ----
  // Timeline contract: the sequence's releaseAt (player/animation/sequences.ts)
  // is second 0 of the BALLISTIC part. Before it, the ball is CARRIED — chest
  // height in the gather, rising with the body to the release point — exactly
  // while the rig plays gather→rise. One clock, animation and physics agree.
  useEffect(() => {
    if (shootSignal === 0) return;
    const prob = useShotStore.getState().prediction?.probability ?? 0.45;
    // one definition, shared with the game layer, so the scoreboard can never
    // credit a make the user just watched rattle out
    const made = madeFor(shootSignal, prob);
    const m = measureFromProfile(active?.profile);
    const h0 = releaseHeight(m, verb);
    // the SAME key the shooter's animation uses — ball and body can't disagree
    const key = sequenceKeyFor(verb, x, z);
    const seq = shotSequence(key);
    const R = seq.releaseAt;
    const pts: FlightPoint[] = [];

    // WHERE THE BALL ACTUALLY LEAVES THE HAND.
    //
    // The shooter now travels through the air, so the release point is not the
    // court spot any more: a step-back is released about two feet further out
    // than the marker, a drive a good deal nearer the rim. The carry already
    // follows the hands, so without this the ball would sit correctly in the
    // hand and then jump back to the spot the instant it was released.
    //
    // The jump apex is timed to the release and the travel easing is
    // 1-(1-f)^2, so at f = 0.5 the shooter has covered three quarters of it.
    const [relX, relZ] = (() => {
      const tr = seq.travel;
      if (!tr) return [x, z];
      const dx = RIM[0] - x;
      const dz = RIM[2] - z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;                 // unit vector toward the rim
      const at = 0.75;                     // travel covered by the release
      const fwd = -tr.back * at;           // +z local is toward the rim
      const side = tr.side * at;
      return [x + ux * fwd + uz * side, z + uz * fwd - ux * side];
    })();

    // the ballistic solution is re-solved from the real release point, so a
    // step-back genuinely is the longer shot it looks like
    const flightSolved = (() => {
      const d = Math.hypot(RIM[0] - relX, RIM[2] - relZ);
      if (d < 1.5 || verb === "dunk") return null;
      const deg = launchOverride ?? minSpeedAngleDeg(d, h0) + 4;
      const s = solveArc(d, h0, deg);
      if (!s) return null;
      return { sol: s, pts: arcPoints({ x: relX, z: relZ }, h0, s) };
    })();

    // carry: ball held at the chest, travelling up as the shooter rises
    const carryTo = (releaseP: [number, number, number]) => {
      pts.push({ p: [x, h0 * 0.5, z], t: 0 });
      pts.push({ p: [relX, h0 * 0.72, relZ], t: R * 0.55 });
      pts.push({ p: releaseP, t: R });
    };

    if (key === "reverse_layup") {
      // baseline drive: carry UNDER the rim and scoop up over the FAR side lip
      const farZ = -Math.sign(z || 1) * 1.05;
      pts.push({ p: [x, h0 * 0.5, z], t: 0 });
      pts.push({ p: [x, h0 * 0.75, z], t: R * 0.6 });
      pts.push({ p: [RIM[0] - 0.4, 9.2, z * 0.35], t: R }); // beneath the rim plane
      pts.push({ p: [RIM[0] - 0.6, 10.9, farZ], t: R + 0.22 }); // up over the far lip
      pts.push({ p: [RIM[0], 10.3, farZ * 0.3], t: R + 0.38 });
      if (made) pts.push(...makeEnding(R + 0.38));
      else pts.push(...missEnding(R + 0.38, shootSignal));
    } else if (verb === "dunk" || Math.hypot(RIM[0] - x, RIM[2] - z) < 2.5) {
      // carried to the rim and slammed — dunks convert at the model's dunk rate,
      // which is high; still sampled so the rare miss (rim-clang) exists
      const t1 = R + 0.45;
      carryTo([relX, h0 * 0.92, relZ]);
      pts.push({ p: [(relX + RIM[0]) / 2, Math.max(h0, 10.9), (relZ + RIM[2]) / 2], t: R + 0.25 });
      pts.push({ p: [RIM[0], 10.6, 0], t: t1 });
      if (made) pts.push(...makeEnding(t1));
      else pts.push(...missEnding(t1, shootSignal));
    } else if (bank && flightSolved) {
      // BANK: rise to the glass aim point, then off the glass into (or out of)
      // the rim — the impact point is the mirror-construction dot
      const T = flightSolved.sol.flightTime;
      const apexY = Math.max(bank.y + 1.2, h0 + 2);
      carryTo([relX, h0, relZ]);
      pts.push({
        p: [relX + (bank.x - relX) * 0.55, apexY, relZ + (bank.z - relZ) * 0.55],
        t: R + T * 0.5,
      });
      pts.push({ p: [bank.x, bank.y, bank.z], t: R + T * 0.78 }); // glass contact
      pts.push({ p: [RIM[0], 10.15, 0], t: R + T }); // off the glass to the rim
      if (made) pts.push(...makeEnding(R + T));
      else pts.push(...missEnding(R + T, shootSignal));
    } else if (flightSolved) {
      // jumper family: ride the solved arc in real flight time
      const T = flightSolved.sol.flightTime;
      carryTo(flightSolved.pts[0]);
      flightSolved.pts.forEach((p, i) => {
        if (i > 0) pts.push({ p, t: R + (i / (flightSolved.pts.length - 1)) * T });
      });
      if (made) pts.push(...makeEnding(R + T));
      else pts.push(...missEnding(R + T, shootSignal));
    }

    if (pts.length > 1) {
      flight.current = {
        pts,
        start: performance.now() / 1000,
        total: pts[pts.length - 1].t,
        release: R,
        handoff: new THREE.Vector3(),
        handoffFor: 0,
      };
      focusTracker.shotFrame = { x, z }; // shot cam frames shooter + rim
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shootSignal]);

  useFrame(() => {
    const flying = flight.current !== null;
    const target = persistent ? 0.85 : flying ? 0.55 : 0;
    lineMat.opacity += (target - lineMat.opacity) * 0.12;

    const ball = ballRef.current;
    if (!ball) return;

    const f = flight.current;
    if (!f) {
      ball.visible = true;
      if (handTracker.live) {
        // At rest the ball sits in the shooting hand, exactly where the release
        // will pick it up, so there is no jump on the first frame of flight.
        ballHold(BALL_RADIUS, 1, ball.position);
        ball.quaternion.slerp(handTracker.rightQ, 0.35);
      } else if (solved) {
        const [px, py, pz] = solved.pts[0];
        ball.position.set(px, py, pz);
      } else {
        ball.visible = false;     // no shooter and no solution: nothing to hold
      }
      return;
    }
    const now = performance.now() / 1000 - f.start;
    if (now >= f.total + 0.25) {
      flight.current = null;
      // back to the hands on the next frame, via the branch above
      ball.visible = true;
      focusTracker.active = false;
      focusTracker.shotFrame = null;
      return;
    }
    ball.visible = true;
    const t = Math.min(now, f.total);
    // before release the ball is HELD: seated between the hands, pushed out from
    // the chest by its radius so the palms meet its surface. The anchor slides
    // onto the shooting hand as the release approaches (guide hand coming off).
    if (t < f.release && handTracker.live) {
      // Held: the ball rides in the shooting hand, seated on the fingers.
      ballHold(BALL_RADIUS, t / Math.max(f.release, 1e-3), ball.position);
      // A held ball turns WITH the hand. It used to spin inside it, which is the
      // one thing a ball in a hand certainly does not do.
      ball.quaternion.slerp(handTracker.rightQ, 0.35);
      focusTracker.active = true;
      focusTracker.pos.copy(ball.position);
      return;
    }

    let i = 0;
    while (i < f.pts.length - 2 && f.pts[i + 1].t <= t) i++;
    const a = f.pts[i];
    const b = f.pts[i + 1];
    const span = Math.max(b.t - a.t, 1e-4);
    const k = Math.min(Math.max((t - a.t) / span, 0), 1);
    ball.position.set(
      a.p[0] + (b.p[0] - a.p[0]) * k,
      Math.max(a.p[1] + (b.p[1] - a.p[1]) * k, 0.4),
      a.p[2] + (b.p[2] - a.p[2]) * k
    );

    // THE HANDOFF.
    //
    // Up to this instant the ball was wherever the shooting hand was; from here
    // it follows a trajectory solved from the court spot and a modelled release
    // height. Those two points are close but never identical, so the ball used to
    // jump out of the hand at the exact moment the eye is on it.
    //
    // On the first frame after release, measure the gap and carry it. It is faded
    // out over the early flight, so the ball leaves the hand it was actually in
    // and still arrives at the rim the physics says it should.
    if (f.handoffFor !== f.release && handTracker.live) {
      f.handoffFor = f.release;
      ballHold(BALL_RADIUS, 1, _hold);
      f.handoff.copy(_hold).sub(ball.position);
      // A big gap means the hand and the solved release disagree about where the
      // shot is taken from, which is a bug rather than something to paper over.
      if (f.handoff.length() > 2.5) f.handoff.set(0, 0, 0);
    }
    if (f.handoff.lengthSq() > 1e-8) {
      const since = t - f.release;
      const fade = Math.max(0, 1 - since / 0.22);
      ball.position.addScaledVector(f.handoff, fade * fade);
    }
    // net reacts the frame the ball crosses the rim plane inside the ring
    if (ball.position.y <= D.RIM_HEIGHT && prevY.current > D.RIM_HEIGHT) {
      const dx = ball.position.x - RIM[0];
      const dz = ball.position.z - RIM[2];
      if (dx * dx + dz * dz < D.RIM_RADIUS * D.RIM_RADIUS) netImpact.pending = true;
    }
    prevY.current = ball.position.y;

    // BACKSPIN, about the right axis.
    //
    // This was a fixed rotation about the world X axis, so a shot from the corner
    // spun sideways and a shot from the wing spun at an angle to its own flight.
    // Backspin is rotation about the horizontal axis ACROSS the direction of
    // travel, which is the cross product of up and the travel direction, and the
    // rate scales with how fast the ball is going.
    _travel.set(b.p[0] - a.p[0], 0, b.p[2] - a.p[2]);
    if (_travel.lengthSq() > 1e-8) {
      _spin.set(0, 1, 0).cross(_travel).normalize();
      const speed = _travel.length() / span;
      ball.rotateOnWorldAxis(_spin, -Math.min(speed * 0.055, 0.5));
    }
    // cinematic: the camera target rides the ball
    focusTracker.active = true;
    focusTracker.pos.copy(ball.position);
  });

  return (
    <group>
      {/* @ts-expect-error three's Line vs SVG Line typing clash in r3f */}
      <line geometry={geometry} material={lineMat} />
      <Basketball ref={ballRef} visible={false} />
      {bank && (
        <mesh position={[bank.x + 0.06, bank.y, bank.z]} rotation={[0, Math.PI / 2, 0]}>
          <circleGeometry args={[0.22, 24]} />
          <meshBasicMaterial
            color={bank.onSquare ? "#35c26e" : "#e2a33b"}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
