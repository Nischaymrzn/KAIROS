/**
 * SCENARIO SCHEMA — the single source of truth for a shot situation.
 *
 * Every field a user can touch is declared here with its DATA LAYER, because
 * the difference matters more than the value:
 *
 *   model    the trained shot model receives this and learned from it.
 *   context  the model cannot see it; a separately measured adjustment is
 *            applied after prediction and labelled as such.
 *   physics  geometry and visualisation only. It changes the trajectory, the
 *            entry angle and the rim projection. It never changes the
 *            probability, and the UI must never imply that it does.
 *
 * The rule this encodes: a control that looks like it feeds the model, but
 * cannot, is worse than no control at all.
 *
 * `defenderDistance` was that control under v7 and is NOT any longer. Per-shot
 * defender distance is public only for 2014-15 and 2015-16, so whether the model
 * can use it depends entirely on the training window. v7 trained on 2021-22 to
 * 2023-24, where the column is constant, so it was dropped and sweeping the
 * control moved nothing. v8 trains on 2014-15 to 2023-24, which includes both
 * seasons, so the feature varies and the model splits on it. Measured against the
 * served v8 bundle, a 26 ft pull-up sweeps 0.3675 at 1 ft to 0.4230 at 12 ft.
 *
 * The layer below is therefore resolved AT RUNTIME from `/model-info`, which
 * probes the loaded model rather than reading a flag. Hardcoding it is what let
 * the UI spend a whole model version telling users a working control was inert.
 */
import { basketX } from "../constants/dimensions";

export const HOOP_X = basketX(-1); // -41.75 ft, the attacking rim
export const THREE_ARC_FT = 23.75;
export const CORNER_THREE_FT = 22;

export type DataLayer = "model" | "context" | "physics";

export interface FieldMeta {
  layer: DataLayer;
  label: string;
  /** why it sits in that layer — surfaced in the UI, not just a comment */
  note: string;
}

export const FIELDS: Record<string, FieldMeta> = {
  // ---- model features ------------------------------------------------------
  x: { layer: "model", label: "Court position", note: "Shot coordinates are the model's strongest feature." },
  z: { layer: "model", label: "Court position", note: "Shot coordinates are the model's strongest feature." },
  shotType: { layer: "model", label: "Shot type", note: "Action type is a 48-level categorical the model learned directly." },
  playerId: { layer: "model", label: "Player", note: "Player identity carries tracking-derived rates and shooting history." },
  positionGroup: { layer: "model", label: "Position", note: "Guard / forward / centre, a model categorical." },
  shotClock: { layer: "model", label: "Shot clock", note: "Possession context was the only situational group to pass the ablation gate, at +0.0015 AUC." },
  quarter: { layer: "model", label: "Period", note: "Model feature, though game state proved near-null on its own." },
  scoreMargin: { layer: "model", label: "Score margin", note: "Model feature, but measured null: it correlates 0.0014 with the outcome." },

  // ---- contest -------------------------------------------------------------
  // Declared "model" because the served bundle is v8, whose window includes the
  // two seasons where per-shot defender distance exists. `contestIsLive()` below
  // re-resolves this from the running model, so serving an older bundle
  // downgrades the label instead of leaving a false claim on screen.
  defenderDistance: {
    layer: "model",
    label: "Defender distance",
    note: "A live model feature under v8. Per-shot defender distance is public only for 2014-15 and 2015-16, and v8 trains across both, so the model splits on it directly. Measured on the served bundle, a 26 ft pull-up moves from 0.3675 at 1 ft to 0.4230 at 12 ft.",
  },

  // ---- physics / visualisation only ---------------------------------------
  jumpAngle: { layer: "physics", label: "Jump angle", note: "Sets the arc and therefore the entry angle and rim target. The model never sees the arc." },
  releaseHeight: { layer: "physics", label: "Release height", note: "Changes the ballistic solution and the contest geometry. Not a model feature." },
  approachAngle: { layer: "physics", label: "Approach angle", note: "Foreshortens the rim by cos(angle). Geometry only." },
  handPlacement: { layer: "physics", label: "Hand placement", note: "Affects release point and spin in the visualisation. Not a model feature." },
  dribbles: { layer: "physics", label: "Dribbles", note: "Constant across the production window (public for 2014-15 only), so it was dropped with the dead group." },
  touchTime: { layer: "physics", label: "Touch time", note: "Constant across the production window, dropped with the dead group." },
};

