/**
 * POSES — named full-body poses as per-bone Euler rotations (radians), applied on
 * top of the rig's bind pose (standing straight, arms hanging). A pose is plain
 * data: the AnimationController blends between them, and future animation clips
 * simply key the same bone names over time.
 *
 * Rotation conventions (player faces +Z):
 *   x = pitch (forward/back)   y = yaw (twist)   z = roll (sideways)
 */
import { BoneName } from "../rig/buildRig";

export type Pose = Partial<Record<BoneName, [number, number, number]>>;

/** Relaxed athletic idle — soft knees, arms slightly away from the body, a touch
 *  of forward lean, and a SUBTLE weight shift onto the right leg (perfectly
 *  symmetric stances read robotic; real players never stand mirrored). */
export const IDLE: Pose = {
  Hips: [0.03, 0, 0.015],
  Spine: [0.05, 0.02, -0.012],
  Spine1: [0.03, 0, 0],
  Neck: [-0.06, -0.02, 0],

  // arms hang with slight outward abduction + soft elbows, palms toward thighs
  LeftArm: [0.06, 0.15, 0.14],
  LeftForeArm: [0.16, 0, 0.06],
  LeftHand: [0.06, 0, 0],
  RightArm: [0.06, -0.15, -0.14],
  RightForeArm: [0.18, 0, -0.06],
  RightHand: [0.06, 0, 0],

  // feet shoulder-ish width, soft knees; the left (unweighted) knee a touch freer
  LeftUpLeg: [-0.09, 0.05, 0.05],
  LeftLeg: [0.19, 0, 0],
  LeftFoot: [-0.11, 0, -0.05],
  RightUpLeg: [-0.11, -0.05, -0.04],
  RightLeg: [0.15, 0, 0],
  RightFoot: [-0.08, 0, 0.04],
};

/** Wide, low defensive stance — ready for the future gameplay states. */
/** Follow-through at release: both arms up toward the rim, shooting wrist
 *  flexed, body extended tall, eyes up. Used the instant a shot is fired. */
export const SHOOT: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.20],
  LeftShoulder: [0, 0, 0.14],
  Hips: [-0.04, 0, 0],
  Spine: [-0.08, 0, 0],
  Spine1: [-0.06, 0, 0],
  Neck: [-0.22, 0, 0],

  // right = shooting arm. The chain must reach PROGRESSIVELY forward: shoulder
  // 30 deg forward of vertical, elbow 46, wrist 92 as it snaps over. A negative
  // forearm value folds the wrist behind the elbow, which puts the ball above
  // and behind the head and reads as reaching back for it.
  RightArm: [-2.62, 0, -0.12],
  RightForeArm: [0.28, 0, 0],
  RightHand: [0.8, 0, 0],
  // left = guide hand: beside the ball, coming off it at release
  LeftArm: [-2.34, 0.25, 0.3],
  LeftForeArm: [0.21, 0, 0.1],
  LeftHand: [0.28, 0, 0],

  // legs extended from the jump, toes pointed slightly
  LeftUpLeg: [0.08, 0.04, 0.04],
  LeftLeg: [0.12, 0, 0],
  LeftFoot: [0.32, 0, -0.04],
  RightUpLeg: [0.02, -0.04, -0.04],
  RightLeg: [0.18, 0, 0],
  RightFoot: [0.36, 0, 0.04],
};

export const DEFENSIVE: Pose = {
  Hips: [0.12, 0, 0],
  Spine: [0.18, 0, 0],
  Spine1: [0.08, 0, 0],
  Neck: [-0.2, 0, 0],
  LeftArm: [0.25, 0.3, 0.85],
  LeftForeArm: [-0.77, 0, 0.15],
  RightArm: [0.25, -0.3, -0.85],
  RightForeArm: [-0.77, 0, -0.15],
  LeftUpLeg: [-0.55, 0.12, 0.3],
  LeftLeg: [0.85, 0, 0],
  LeftFoot: [-0.28, 0, -0.28],
  RightUpLeg: [-0.55, -0.12, -0.3],
  RightLeg: [0.85, 0, 0],
  RightFoot: [-0.28, 0, 0.28],
};

