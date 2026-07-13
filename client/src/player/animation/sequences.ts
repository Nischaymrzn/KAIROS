/**
 * SHOT SEQUENCES — one keyframe timeline per shot verb.
 *
 * A sequence is plain data: keyframes (pose + time), the lift/release contract,
 * and a mechanics block describing how the motion changes with shooting distance.
 *
 * Motion between keyframes is a Catmull-Rom spline, so rhythm is controlled by
 * how the keys are SPACED rather than by per-segment easing.
 *
 * `releaseAt` is the sync contract shared by three systems: the controller times
 * the jump so its apex lands there, and ShotArc launches the ball at the same
 * instant. Times are seconds from the trigger.
 *
 * Distance adaptation follows the kinematics literature: as shooting distance
 * grows, players use greater hip and knee flexion in the preparatory phase and
 * a lower elbow at set, and release angle falls slightly beyond the arc.
 */
import { PoseName } from "./poses";

export interface ShotFrame {
  pose: PoseName;
  at: number;
}

export interface ShotMechanics {
  /** extra leg flexion per foot of distance beyond the reference */
  loadGain: number;
  /** extra jump height per foot beyond the reference */
  liftGain: number;
  /** reference distance where the base numbers apply, feet */
  refDist: number;
  /** release angle at the reference distance, degrees */
  releaseDeg: number;
  /** how far release angle falls per foot beyond the reference */
  releaseFalloff: number;
  /** proximal-to-distal spread, seconds between hips and wrist firing */
  chainSpread: number;
}

/**
 * How far the shooter TRAVELS through the air, in feet.
 *
 * The single biggest thing missing from the motion before this: a step-back that
 * does not step back is just a jump shot with a strange arm path, and a driving
 * layup that stays on the spot is a standing layup. Every verb here has a
 * signature translation and none of it was happening.
 *
 * `back` is measured away from the rim, so a drive is negative. `side` is to the
 * shooter's right. Travel is applied ONLY between lift-off and landing: while a
 * foot is on the floor the body cannot translate without the feet sliding, which
 * is the most recognisable tell of a bad animation.
 */
export interface ShotTravel {
  /** feet away from the rim over the flight; negative drives toward it */
  back: number;
  /** feet to the shooter's right over the flight */
  side: number;
}

export interface ShotSequence {
  frames: ShotFrame[];
  releaseAt: number;
  liftAt: number;
  jumpHeight: number;
  duration: number;
  mech: ShotMechanics;
  /** airborne translation; omitted means the shooter goes straight up */
  travel?: ShotTravel;
}

const JUMPER_MECH: ShotMechanics = {
  loadGain: 0.014,
  liftGain: 0.022,
  refDist: 18,
  releaseDeg: 51,
  releaseFalloff: 0.16,
  chainSpread: 0.075,
};

