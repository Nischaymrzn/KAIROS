/**
 * ANTHROPOMETRY — converts a PlayerConfig's physical attributes into a concrete
 * BodyPlan: every joint position, segment length and segment radius, in FEET.
 *
 * Ratios come from anthropometric data biased toward NBA athletes (longer limbs,
 * broader shoulders, ~7.9-head-tall stature, wingspan > height). This file is the
 * ONLY place body math lives — the rig builder consumes the plan blindly, so new
 * physical attributes are added here, never in geometry code.
 *
 * Frame: player-local, Y up, feet on y = 0, facing +Z. X = player's left→right.
 */
import { PhysicalConfig } from "./PlayerConfig";

export interface BodyPlan {
  height: number;

  // vertical landmarks (Y, feet)
  hipsY: number;
  waistY: number;
  chestY: number;
  shoulderY: number;
  neckBaseY: number;
  headCenterY: number;
  headRadius: number;
  kneeY: number;
  ankleY: number;

  // widths (half-distances from the centreline, feet)
  shoulderHalf: number;
  hipHalf: number;

  // arm chain (lengths, feet)
  upperArmLen: number;
  foreArmLen: number;
  handLen: number;

  // radii (feet)
  neckR: number;
  torsoTopR: number; // chest, under the shoulders
  torsoBotR: number; // waist
  hipsR: number;
  upperArmR: number;
  foreArmR: number;
  wristR: number;
  thighR: number;
  calfR: number;
  ankleR: number;

  // athletic limb shaping — peak/valley radii so limbs taper like muscle, not tubes
  bicepR: number; // upper-arm peak (biceps/triceps mass)
  elbowR: number; // narrowest point of the arm
  forePeakR: number; // brachioradialis bulge below the elbow
  quadR: number; // thigh peak (quads)
  kneePtR: number; // knee, narrowest point of the leg
  calfPeakR: number; // gastrocnemius bulge below the knee

  // feet / shoes
  footLen: number;
  footH: number;

  // equipment landmarks
  shortsLen: number; // hips → above the knee
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function solveBody(p: PhysicalConfig): BodyPlan {
  const H = clamp(p.height, 5.5, 7.6);

  // ---- vertical proportions (fractions of height; athlete-biased) ----
  const legBias = clamp(p.legLengthBias, -0.05, 0.05);
  const hipsY = H * (0.53 + legBias);
  const kneeY = hipsY * 0.52;
  const ankleY = H * 0.038;
  const shoulderY = H * 0.818;
  const chestY = H * 0.72;
  const waistY = H * 0.615;
  const neckBaseY = H * 0.85;
  const headRadius = (H / 7.9) * 0.5;
  const headCenterY = H - headRadius * 1.05;

  // ---- widths ----
  const shoulderHalf = (H * clamp(p.shoulderWidthRatio, 0.22, 0.3)) / 2;
  const hipHalf = H * 0.062 * (1 + p.bodyFat * 0.18);

  // ---- arm chain from wingspan: span = 2·(upper+fore+hand) + biacromial ----
  const span = H * clamp(p.wingspanRatio, 0.98, 1.14);
  const armTotal = Math.max((span - shoulderHalf * 2) / 2, H * 0.36);
  const upperArmLen = armTotal * 0.44;
  const foreArmLen = armTotal * 0.415;
  const handLen = armTotal * 0.145 * clamp(p.handScale, 0.85, 1.2);

  // ---- girths: muscle widens limbs/chest, fat widens the waist/hips ----
  const muscle = 0.88 + clamp(p.muscularity, 0, 1) * 0.28;
  const fat = 0.92 + clamp(p.bodyFat, 0, 1) * 0.3;
  const chest = clamp(p.chestScale, 0.85, 1.2);

  return {
    height: H,
    hipsY,
    waistY,
    chestY,
    shoulderY,
    neckBaseY,
    headCenterY,
    headRadius,
    kneeY,
    ankleY,
    shoulderHalf,
    hipHalf,
    upperArmLen,
    foreArmLen,
    handLen,
    neckR: H * 0.026 * clamp(p.neckScale, 0.85, 1.2) * muscle,
    torsoTopR: shoulderHalf * 0.78 * chest * muscle,
    torsoBotR: H * 0.058 * fat,
    hipsR: hipHalf * 1.18,
    upperArmR: H * 0.0195 * muscle,
    foreArmR: H * 0.0165 * muscle,
    wristR: H * 0.011,
    thighR: H * 0.031 * (muscle * 0.6 + fat * 0.4),
    calfR: H * 0.0225 * muscle,
    ankleR: H * 0.0125,
    bicepR: H * 0.0225 * muscle,
    elbowR: H * 0.0145,
    forePeakR: H * 0.0185 * muscle,
    quadR: H * 0.0345 * (muscle * 0.65 + fat * 0.35),
    kneePtR: H * 0.0195,
    calfPeakR: H * 0.026 * muscle,
    footLen: H * 0.152 * clamp(p.shoeScale, 0.85, 1.2),
    footH: H * 0.028,
    shortsLen: (hipsY - kneeY) * 0.72,
  };
}

/**
 * PHYSIQUE FROM REAL MEASUREMENTS — map a player's listed height/weight to the
 * build parameters (BMI-based). NBA reality: lean guards sit near BMI 22-23
 * (Trae ~21.9), average wings ~24-25, and power builds run 27+ (Zion ~33).
 * Gives Curry vs Zion visibly different bodies from their REAL numbers.
 */
export function physiqueFromMeasure(heightIn: number, weightLb: number): {
  muscularity: number;
  bodyFat: number;
  shoulderWidthRatio: number;
  chestScale: number;
} {
  const bmi = (703 * weightLb) / (heightIn * heightIn);
  // normalise BMI 21 (very lean) … 32 (max power build) → 0..1
  const t = Math.min(Math.max((bmi - 21) / 11, 0), 1);
  return {
    muscularity: 0.5 + t * 0.42,
    bodyFat: 0.14 + t * 0.42,
    shoulderWidthRatio: 0.25 + t * 0.024,
    chestScale: 0.96 + t * 0.14,
  };
}