/** Fadeaway release — the jumper leaning back off the vertical. */
export const SHOOT_FADE: Pose = {
  ...SHOOT,
  Hips: [-0.3, 0, 0],
  Spine: [-0.22, 0, 0],
  Spine1: [-0.1, 0, 0],
  Neck: [-0.05, 0, 0],
  LeftUpLeg: [0.35, 0.04, 0.05],
  RightUpLeg: [0.28, -0.04, -0.05],
  LeftLeg: [0.25, 0, 0],
  RightLeg: [0.3, 0, 0],
};

/** Layup — one-hand extension off one foot: right arm reaches for the glass,
 *  left knee drives up, body tall. */
export const LAYUP: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on. A lay-in
  // reaches UP rather than out, so the girdle elevates less than a jump shot's.
  RightShoulder: [0, 0, -0.11],
  LeftShoulder: [0, 0, 0.06],
  Hips: [-0.06, 0, 0.04],
  Spine: [-0.1, 0.1, 0],
  Neck: [-0.24, 0, 0],
  RightArm: [-2.86, 0, -0.06],
  RightForeArm: [0.24, 0, 0],
  RightHand: [0.7, 0, 0],
  LeftArm: [-0.9, 0.3, 0.5],
  LeftForeArm: [1.1, 0, 0.2],
  // left knee driven up, right leg extended under
  LeftUpLeg: [-1.5, 0.06, 0.05],
  LeftLeg: [1.7, 0, 0],
  LeftFoot: [0.4, 0, 0],
  RightUpLeg: [0.25, -0.05, -0.04],
  RightLeg: [0.15, 0, 0],
  RightFoot: [0.5, 0, 0.04],
};

/** Floater — early one-hand push from below, softer wrist, feet split. */
export const FLOATER: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.16],
  LeftShoulder: [0, 0, 0.08],
  Hips: [-0.02, 0, 0],
  Spine: [-0.06, 0, 0],
  Neck: [-0.2, 0, 0],
  RightArm: [-2.41, 0, -0.15],
  RightForeArm: [0.24, 0, 0],
  RightHand: [0.77, 0, 0],
  LeftArm: [-1.2, 0.3, 0.4],
  LeftForeArm: [0.9, 0, 0.15],
  LeftUpLeg: [-0.7, 0.05, 0.05],
  LeftLeg: [0.9, 0, 0],
  RightUpLeg: [0.18, -0.05, -0.05],
  RightLeg: [0.2, 0, 0],
  RightFoot: [0.4, 0, 0.03],
};

/** Hook — side-on one-arm sweep overhead; off arm shields. */
export const HOOK: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.26],
  LeftShoulder: [0, 0, 0.10],
  Hips: [0, 0.5, 0.06],
  Spine: [-0.04, 0.35, -0.14],
  Neck: [-0.1, -0.5, 0.1],
  RightArm: [-2.18, 0, -1.35],
  RightForeArm: [0.3, 0, 0],
  RightHand: [0.63, 0, 0],
  LeftArm: [0.3, 0.2, 0.9],
  LeftForeArm: [-0.65, 0, 0.2],
  LeftUpLeg: [-0.5, 0.1, 0.06],
  LeftLeg: [0.7, 0, 0],
  RightUpLeg: [0.15, -0.08, -0.05],
  RightLeg: [0.25, 0, 0],
};

/** Dunk — two hands driving down at the rim, knees pulled up. */
export const DUNK: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.20],
  LeftShoulder: [0, 0, 0.20],
  Hips: [0.12, 0, 0],
  Spine: [0.18, 0, 0],
  Spine1: [0.1, 0, 0],
  Neck: [-0.3, 0, 0],
  RightArm: [-2.83, -0.15, -0.25],
  RightForeArm: [0.24, 0, 0],
  RightHand: [0.63, 0, 0],
  LeftArm: [-2.83, 0.15, 0.25],
  LeftForeArm: [0.24, 0, 0],
  LeftHand: [0.63, 0, 0],
  LeftUpLeg: [-1.1, 0.06, 0.06],
  LeftLeg: [1.5, 0, 0],
  LeftFoot: [0.5, 0, 0],
  RightUpLeg: [-0.9, -0.06, -0.06],
  RightLeg: [1.4, 0, 0],
  RightFoot: [0.5, 0, 0],
};

/** Gather — the loaded crouch before any jump shot: knees bent deep, hips back,
 *  ball held at the chest, eyes on the rim. */
