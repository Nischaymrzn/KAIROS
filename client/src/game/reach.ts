/**
 * REACH — how far from the rim each action is actually available, in feet.
 *
 * This is the one place the system knows something the trained model does not.
 *
 * The model will happily score a dunk from twenty-six feet: a dunk converts at
 * about 88 per cent everywhere it appears in the training data, and nothing in
 * the feature set encodes that a player cannot take off from the arc. Asked what
 * would improve a mid-range pull-up, the coach's honest answer from the model was
 * "take a dunk instead" — a true statement about the model, and useless advice to
 * a person.
 *
 * Stated as data rather than buried in a condition, so it can be read, argued
 * with and tested. It constrains SUGGESTIONS only: a user who wants to select a
 * dunk from half court is still free to, and the model will still score it.
 */
import type { ShotVerb } from "../scenario/schema";

export const REACH: Record<ShotVerb, number> = {
  dunk: 4,
  layup: 8,
  driving_layup: 11,
  floater: 15,
  hook: 12,
  fadeaway: 26,
  stepback: 30,
  pullup: 32,
  catch_shoot: 32,
};

/** Can this action plausibly be taken from `distFt` out? */
export const withinReach = (verb: ShotVerb, distFt: number) => distFt <= REACH[verb];

/** The actions available from a given distance. */
export const reachableFrom = (distFt: number) =>
  (Object.keys(REACH) as ShotVerb[]).filter((v) => withinReach(v, distFt));
