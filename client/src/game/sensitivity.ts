/**
 * SENSITIVITY — how much each control actually moves this shot.
 *
 * WHY THIS EXISTS
 * Users change the score margin, watch a probability rounded to a whole number
 * not move, and conclude the control is broken. It is not broken. Measured on the
 * served v8 model at a 26 ft pull-up:
 *
 *   defender distance   0.3675 to 0.4230   a swing of 5.6 points
 *   shot clock          0.3902 to 0.4377   4.8 points, nearly all of it late
 *   period              0.3910 to 0.3947   0.4 points
 *   score margin        0.3910 at every value from -20 to +20, exactly nothing
 *
 * That is the model being honest about what it learned. Score margin correlates
 * 0.0014 with the outcome in the training data, so a model that moved on it would
 * be inventing a relationship that is not there.
 *
 * The wrong response is to fake sensitivity. The right one is to SHOW this, which
 * turns the complaint into the most useful thing on the page: a live, measured
 * answer to "does this actually matter for this shot", computed for the scenario
 * in front of the user rather than quoted from a table.
 */
import { predictScenarioOnce } from "../scenario/predictionEngine";
import type { Scenario } from "../scenario/schema";

export interface Swing {
  /** probability at the low end of the sweep */
  lo: number;
  /** probability at the high end */
  hi: number;
  /** hi minus lo, in probability points (0 to 100) */
  points: number;
}

const sweepOf = async (
  base: Scenario,
  variants: Scenario[],
  signal?: AbortSignal,
): Promise<Swing | null> => {
  const out = await Promise.all(
    variants.map((v) => predictScenarioOnce(v, signal).catch(() => null)),
  );
  const ps = out.filter((r): r is NonNullable<typeof r> => !!r).map((r) => r.probability);
  if (ps.length < 2) return null;
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  void base;
  return { lo, hi, points: (hi - lo) * 100 };
};

/** Move the nearest defender to `ft` along the shot line, in a copy. */
function withDefenderAt(s: Scenario, ft: number): Scenario {
  const dx = -41.75 - s.shot.x;
  const dz = 0 - s.shot.z;
  const len = Math.hypot(dx, dz) || 1;
  const x = s.shot.x + (dx / len) * ft;
  const z = s.shot.z + (dz / len) * ft;
  const rest = s.defenders.slice(1);
  return { ...s, defenders: [{ id: "probe", x, z, role: "primary" }, ...rest] };
}

export interface SensitivityResult {
  defender: Swing | null;
  shotClock: Swing | null;
  period: Swing | null;
  scoreMargin: Swing | null;
  action: Swing | null;
}

/**
 * Sweep every model input across its range for THIS scenario and report the
 * swing each one produces. About thirty predictions, all cached by the engine, so
 * repeating it as the user edits is cheap.
 */
export async function measureSensitivity(
  s: Scenario,
  signal?: AbortSignal,
): Promise<SensitivityResult> {
  const [defender, shotClock, period, scoreMargin, action] = await Promise.all([
    sweepOf(s, [1, 3, 6, 10].map((ft) => withDefenderAt(s, ft)), signal),
    sweepOf(s, [2, 8, 14, 22].map((sc) => ({ ...s, game: { ...s.game, shotClock: sc } })), signal),
    sweepOf(s, [1, 2, 3, 4].map((q) => ({ ...s, game: { ...s.game, quarter: q } })), signal),
    sweepOf(s, [-20, -6, 6, 20].map((m) => ({ ...s, game: { ...s.game, scoreMargin: m } })), signal),
    sweepOf(
      s,
      (["catch_shoot", "pullup", "stepback", "floater"] as const).map((v) => ({
        ...s,
        shot: { ...s.shot, shotType: v },
      })),
      signal,
    ),
  ]);
  return { defender, shotClock, period, scoreMargin, action };
}

/** Human summary of a swing, for a label beside its control. */
export function describeSwing(sw: Swing | null): { text: string; level: "high" | "some" | "none" } {
  if (!sw) return { text: "", level: "none" };
  if (sw.points < 0.15) return { text: "no effect on this shot", level: "none" };
  if (sw.points < 1.2) return { text: `moves it ${sw.points.toFixed(1)} pts`, level: "some" };
  return { text: `moves it ${sw.points.toFixed(1)} pts`, level: "high" };
}
