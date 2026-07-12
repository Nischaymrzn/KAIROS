/**
 * SHOT BALLISTICS — standard projectile mechanics applied to basketball
 * (the classic treatment: P. Brancazio, "Physics of basketball", Am. J. Phys. 49).
 * Everything is in the court's own units: FEET and SECONDS.
 *
 * The release point is derived from the shooter's REAL measurements (standing
 * reach + max vertical from the model's player lookup) and the shot verb — so
 * height advantage is not a slider, it falls out of who is shooting.
 *
 *   v² = g·d² / (2·cos²θ·(d·tanθ − Δh))      speed needed at launch angle θ
 *   θ_min = 45° + ½·atan(Δh/d)                minimum-speed launch angle
 *   tan(β) = tan(θ) − g·d/(v²·cos²θ)          entry (descent) angle at the rim
 *
 * Rim geometry: 18 in diameter; ball 9.5 in. The rim's APPARENT opening from the
 * ball's approach direction is 18·sin(β) — under ~32° the ball no longer fits
 * cleanly, which is why flat shots miss long/short so unforgivingly.
 */
import * as D from "../constants/dimensions";

export const G = 32.174; // ft/s²
export const RIM_HEIGHT = 10;
export const RIM_DIAMETER_IN = 18;
export const BALL_DIAMETER_IN = 9.5;
/** backboard front face plane (board is 4 ft from the baseline) */
export const BOARD_X = D.basketX(-1) - 1.25 + 0.5; // rim centre −41.75, board 6" behind rim edge ≈ −42.5
export const BOARD_HALF_WIDTH = 3; // 6 ft wide
export const BOARD_BOTTOM = 9.5; // board bottom edge ≈ 9.5 ft, top 13 ft

/** How each shot verb converts a shooter's measurements into a release point.
 *  jumpFactor = fraction of max vertical actually used; the reach itself already
 *  includes the raised arm (standing reach = fingertips overhead). */
export const RELEASE_MODEL: Record<string, { jumpFactor: number; label: string }> = {
  catch_shoot: { jumpFactor: 0.55, label: "set jumper (quick hop)" },
  pullup: { jumpFactor: 0.65, label: "pull-up (full rise)" },
  stepback: { jumpFactor: 0.6, label: "step-back (drifting rise)" },
  fadeaway: { jumpFactor: 0.55, label: "fadeaway (leaning back)" },
  floater: { jumpFactor: 0.35, label: "floater (early release)" },
  driving_layup: { jumpFactor: 0.8, label: "layup (full extension)" },
  hook: { jumpFactor: 0.4, label: "hook (one-arm overhead)" },
  dunk: { jumpFactor: 0.95, label: "dunk (ball carried to rim)" },
};

export interface ShooterMeasure {
  /** standing reach, feet (fingertips, arm overhead, flat-footed) */
  standingReachFt: number;
  /** max vertical leap, feet */
  maxVerticalFt: number;
}

/** Release height (ft) for this shooter + shot verb. */
export function releaseHeight(m: ShooterMeasure, verb: string): number {
  const rm = RELEASE_MODEL[verb] ?? RELEASE_MODEL.pullup;
  return m.standingReachFt + m.maxVerticalFt * rm.jumpFactor;
}

export interface ArcSolution {
  launchDeg: number;
  entryDeg: number;
  speedFps: number;
  flightTime: number;
  apexFt: number;
  /** apparent rim opening seen by the descending ball, as a fraction of ball Ø.
   *  > 1 means the full ball fits through the opening cleanly. */
  rimOpeningRatio: number;
  /** clearance between apparent opening and ball, inches (negative = no clean fit) */
  rimMarginIn: number;
}

/** Solve the arc for a given launch angle. Returns null if that angle physically
 *  cannot reach the rim (needs d·tanθ > Δh). */
export function solveArc(distFt: number, releaseFt: number, launchDeg: number): ArcSolution | null {
  const th = (launchDeg * Math.PI) / 180;
  const dh = RIM_HEIGHT - releaseFt;
  const denom = 2 * Math.cos(th) ** 2 * (distFt * Math.tan(th) - dh);
  if (denom <= 0) return null;
  const v2 = (G * distFt * distFt) / denom;
  const v = Math.sqrt(v2);
  const tanB = Math.tan(th) - (G * distFt) / (v2 * Math.cos(th) ** 2);
  const entryDeg = (Math.atan(-tanB) * 180) / Math.PI; // positive = descending
  const t = distFt / (v * Math.cos(th));
  const vy = v * Math.sin(th);
  const apex = releaseFt + (vy * vy) / (2 * G);
  const opening = RIM_DIAMETER_IN * Math.sin((entryDeg * Math.PI) / 180);
  return {
    launchDeg,
    entryDeg,
    speedFps: v,
    flightTime: t,
    apexFt: apex,
    rimOpeningRatio: opening / BALL_DIAMETER_IN,
    rimMarginIn: opening - BALL_DIAMETER_IN,
  };
}