export const GATHER: Pose = {
  Hips: [0.34, 0, 0],
  Spine: [0.22, 0, 0],
  Spine1: [0.1, 0, 0],
  Neck: [-0.38, 0, 0],
  // both hands holding the ball at the chest
  // Elbows bend so the forearms come FORWARD and the ball sits in front of the
  // waist. A positive forearm value here swings it past straight-down and puts
  // the hands behind the body, which is what made the gather read as reaching
  // back for the ball before shooting.
  RightArm: [-0.24, -0.25, -0.35],
  RightForeArm: [-0.94, 0, -0.15],
  RightHand: [-0.21, 0, 0],
  LeftArm: [-0.24, 0.25, 0.35],
  LeftForeArm: [-0.94, 0, 0.15],
  LeftHand: [-0.21, 0, 0],
  LeftUpLeg: [-0.85, 0.05, 0.05],
  LeftLeg: [1.15, 0, 0],
  LeftFoot: [-0.32, 0, -0.05],
  RightUpLeg: [-0.85, -0.05, -0.05],
  RightLeg: [1.15, 0, 0],
  RightFoot: [-0.32, 0, 0.05],
};

/** Rise — half-way up: body extending, ball travelling from chest past the brow. */
export const RISE: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.12],
  LeftShoulder: [0, 0, 0.08],
  Hips: [0.1, 0, 0],
  Spine: [0.04, 0, 0],
  Neck: [-0.22, 0, 0],
  // The set point. Elbow up and under, forearm close to vertical so the ball
  // sits at forehead height in front of the face, wrist cocked back beneath it.
  RightArm: [-2.48, -0.1, -0.2],
  RightForeArm: [-0.42, 0, -0.05],
  RightHand: [-0.63, 0, 0],
  LeftArm: [-1.5, 0.2, 0.3],
  LeftForeArm: [1.2, 0, 0.1],
  LeftUpLeg: [-0.2, 0.05, 0.05],
  LeftLeg: [0.4, 0, 0],
  LeftFoot: [0.15, 0, -0.05],
  RightUpLeg: [-0.2, -0.05, -0.05],
  RightLeg: [0.4, 0, 0],
  RightFoot: [0.15, 0, 0.05],
};

/** Landing absorb — soft knees catching the body, arms settling. */
export const LAND: Pose = {
  Hips: [0.2, 0, 0],
  Spine: [0.12, 0, 0],
  Neck: [-0.15, 0, 0],
  RightArm: [-0.2, -0.15, -0.3],
  RightForeArm: [0.5, 0, -0.05],
  LeftArm: [-0.2, 0.15, 0.3],
  LeftForeArm: [0.5, 0, 0.05],
  LeftUpLeg: [-0.55, 0.05, 0.05],
  LeftLeg: [0.8, 0, 0],
  LeftFoot: [-0.25, 0, -0.05],
  RightUpLeg: [-0.55, -0.05, -0.05],
  RightLeg: [0.8, 0, 0],
  RightFoot: [-0.25, 0, 0.05],
};

/** Layup stride — the one-foot gather driving toward the rim. */
export const STRIDE: Pose = {
  Hips: [0.22, 0.05, 0.02],
  Spine: [0.16, 0.06, 0],
  Neck: [-0.3, 0, 0],
  // Elbows bent with the forearms carried in FRONT. Positive forearm values
  // swing them behind the body, which both looks wrong on a run and made the
  // trip into the gather long enough to register as a joint pop.
  RightArm: [-0.52, -0.2, -0.3],
  RightForeArm: [-0.73, 0, -0.1],
  LeftArm: [0.28, 0.2, 0.4],
  LeftForeArm: [-1.33, 0, 0.15],
  LeftUpLeg: [-1.05, 0.06, 0.05],
  LeftLeg: [1.35, 0, 0],
  LeftFoot: [0.2, 0, 0],
  RightUpLeg: [0.3, -0.05, -0.04],
  RightLeg: [0.35, 0, 0],
  RightFoot: [0.25, 0, 0.04],
};

/** Reverse finish — head turned back to the rim, scooping arm laid back over
 *  the shoulder, body arching away (the far-side baseline finish). */