/**
 * Whether the SERVED model responds to defender distance. Resolved from
 * `/model-info`, which measures it by running the model, so the UI's claim is a
 * property of the loaded bundle rather than of this source file.
 *
 * Optimistic default: production is v8 and v8 is contest-sensitive, so the
 * control is live until the backend says otherwise. The offline heuristic also
 * responds to contest, so the control is never inert even with no backend at all.
 */
let contestLive = true;

export const contestIsLive = () => contestLive;

export function setContestLive(live: boolean) {
  contestLive = live;
  FIELDS.defenderDistance.layer = live ? "model" : "context";
  FIELDS.defenderDistance.note = live
    ? "A live model feature under v8. Per-shot defender distance is public only for 2014-15 and 2015-16, and v8 trains across both, so the model splits on it directly."
    : "The served bundle was trained on a window where per-shot defender distance is constant, so the model cannot respond to it. The measured 2014-15 contest curve is applied after prediction and labelled as an adjustment.";
}

export const layerOf = (field: string): DataLayer => FIELDS[field]?.layer ?? "physics";

// -------------------------------------------------------------- the scenario

export type ShotVerb =
  | "catch_shoot" | "pullup" | "stepback" | "fadeaway" | "floater"
  | "driving_layup" | "layup" | "hook" | "dunk";

export type ReleaseHeight = "Low" | "Medium" | "High";
export type HandPlacement = "One Hand" | "Two Hand" | "Finger Roll" | "Hook";
export type DefenderRole = "primary" | "help" | "trailing";

export interface DefenderSpot {
  id: string;
  x: number;
  z: number;
  role: DefenderRole;
}

export interface Scenario {
  player: { playerId: number; positionGroup: string; name?: string };
  shot: { x: number; z: number; shotType: ShotVerb };
  game: { quarter: number; shotClock: number; scoreMargin: number };
  defenders: DefenderSpot[];
  mechanics: {
    jumpAngle: number;
    releaseHeight: ReleaseHeight;
    handPlacement: HandPlacement;
    approachAngle: number;
    dribbles: number;
    touchTime: number;
  };
}

export const DEFAULT_SCENARIO: Scenario = {
  player: { playerId: 0, positionGroup: "G" },
  shot: { x: -26, z: 1.5, shotType: "pullup" },
  game: { quarter: 1, shotClock: 12, scoreMargin: 0 },
  defenders: [],
  mechanics: {
    jumpAngle: 48, releaseHeight: "Medium", handPlacement: "Two Hand",
    approachAngle: 0, dribbles: 2, touchTime: 2.5,
  },
};

// ------------------------------------------------------------- derived values

export const shotDistance = (s: Scenario) =>
  Math.hypot(s.shot.x - HOOP_X, s.shot.z);

export type ZoneId = "restricted" | "paint" | "midrange" | "corner3" | "break3";

export const ZONE_LABEL: Record<ZoneId, string> = {
  restricted: "Restricted Area",
  paint: "Paint (non-RA)",
  midrange: "Mid-Range",
  corner3: "Corner 3",
  break3: "Above the Break 3",
};

/** League make rate and point value per zone, for the xP comparison. */
export const ZONE_BASE: Record<ZoneId, { rate: number; points: number }> = {
  restricted: { rate: 0.638, points: 2 },
  paint: { rate: 0.423, points: 2 },
  midrange: { rate: 0.406, points: 2 },
  corner3: { rate: 0.387, points: 3 },
  break3: { rate: 0.352, points: 3 },
};