/** Minimum-speed launch angle for this distance/release (the energy-optimal arc). */
export function minSpeedAngleDeg(distFt: number, releaseFt: number): number {
  const dh = RIM_HEIGHT - releaseFt;
  return 45 + (Math.atan2(dh, distFt) * 180) / Math.PI / 2;
}

/** Ball height (ft) at horizontal progress x from the release, along a solved arc. */
export function heightAt(x: number, releaseFt: number, sol: ArcSolution): number {
  const th = (sol.launchDeg * Math.PI) / 180;
  const vx = sol.speedFps * Math.cos(th);
  const t = x / vx;
  return releaseFt + sol.speedFps * Math.sin(th) * t - 0.5 * G * t * t;
}

export interface ContestCheck {
  /** ball height when it passes over the defender, ft */
  ballHeightAtDefender: number;
  /** defender's contest ceiling (reach + vertical used on a closeout), ft */
  contestCeiling: number;
  clearanceFt: number;
  blocked: boolean;
}

/** Does this arc clear a defender standing `defDistFt` in the shot line?
 *  Closeout model: a contesting defender gets ~60% of their max vertical. */
export function contestCheck(
  defDistFt: number,
  defender: ShooterMeasure,
  distFt: number,
  releaseFt: number,
  sol: ArcSolution,
): ContestCheck {
  const x = Math.min(Math.max(defDistFt, 0.5), distFt);
  const ballH = heightAt(x, releaseFt, sol);
  const ceiling = defender.standingReachFt + defender.maxVerticalFt * 0.6;
  return {
    ballHeightAtDefender: ballH,
    contestCeiling: ceiling,
    clearanceFt: ballH - ceiling,
    blocked: ballH <= ceiling,
  };
}

/** Bank-shot aim point: reflect the rim centre across the backboard plane, then
 *  intersect the straight release→virtual-target line with the glass. Returns
 *  null when the geometry can't bank (shooter behind the board or dead-centre). */
export function bankAimPoint(
  shooter: { x: number; z: number },
  releaseFt: number,
): { x: number; y: number; z: number; onSquare: boolean } | null {
  const rim = { x: D.basketX(-1), y: RIM_HEIGHT, z: 0 };
  if (shooter.x <= BOARD_X + 0.5) return null; // at/behind the glass
  const virtual = { x: 2 * BOARD_X - rim.x, y: rim.y, z: rim.z };
  const t = (BOARD_X - shooter.x) / (virtual.x - shooter.x);
  if (t <= 0 || t >= 1) return null;
  const z = shooter.z + (virtual.z - shooter.z) * t;
  const y = releaseFt + (virtual.y - releaseFt) * t;
  // the painted square: 24 in wide, 18 in tall, bottom edge at rim height
  const onSquare = Math.abs(z) <= 1 && y >= RIM_HEIGHT && y <= RIM_HEIGHT + 1.5;
  return { x: BOARD_X, y, z, onSquare };
}

/** Sample a solved arc as world-space points from the release to the rim centre. */
export function arcPoints(
  from: { x: number; z: number },
  releaseFt: number,
  sol: ArcSolution,
  n = 40,
): [number, number, number][] {
  const rim = { x: D.basketX(-1), z: 0 };
  const dx = rim.x - from.x;
  const dz = rim.z - from.z;
  const dist = Math.hypot(dx, dz);
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const h = heightAt(f * dist, releaseFt, sol);
    pts.push([from.x + dx * f, h, from.z + dz * f]);
  }
  return pts;
}

/** Convenience: shooter measurements from a profile (inches) with fallbacks to
 *  the anthropometric defaults used by the 3D rig (6'6" SF ≈ 8.6 ft reach). */
export function measureFromProfile(p?: {
  standing_reach_in?: number;
  max_vertical_in?: number;
}): ShooterMeasure {
  return {
    standingReachFt: (p?.standing_reach_in ?? 103) / 12,
    maxVerticalFt: (p?.max_vertical_in ?? 32) / 12,
  };
}