export const REVERSE: Pose = {
  // A reverse already lays the ball back over the head by design; adding full
  // scapular abduction on top carried it past what a shoulder can actually do.
  RightShoulder: [0, 0, -0.09],
  LeftShoulder: [0, 0, 0.07],
  Hips: [-0.12, 0.7, 0.08],
  Spine: [-0.18, 0.5, -0.1],
  Spine1: [-0.08, 0.25, 0],
  Neck: [-0.15, -0.85, 0],
  // the laid-back wrist is deliberate here: a reverse finish lays the ball up on
  // the far side of the rim. Only the folded elbow is corrected.
  RightArm: [-2.93, -0.3, -0.5],
  RightForeArm: [0.21, 0, 0],
  RightHand: [-0.73, 0, 0],
  LeftArm: [-0.7, 0.3, 0.6],
  LeftForeArm: [1.0, 0, 0.2],
  LeftUpLeg: [-1.2, 0.08, 0.06],
  LeftLeg: [1.5, 0, 0],
  LeftFoot: [0.45, 0, 0],
  RightUpLeg: [0.15, -0.06, -0.05],
  RightLeg: [0.4, 0, 0],
  RightFoot: [0.5, 0, 0.04],
};

/** Shot-ready before the pass arrives: hands up as a target, feet already set,
 *  knees soft. The catch flows straight out of this with no re-grip. */
export const READY: Pose = {
  Hips: [0.14, 0, 0],
  Spine: [0.12, 0, 0],
  Neck: [-0.3, 0, 0],
  RightArm: [-0.38, -0.3, -0.45],
  RightForeArm: [-0.94, 0, -0.2],
  RightHand: [-0.17, 0, 0],
  LeftArm: [-0.38, 0.3, 0.45],
  LeftForeArm: [-0.94, 0, 0.2],
  LeftHand: [-0.17, 0, 0],
  LeftUpLeg: [-0.42, 0.05, 0.05],
  LeftLeg: [0.6, 0, 0],
  LeftFoot: [-0.2, 0, -0.05],
  RightUpLeg: [-0.42, -0.05, -0.05],
  RightLeg: [0.6, 0, 0],
  RightFoot: [-0.2, 0, 0.05],
};

/** Shallow one-motion dip: the ball drops to the hip while the legs load, and
 *  the two happen together rather than in sequence. */
export const DIP: Pose = {
  Hips: [0.26, 0, 0],
  Spine: [0.18, 0, 0],
  Neck: [-0.34, 0, 0],
  RightArm: [-0.14, -0.22, -0.3],
  RightForeArm: [-0.91, 0, -0.12],
  RightHand: [-0.21, 0, 0],
  LeftArm: [-0.14, 0.22, 0.3],
  LeftForeArm: [-0.91, 0, 0.12],
  LeftHand: [-0.21, 0, 0],
  LeftUpLeg: [-0.68, 0.05, 0.05],
  LeftLeg: [0.95, 0, 0],
  LeftFoot: [-0.28, 0, -0.05],
  RightUpLeg: [-0.68, -0.05, -0.05],
  RightLeg: [0.95, 0, 0],
  RightFoot: [-0.28, 0, 0.05],
};

/** Step-back plant: inside foot loaded hard, weight still travelling forward,
 *  ball swept to the hip away from the reach. */
export const PLANT: Pose = {
  Hips: [0.3, -0.18, 0.1],
  Spine: [0.24, -0.12, -0.08],
  Neck: [-0.34, 0.2, 0],
  RightArm: [-0.2, -0.35, -0.25],
  RightForeArm: [-0.67, 0, -0.1],
  LeftArm: [-0.15, 0.35, 0.35],
  LeftForeArm: [-0.72, 0, 0.15],
  LeftUpLeg: [-1.0, 0.1, 0.06],
  LeftLeg: [1.35, 0, 0],
  LeftFoot: [-0.3, 0, -0.06],
  RightUpLeg: [-0.35, -0.1, -0.06],
  RightLeg: [0.5, 0, 0],
  RightFoot: [-0.15, 0, 0.06],
};

/** Step-back push-off: driving away from the defender, torso still squaring. */
export const PUSHBACK: Pose = {
  Hips: [0.05, -0.1, 0.06],
  Spine: [0.02, -0.06, -0.05],
  Neck: [-0.3, 0.12, 0],
  RightArm: [-0.75, -0.3, -0.3],
  RightForeArm: [0.66, 0, -0.12],
  LeftArm: [-0.6, 0.3, 0.4],
  LeftForeArm: [0.51, 0, 0.15],
  LeftUpLeg: [-0.15, 0.08, 0.05],
  LeftLeg: [0.35, 0, 0],
  LeftFoot: [0.2, 0, -0.05],
  RightUpLeg: [-0.55, -0.08, -0.05],
  RightLeg: [0.8, 0, 0],
  RightFoot: [-0.1, 0, 0.05],
};