export const SHOT_SEQUENCES: Record<string, ShotSequence> = {
  /** One-motion catch and shoot: hands ready before the catch, shallow dip, the
   *  legs and the ball rise together with no pause at the set point. */
  catch_shoot: {
    frames: [
      { pose: "ready", at: 0 },
      { pose: "dip", at: 0.16 },
      { pose: "rise", at: 0.32 },
      { pose: "shoot", at: 0.5 },
      { pose: "follow", at: 0.62 },
      { pose: "land", at: 0.86 },
      { pose: "idle", at: 1.2 },
    ],
    liftAt: 0.28,
    releaseAt: 0.5,
    jumpHeight: 1.15,
    duration: 1.35,
    mech: JUMPER_MECH,
    travel: { back: 0.25, side: 0 },
  },

  /** Two-motion pull-up: the dribble is gathered into a deeper load, there is a
   *  distinct set point, then the rise. Slower and lower than a catch. */
  pullup: {
    frames: [
      { pose: "stride", at: 0 },
      { pose: "gather", at: 0.2 },
      { pose: "rise", at: 0.42 },
      { pose: "shoot", at: 0.58 },
      { pose: "follow", at: 0.7 },
      { pose: "land", at: 0.95 },
      { pose: "idle", at: 1.3 },
    ],
    liftAt: 0.36,
    releaseAt: 0.58,
    jumpHeight: 1.45,
    duration: 1.45,
    mech: { ...JUMPER_MECH, loadGain: 0.017 },
    travel: { back: 0.7, side: 0.15 },
  },

  /** Step-back: plant hard on the inside foot, push away, square up in the air,
   *  release slightly higher to clear the recovering hand. */
  stepback: {
    frames: [
      { pose: "stride", at: 0 },
      { pose: "plant", at: 0.18 },
      { pose: "pushback", at: 0.36 },
      { pose: "rise", at: 0.5 },
      { pose: "shootFade", at: 0.64 },
      { pose: "follow", at: 0.76 },
      { pose: "land", at: 1.02 },
      { pose: "idle", at: 1.4 },
    ],
    liftAt: 0.4,
    releaseAt: 0.64,
    jumpHeight: 1.3,
    duration: 1.55,
    mech: { ...JUMPER_MECH, releaseDeg: 53, chainSpread: 0.085 },
    travel: { back: 2.7, side: 0.5 },
  },

  /** Fadeaway: turn off the post shoulder, drift back, extra arc to make up for
   *  the backward momentum. */
  fadeaway: {
    frames: [
      { pose: "gather", at: 0 },
      { pose: "turn", at: 0.2 },
      { pose: "rise", at: 0.4 },
      { pose: "shootFade", at: 0.56 },
      { pose: "follow", at: 0.7 },
      { pose: "land", at: 0.98 },
      { pose: "idle", at: 1.35 },
    ],
    liftAt: 0.34,
    releaseAt: 0.56,
    jumpHeight: 1.25,
    duration: 1.5,
    mech: { ...JUMPER_MECH, releaseDeg: 54, liftGain: 0.016 },
    travel: { back: 2.0, side: 0.25 },
  },

  /** Floater: gathered a step early off one foot, pushed high and soft from the
   *  fingers rather than snapped from the wrist. */
  floater: {
    frames: [
      { pose: "stride", at: 0 },
      // The load window is wider than it looks it needs to be: the ball now
      // travels from the waist to a real set point at forehead height, which is
      // roughly twice the shoulder rotation it used to be, and cramming that
      // into 0.12 of the duration registered as a joint pop.
      { pose: "gather", at: 0.16 },
      { pose: "rise", at: 0.32 },
      { pose: "floater", at: 0.4 },
      { pose: "follow", at: 0.56 },
      { pose: "land", at: 0.8 },
      { pose: "idle", at: 1.1 },
    ],
    liftAt: 0.22,
    releaseAt: 0.4,
    jumpHeight: 1.05,
    duration: 1.25,
    mech: { ...JUMPER_MECH, refDist: 10, releaseDeg: 58, chainSpread: 0.05 },
    travel: { back: -2.3, side: 0.2 },
  },

  /** Driving layup: long-short gather, inside knee driven up, ball laid high. */
  driving_layup: {
    frames: [
      { pose: "stride", at: 0 },
      { pose: "layup", at: 0.3 },
      { pose: "follow", at: 0.62 },
      { pose: "land", at: 0.9 },
      { pose: "idle", at: 1.2 },
    ],
    liftAt: 0.22,
    releaseAt: 0.52,
    jumpHeight: 2.1,
    duration: 1.35,
    mech: { ...JUMPER_MECH, refDist: 4, loadGain: 0, liftGain: 0, releaseDeg: 46, chainSpread: 0.04 },
    travel: { back: -4.4, side: 0.5 },
  },

  /** Standing layup: no run-up to convert into lift, so it is a shorter gather
   *  off two feet and a softer lay rather than the driving version's long-short.
   *  This verb exists in the scenario schema, and without an entry here it fell
   *  through to `pullup` — a layup that animated as a jump shot, which is most of
   *  why every shot looked the same from close range. */
  layup: {
    frames: [
      { pose: "gather", at: 0 },
      { pose: "layup", at: 0.28 },
      { pose: "follow", at: 0.56 },
      { pose: "land", at: 0.82 },
      { pose: "idle", at: 1.12 },
    ],
    liftAt: 0.18,
    releaseAt: 0.46,
    jumpHeight: 1.5,
    duration: 1.25,
    mech: { ...JUMPER_MECH, refDist: 4, loadGain: 0, liftGain: 0, releaseDeg: 48, chainSpread: 0.04 },
    travel: { back: -1.3, side: 0.2 },
  },

  /** Reverse layup: carried under the rim, scooped up on the far side. */
  reverse_layup: {
    frames: [
      { pose: "stride", at: 0 },
      { pose: "layup", at: 0.24 },
      { pose: "reverse", at: 0.44 },
      { pose: "land", at: 0.95 },
      { pose: "idle", at: 1.25 },
    ],
    liftAt: 0.22,
    releaseAt: 0.55,
    jumpHeight: 2.1,
    duration: 1.4,
    mech: { ...JUMPER_MECH, refDist: 4, loadGain: 0, liftGain: 0, releaseDeg: 44, chainSpread: 0.04 },
    travel: { back: -3.7, side: 1.9 },
  },

  /** Hook: step across, then one long sweep released at full extension. */
  hook: {
    frames: [
      { pose: "gather", at: 0 },
      { pose: "sweepPrep", at: 0.16 },
      { pose: "hook", at: 0.38 },
      { pose: "hookFollow", at: 0.54 },
      { pose: "land", at: 0.8 },
      { pose: "idle", at: 1.1 },
    ],
    liftAt: 0.24,
    releaseAt: 0.44,
    jumpHeight: 1.1,
    duration: 1.25,
    mech: { ...JUMPER_MECH, refDist: 8, releaseDeg: 55, chainSpread: 0.09 },
    travel: { back: -0.7, side: 1.1 },
  },

  /** Dunk: ball secured high early, knees tucked on the rise, driven through. */
  dunk: {
    // A dunk is a gather, a leap, a punch through the ring and a hang. The old
    // timeline had the ball reach the rim at 0.5 and the player on the floor by
    // 0.98, with the release nominally at 0.6, so the throw-down happened BEFORE
    // the release instant the ball is launched on and the follow-through did not
    // exist. Now the load is real, the strike lands exactly on releaseAt, and the
    // arm comes down through the ring before he drops.
    frames: [
      { pose: "stride", at: 0 },
      { pose: "gather", at: 0.16 },
      { pose: "tuck", at: 0.34 },
      { pose: "dunk", at: 0.6 },
      { pose: "dunkFollow", at: 0.76 },
      { pose: "land", at: 1.12 },
      { pose: "idle", at: 1.5 },
    ],
    liftAt: 0.3,
    releaseAt: 0.6,
    jumpHeight: 2.9,
    duration: 1.7,
    mech: { ...JUMPER_MECH, refDist: 3, loadGain: 0, liftGain: 0, releaseDeg: 30, chainSpread: 0.03 },
    travel: { back: -5.2, side: 0 },
  },

  /** Free throw: the ritual. Long settle, controlled dip, almost no lift, and a
   *  long held finish. Distance never varies so the mechanics block is flat. */
  free_throw: {
    frames: [
      { pose: "idle", at: 0 },
      { pose: "ready", at: 0.3 },
      { pose: "dip", at: 0.62 },
      { pose: "rise", at: 0.88 },
      { pose: "shoot", at: 1.05 },
      { pose: "follow", at: 1.2 },
      { pose: "land", at: 1.6 },
      { pose: "idle", at: 1.95 },
    ],
    liftAt: 0.9,
    releaseAt: 1.05,
    jumpHeight: 0.3,
    duration: 2.1,
    mech: { ...JUMPER_MECH, refDist: 15, loadGain: 0, liftGain: 0, releaseDeg: 52, chainSpread: 0.1 },
    travel: { back: 0, side: 0 },
  },
};

