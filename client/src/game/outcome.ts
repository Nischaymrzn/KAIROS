/**
 * OUTCOME — turning a calibrated probability into a made or missed shot.
 *
 * This is the piece that makes practice mean anything: the user takes a shot, the
 * model says 43 per cent, and the ball has to actually go in 43 per cent of the
 * time. Anything else teaches the wrong lesson.
 *
 * WHY A SEEDED GENERATOR RATHER THAN Math.random()
 * A replay has to reproduce its own result. The film room re-runs a recorded shot
 * and it must land the same way it landed the first time, otherwise the replay is
 * a different shot wearing the same label. Each attempt therefore carries a seed,
 * and the outcome is a pure function of (seed, probability).
 *
 * WHY THE SCORE IS NOT THE OUTCOME
 * The whole argument of the project is that field-goal percentage is a bad
 * measure because it treats a good shot that rimmed out the same as a bad shot
 * that fell. A game that scored makes would reproduce exactly the error the
 * system exists to correct, and would teach users to chase layups. So scoring
 * runs on expected points — the quality of the decision — and the make or miss is
 * shown beside it as the thing that did not determine the score. Users learn the
 * difference by watching the two numbers disagree.
 */

/**
 * THE CANONICAL PER-SHOT ROLL.
 *
 * ShotArc decides whether the ball drops through the net or rattles out, and the
 * game layer decides whether the attempt counts as a make. If those two sampled
 * independently the HUD would congratulate the user on a shot they just watched
 * bounce off the back iron. They must be the same draw, so it is defined once
 * here and imported by both.
 *
 * Keyed on `shootSignal`, which increments per fired shot, so the result is
 * stable for the lifetime of that shot and a replay of it agrees.
 */
export function shotRoll(signal: number): number {
  const s = Math.sin(signal * 7.13 * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Did the shot fired under `signal` go in, given the model's probability. */
export const madeFor = (signal: number, probability: number) => shotRoll(signal) < probability;

/** Mulberry32 — small, fast, and good enough that streaks look like streaks. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Attempt {
  /** what the model said before the ball left the hand */
  probability: number;
  /** 2 or 3 */
  points: number;
  /** did it go in */
  made: boolean;
  /** the roll that decided it, kept so a replay reproduces the result */
  seed: number;
  /** how far off the rim a miss was, 0-1, for the visual only */
  missBy: number;
}

/**
 * Resolve one attempt. `missBy` is derived from how far the roll cleared the
 * threshold, so a shot that missed narrowly rattles out and one that missed badly
 * is not close — the visual carries information rather than being random dressing.
 *
 * `seed` is the shot's `shootSignal`, so the roll is the same one ShotArc used to
 * fly the ball. Passing anything else here re-rolls the shot and the score stops
 * matching what the user watched.
 */
export function resolve(probability: number, points: number, seed: number): Attempt {
  const roll = shotRoll(seed);
  const made = roll < probability;
  const margin = made ? (probability - roll) / (probability || 1) : (roll - probability) / (1 - probability || 1);
  return {
    probability,
    points,
    made,
    seed,
    missBy: made ? 0 : Math.min(Math.max(margin, 0), 1),
  };
}

/** A fresh seed for a live attempt. */
export const newSeed = () => (Math.random() * 0xffffffff) >>> 0;

// ---------------------------------------------------------------- scoring

/**
 * Decision score for one attempt, in points per 100 possessions above the league
 * baseline for that zone. This is the number the game ranks on.
 *
 * The user is rewarded for taking a shot whose expected value beats what an
 * average possession from that zone returns, and penalised for taking one that
 * does not. Whether it went in is irrelevant here by design.
 */
export function decisionScore(probability: number, points: number, zoneRate: number): number {
  const expected = probability * points;
  const baseline = zoneRate * points;
  return Math.round((expected - baseline) * 100);
}

/** Expected points for the attempt. */
export const expectedPoints = (probability: number, points: number) => probability * points;

/**
 * How lucky the session has been: actual points scored minus expected points.
 * Positive means the ball fell more than the shots deserved. Over a long enough
 * session this trends to zero, and watching it do that is the clearest
 * demonstration the system offers of why outcome is a poor measure of quality.
 */
export function luck(attempts: Attempt[]): number {
  let actual = 0;
  let expected = 0;
  for (const a of attempts) {
    if (a.made) actual += a.points;
    expected += a.probability * a.points;
  }
  return actual - expected;
}