/** Fadeaway turn: pivoting off the post shoulder, ball swept high and away. */
export const TURN: Pose = {
  Hips: [0.1, 0.42, 0.05],
  Spine: [0.06, 0.3, -0.06],
  Spine1: [0.02, 0.15, 0],
  Neck: [-0.24, -0.35, 0],
  RightArm: [-0.9, -0.2, -0.4],
  RightForeArm: [0.73, 0, -0.15],
  LeftArm: [-0.5, 0.35, 0.5],
  LeftForeArm: [0.33, 0, 0.2],
  LeftUpLeg: [-0.6, 0.1, 0.06],
  LeftLeg: [0.85, 0, 0],
  RightUpLeg: [-0.45, -0.1, -0.05],
  RightLeg: [0.65, 0, 0],
};

/** Held follow-through: the shooting hand stays extended into the rim after the
 *  ball has gone, arm relaxing rather than snapping back. */
export const FOLLOW: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.24],
  LeftShoulder: [0, 0, 0.16],
  Hips: [-0.02, 0, 0],
  Spine: [-0.05, 0, 0],
  Neck: [-0.2, 0, 0],
  // full extension, then the gooseneck: wrist flopped over to 120 deg so the
  // fingers finish pointing down at the rim
  RightArm: [-2.55, 0, -0.14],
  RightForeArm: [0.31, 0, 0],
  RightHand: [1.19, 0, 0],
  LeftArm: [-2.06, 0.28, 0.35],
  LeftForeArm: [0.21, 0, 0.12],
  LeftHand: [0.24, 0, 0],
  LeftUpLeg: [0.12, 0.04, 0.04],
  LeftLeg: [0.2, 0, 0],
  LeftFoot: [0.3, 0, -0.04],
  RightUpLeg: [0.06, -0.04, -0.04],
  RightLeg: [0.24, 0, 0],
  RightFoot: [0.34, 0, 0.04],
};

/**
 * Hook follow-through. A hook does NOT finish like a jump shot: the shooting arm
 * carries over from the sweep while the off arm STAYS out for balance and to
 * shield, rather than coming up beside the ball. Sharing the jump shot's FOLLOW
 * made the guide arm travel the whole way across in 0.16 s, which showed up as a
 * joint pop in animcheck.
 */
export const HOOK_FOLLOW: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.22],
  LeftShoulder: [0, 0, 0.09],
  Hips: [0, 0.42, 0.05],
  Spine: [-0.06, 0.3, -0.12],
  Neck: [-0.12, -0.42, 0.08],
  RightArm: [-2.44, 0, -1.0],
  RightForeArm: [0.31, 0, 0],
  RightHand: [0.73, 0, 0],
  LeftArm: [0.15, 0.2, 0.8],
  LeftForeArm: [-0.41, 0, 0.2],
  LeftHand: [0.1, 0, 0],
  LeftUpLeg: [-0.3, 0.08, 0.05],
  LeftLeg: [0.45, 0, 0],
  LeftFoot: [0.28, 0, -0.04],
  RightUpLeg: [0.1, -0.06, -0.04],
  RightLeg: [0.2, 0, 0],
  RightFoot: [0.32, 0, 0.03],
};

/** Hook step-across: lead foot planted across the defender, torso as the wall. */
export const SWEEP_PREP: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.10],
  LeftShoulder: [0, 0, 0.10],
  Hips: [0.12, 0.62, 0.08],
  Spine: [0.08, 0.4, -0.12],
  Neck: [-0.15, -0.6, 0.08],
  RightArm: [-0.38, -0.2, -0.6],
  RightForeArm: [-0.8, 0, -0.1],
  LeftArm: [0.2, 0.25, 0.95],
  LeftForeArm: [-0.9, 0, 0.2],
  LeftUpLeg: [-0.75, 0.12, 0.06],
  LeftLeg: [1.0, 0, 0],
  RightUpLeg: [-0.25, -0.1, -0.05],
  RightLeg: [0.45, 0, 0],
};