/**
 * The sequence for a key. A miss falls back to `pullup` so the scene never
 * freezes, but it complains first: a silent fallback is exactly how `layup` ran
 * the jump-shot timeline for as long as it did without anyone noticing.
 */
export function shotSequence(key: string): ShotSequence {
  const seq = SHOT_SEQUENCES[key];
  if (seq) return seq;
  if (import.meta.env.DEV) {
    console.warn(
      `[sequences] no timeline for "${key}" — falling back to pullup. ` +
      `Every ShotVerb needs an entry here or it will animate as a jump shot.`,
    );
  }
  return SHOT_SEQUENCES.pullup;
}

/**
 * Distance adaptation. Returns the multipliers the controller applies to leg
 * flexion and jump height, plus the release angle for this distance.
 *
 * Longer shots load the legs deeper and jump slightly higher, and release angle
 * eases off past the reference distance.
 */
export function adaptShot(seq: ShotSequence, distFt: number) {
  const over = Math.max(distFt - seq.mech.refDist, 0);
  return {
    load: 1 + over * seq.mech.loadGain,
    lift: 1 + over * seq.mech.liftGain,
    releaseDeg: seq.mech.releaseDeg - over * seq.mech.releaseFalloff,
  };
}

/** Free-throw spot (Court page "Go to spot") — 19 ft from the baseline. */
export const FT_SPOT = { x: -28, z: 0 };

/**
 * The SEQUENCE KEY for a shot: usually the verb, but position upgrades it —
 * a catch-and-shoot AT the free-throw spot runs the FT ritual; a layup from
 * under/behind the rim plane becomes a reverse. ShooterPlayer (animation) and
 * ShotArc (ball) both call this, so they can never disagree.
 */
export function sequenceKeyFor(verb: string, x: number, z: number): string {
  if (verb === "catch_shoot" && Math.abs(x - FT_SPOT.x) < 1 && Math.abs(z) < 1) {
    return "free_throw";
  }
  if ((verb === "driving_layup" || verb === "layup") && x < -39.5 && Math.abs(z) > 2) {
    return "reverse_layup";
  }
  return verb;
}

/** Every verb the animation system can play, for the check scripts and the UI. */
export const SEQUENCE_KEYS = Object.keys(SHOT_SEQUENCES);
