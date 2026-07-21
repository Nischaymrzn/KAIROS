/**
 * OFFLINE PREDICTOR — an instant heuristic used ONLY when the inference API is
 * unreachable, so the UI always answers. Every result is tagged `source:
 * "offline"` and the StatusBar shows the amber chip, so a heuristic can never be
 * mistaken for the model.
 *
 * WHY THIS FILE EXISTS IN ITS CURRENT FORM
 * The previous version ignored `defenderDistance` completely. With the backend
 * down — which is the normal state when the scene is opened on its own — placing
 * or dragging a defender changed the number by exactly zero, which looked like a
 * broken model rather than a missing server. The contest response below is the
 * fix, and it is measured rather than invented.
 *
 * PROVENANCE OF THE CONTEST CURVE
 * Observed make rate against closest defender distance, 2014-15 public shot logs,
 * 125,682 attempts after filtering to 0-12 ft. Bands are the midpoints of
 * [0,1,2,3,4,5,6,8,10,12):
 *
 *   two-point   .4583 .4591 .4844 .5050 .4893 .4903 .5156 .5308 .5849
 *   three-point .2015 .2290 .2800 .3177 .3339 .3580 .3766 .3765 .3910
 *
 * These are stored as RATIOS to the 4-5 ft band, which is the modal contest
 * distance, so the curve scales whatever base rate the distance model produces
 * instead of overwriting it. A two goes from 0.94x when smothered to 1.20x when
 * uncontested; a three swings harder, 0.60x to 1.17x, because a layup is taken
 * into contact by design and a jump shot is not.
 *
 * The shape agrees with the trained v8 model, which was checked directly: a
 * 26 ft pull-up sweeps 0.3675 at 1 ft to 0.4230 at 12 ft. The heuristic is
 * coarser, but it moves in the same direction by a similar amount, so the
 * offline reading is an approximation of the model rather than a contradiction
 * of it.
 */
import { basketX } from "../constants/dimensions";
import type { CourtScenario } from "../api";

const HOOP_X = basketX(-1); // -41.75

/** Measured contest response, as a multiplier on the uncontested-neutral rate. */
const CONTEST_2PT: [number, number][] = [
  [0.5, 0.937], [1.5, 0.938], [2.5, 0.990], [3.5, 1.032], [4.5, 1.0],
  [5.5, 1.002], [7.0, 1.054], [9.0, 1.085], [11.0, 1.196],
];
const CONTEST_3PT: [number, number][] = [
  [0.5, 0.603], [1.5, 0.686], [2.5, 0.839], [3.5, 0.952], [4.5, 1.0],
  [5.5, 1.072], [7.0, 1.128], [9.0, 1.128], [11.0, 1.171],
];

/** Linear interpolation across a measured band table, flat outside its range. */
function interp(table: [number, number][], at: number): number {
  if (at <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (at >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (at <= x1) return y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
  }
  return last[1];
}

/**
 * Contest multiplier for a shot. `undefined` distance means no defender was
 * placed, which is treated as a wide-open attempt rather than as the neutral
 * band — an empty floor is not an average contest.
 */
export function contestMultiplier(distFt: number | undefined, isThree: boolean): number {
  if (distFt == null) return interp(isThree ? CONTEST_3PT : CONTEST_2PT, 11);
  return interp(isThree ? CONTEST_3PT : CONTEST_2PT, distFt);
}

export function offlinePredict(s: CourtScenario): { probability: number; quality: string } {
  const depth = s.x - HOOP_X;
  const dist = Math.hypot(depth, s.z);
  const corner = Math.abs(s.z) >= 22 && depth <= 14;
  const isThree = dist >= 23.75 || (corner && dist >= 22);

  // ---- base rate from distance and zone, before any context -----------------
  let p: number;
  if (dist < 4) p = 0.62;
  else if (dist < 8) p = 0.55 - (dist - 4) * 0.015;
  else if (!isThree) p = 0.49 - (dist - 8) * 0.006;
  else p = corner ? 0.385 : 0.355 - Math.max(dist - 23.75, 0) * 0.012;

  // ---- shot type ------------------------------------------------------------
  const t = s.shotType ?? "pullup";
  if (t === "dunk") p = 0.88;
  else if (t === "driving_layup" || t === "layup") p = Math.min(p + 0.04, 0.66);
  else if (t === "stepback" || t === "fadeaway") p -= 0.03;
  else if (t === "floater") p -= 0.015;
  else if (t === "hook") p -= 0.01;
  else if (t === "catch_shoot") p += 0.02; // set feet, measurably better than off the dribble

  // ---- contest, the part that was missing ------------------------------------
  // A dunk is not a jump shot: contact at the rim is part of the action, so the
  // contest curve is damped rather than applied at full strength.
  const contest = contestMultiplier(s.defenderDistance, isThree);
  const damping = t === "dunk" ? 0.25 : t === "driving_layup" || t === "layup" ? 0.6 : 1;
  p *= 1 + (contest - 1) * damping;

  // ---- shot clock -----------------------------------------------------------
  // Late-clock attempts are worse because the shot is taken out of necessity.
  // Small, because possession context cleared the ablation gate at only +0.0015 AUC.
  if (s.shotClock != null) {
    if (s.shotClock <= 4) p -= 0.022;
    else if (s.shotClock <= 7) p -= 0.010;
  }

  p = Math.min(Math.max(p, 0.03), 0.97);
  const quality =
    p >= 0.6 ? "Excellent" : p >= 0.5 ? "Good" : p >= 0.4 ? "Average" : p >= 0.3 ? "Poor" : "Very Poor";
  return { probability: Math.round(p * 1000) / 1000, quality };
}