export function zoneOf(s: Scenario): ZoneId {
  const depth = s.shot.x - HOOP_X;
  const lateral = Math.abs(s.shot.z);
  const dist = Math.hypot(depth, s.shot.z);
  const corner = lateral >= CORNER_THREE_FT && depth <= 14;
  if (dist >= THREE_ARC_FT || (corner && dist >= CORNER_THREE_FT)) {
    return corner ? "corner3" : "break3";
  }
  if (dist < 4) return "restricted";
  if (lateral <= 8 && depth <= 19) return "paint";
  return "midrange";
}

export const pointValue = (s: Scenario) => ZONE_BASE[zoneOf(s)].points;
export const expectedPoints = (s: Scenario, probability: number) =>
  probability * pointValue(s);

/** Contest geometry of the placed defenders, relative to the shooter. */
export function contest(s: Scenario) {
  if (s.defenders.length === 0) {
    return { closest: null as number | null, second: null as number | null, angle: null as number | null, helpers: 0 };
  }
  const ranked = s.defenders
    .map((d) => ({ d, dist: Math.hypot(d.x - s.shot.x, d.z - s.shot.z) }))
    .sort((a, b) => a.dist - b.dist);

  const near = ranked[0];
  // angle between shooter->defender and shooter->rim: 0 means directly in the line
  const toRim = Math.atan2(0 - s.shot.z, HOOP_X - s.shot.x);
  const toDef = Math.atan2(near.d.z - s.shot.z, near.d.x - s.shot.x);
  let angle = Math.abs(((toDef - toRim) * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;

  return {
    closest: near.dist,
    second: ranked[1]?.dist ?? null,
    angle,
    helpers: Math.min(ranked.length - 1, 5),
  };
}

// --------------------------------------------------------- backend payload

export interface CourtPayload {
  x: number;
  z: number;
  shotType: ShotVerb;
  playerId: number;
  positionGroup: string;
  quarter: number;
  shotClock: number;
  scoreMargin: number;
  defenderDistance?: number;
}

/**
 * Only fields the backend actually accepts. Mechanics are deliberately absent:
 * sending them would be silently ignored by the schema and would imply to
 * anyone reading the network tab that the model consumes them.
 */
/**
 * What an EMPTY FLOOR means, in feet.
 *
 * This is the fix for the most reported bug in the app: placing a defender did
 * not change the probability.
 *
 * The payload used to OMIT defenderDistance when nobody was placed. The model
 * then imputes the training median for the missing column, and measured on the
 * served bundle that imputation lands at 0.3910 for a 26 ft pull-up, which is
 * exactly what a defender standing at three to four feet scores. So an empty
 * floor was being read as "averagely guarded", and putting a body down at a
 * normal contest distance moved the number by nothing at all. The user was right
 * every time they said it did not work.
 *
 * An empty floor is not an average contest. It is an open shot, and it is scored
 * as one. The offline heuristic already said so in as many words, so the two
 * paths were also disagreeing about the same situation.
 *
 * Eleven feet is the top band of the measured 2014-15 contest curve, past which
 * observed make rate stops climbing.
 */
export const OPEN_FLOOR_FT = 11;

export function toCourtPayload(s: Scenario): CourtPayload {
  const c = contest(s);
  return {
    x: s.shot.x,
    z: s.shot.z,
    shotType: s.shot.shotType,
    playerId: s.player.playerId,
    positionGroup: s.player.positionGroup,
    quarter: s.game.quarter,
    shotClock: s.game.shotClock,
    scoreMargin: s.game.scoreMargin,
    // Always sent. Omitting it is what let the model impute a contest nobody asked
    // for and made the defender control look broken.
    defenderDistance:
      c.closest != null ? Number(c.closest.toFixed(2)) : OPEN_FLOOR_FT,
  };
}

/** Stable key for caching and for detecting a real change. */
export const scenarioKey = (s: Scenario) => JSON.stringify(toCourtPayload(s));