/** Dunk approach: ball secured high and early, knees tucking on the rise. */
export const TUCK: Pose = {
  // scapular rotation. Nothing animated the shoulder girdle before, so every
  // overhead pose reached with the arm alone and read as bolted on.
  RightShoulder: [0, 0, -0.12],
  LeftShoulder: [0, 0, 0.12],
  Hips: [0.06, 0, 0],
  Spine: [0.1, 0, 0],
  Neck: [-0.32, 0, 0],
  RightArm: [-1.9, -0.18, -0.3],
  RightForeArm: [0.75, 0, -0.1],
  LeftArm: [-1.9, 0.18, 0.3],
  LeftForeArm: [0.75, 0, 0.1],
  LeftUpLeg: [-0.75, 0.06, 0.06],
  LeftLeg: [1.15, 0, 0],
  LeftFoot: [0.3, 0, 0],
  RightUpLeg: [-0.35, -0.06, -0.06],
  RightLeg: [0.6, 0, 0],
  RightFoot: [0.3, 0, 0],
};

/**
 * Dunk follow-through: the arm driven DOWN through the ring, body still high and
 * extended, legs trailing under. The dunk sequence went from the ball at the rim
 * straight to landing, so the most recognisable half of a dunk, the punch through
 * and the hang, never happened at all.
 */
export const DUNK_FOLLOW: Pose = {
  RightShoulder: [0, 0, -0.22],
  LeftShoulder: [0, 0, 0.16],
  Hips: [-0.16, 0, 0],
  Spine: [-0.2, 0, 0],
  Spine1: [-0.1, 0, 0],
  Neck: [-0.12, 0, 0],
  // the shooting arm has come down past the ring, elbow still high
  RightArm: [-1.62, -0.12, -0.32],
  RightForeArm: [0.34, 0, 0],
  RightHand: [0.5, 0, 0],
  // the off arm swings out for balance
  LeftArm: [-2.1, 0.34, 0.6],
  LeftForeArm: [0.42, 0, 0.16],
  LeftHand: [0.2, 0, 0],
  // legs trailing under a body that is still up
  LeftUpLeg: [0.28, 0.05, 0.05],
  LeftLeg: [0.5, 0, 0],
  LeftFoot: [0.34, 0, -0.04],
  RightUpLeg: [0.18, -0.05, -0.05],
  RightLeg: [0.62, 0, 0],
  RightFoot: [0.36, 0, 0.04],
};

/**
 * CONTEST — the closeout. Lead hand high into the shooter's line, off arm out
 * for balance, chest square, weight still under him rather than lunging past.
 *
 * The defensive stance alone was being used for every defender at every distance,
 * so a man three feet from the ball stood exactly as a man eighteen feet away.
 * This is the pose that reads as pressure, and pressure is the thing the whole
 * contest feature is about.
 */
export const CONTEST: Pose = {
  RightShoulder: [0, 0, -0.3],
  LeftShoulder: [0, 0, 0.12],
  Hips: [0.08, 0, 0],
  Spine: [0.1, 0, 0],
  Spine1: [0.05, 0, 0],
  Neck: [-0.3, 0, 0],
  // contest hand straight up into the shot
  RightArm: [-2.86, -0.06, -0.16],
  RightForeArm: [0.12, 0, 0],
  RightHand: [0.24, 0, 0],
  // off arm wide, the way a closeout keeps balance without fouling
  LeftArm: [0.2, 0.28, 1.05],
  LeftForeArm: [-0.5, 0, 0.2],
  LeftHand: [0.1, 0, 0],
  // still loaded, not lunging
  LeftUpLeg: [-0.42, 0.12, 0.24],
  LeftLeg: [0.66, 0, 0],
  LeftFoot: [-0.2, 0, -0.2],
  RightUpLeg: [-0.34, -0.1, -0.2],
  RightLeg: [0.54, 0, 0],
  RightFoot: [-0.18, 0, 0.18],
};

export const POSES = {
  idle: IDLE,
  defensive: DEFENSIVE,
  shoot: SHOOT,
  shootFade: SHOOT_FADE,
  layup: LAYUP,
  floater: FLOATER,
  hook: HOOK,
  dunk: DUNK,
  gather: GATHER,
  rise: RISE,
  land: LAND,
  stride: STRIDE,
  reverse: REVERSE,
  ready: READY,
  dip: DIP,
  plant: PLANT,
  pushback: PUSHBACK,
  turn: TURN,
  follow: FOLLOW,
  hookFollow: HOOK_FOLLOW,
  sweepPrep: SWEEP_PREP,
  tuck: TUCK,
  dunkFollow: DUNK_FOLLOW,
  contest: CONTEST,
} as const;
export type PoseName = keyof typeof POSES;
