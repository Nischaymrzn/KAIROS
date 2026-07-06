/**
 * API DTOs — TypeScript mirrors of the backend's pydantic schemas
 * (backend/schemas/shot.py, analyze.py, api/routes/*). This file is the ONLY
 * place response/request shapes live; if the backend evolves (or a model is
 * swapped behind it), updates happen here and nowhere else.
 */

// ---- health / model metadata ----------------------------------------------------
export interface Health {
  status: string;
  model_version: number | string;
  model?: string;
  shot_auc?: number;
}

/** The frozen production bundle's manifest (models/production/vN/manifest.json).
 *  Read at runtime so the client NEVER hardcodes model facts. */
export interface ModelInfo {
  version: number | string;
  model?: string;
  calibration?: string;
  date?: string;
  test_metrics?: { auc?: number; brier?: number; accuracy?: number; n?: number };
  auc_delta_over_baseline?: number;
  /** Measured by running the served model, not read from a flag: does moving the
   *  defender change its output? True for v8, false for v7. */
  contest_sensitive?: boolean;
  [k: string]: unknown; // manifests may grow fields — tolerate, don't break
}

// ---- prediction ------------------------------------------------------------------
/** Court scenario — feet, hoop at x = -41.75 (the scene's native frame). */
export interface CourtScenario {
  x: number;
  z: number;
  shotType?: string;
  playerId?: number;
  positionGroup?: string;
  quarter?: number;
  minsLeft?: number;
  secsLeft?: number;
  defenderDistance?: number;
  shotClock?: number;
  scoreMargin?: number;
}

export interface ShotFactor {
  feature: string;
  contribution: number;
}

export interface Prediction {
  probability: number;
  quality: string; // "Excellent" | "Good" | "Average" | "Poor" | "Very Poor"
  factors?: ShotFactor[];
}

export interface BatchResponse {
  predictions: { probability: number; quality: string }[];
}

// ---- analytics --------------------------------------------------------------------
export interface ExploreRequest {
  shotType?: string;
  playerId?: number;
  positionGroup?: string;
  maxDist?: number;
  step?: number;
}

export interface HeatCell {
  x: number;
  z: number;
  probability: number;
  quality: string;
}

export interface ExploreResponse {
  shot_type: string;
  n: number;
  cells: HeatCell[];
  best: HeatCell | null;
}

export interface RankedShot {
  shot_type: string;
  probability: number;
  quality: string;
  expected_points: number;
  point_value: number;
}

export interface RankResponse {
  ranked: RankedShot[];
  best: RankedShot | null;
}

export interface ContestLevel {
  contest: string;
  defender_distance: number;
  probability: number;
  quality: string;
}

export interface DefendResponse {
  baseline: Record<string, unknown>;
  levels: ContestLevel[];
  contest_swing?: number | null;
  shot_class?: string | null;
  source?: string | null;
}

// ---- players (real profiles from the frozen model lookup) -------------------------
export interface PlayerProfile {
  height_in?: number;
  wingspan_in?: number;
  standing_reach_in?: number;
  max_vertical_in?: number;
  weight_lb?: number;
  experience_yrs?: number;
  avg_speed?: number;
  drives_pg?: number;
  drive_fg_pct?: number;
  catch_shoot_rate?: number;
  catch_shoot_fg_pct?: number;
  pull_up_rate?: number;
  pull_up_fg_pct?: number;
  paint_touches?: number;
  touches?: number;
}

export interface RosterPlayer {
  id: number;
  name: string | null;
  position: string | null;
  profile: PlayerProfile;
  /** which profile fields are league-median imputations, not real measurements */
  imputed: string[];
  /** "measured" = real combine/bio data; "league_imputed" = median placeholders
   *  (the player's SHOT-history features are still genuinely his) */
  bio_source?: "measured" | "league_imputed";
}

export interface RosterResponse {
  players: RosterPlayer[];
  total_known_ids: number;
}

// ---- model registry -----------------------------------------------------------------
export interface ModelBundle {
  key: string;
  family: string;
  active: boolean;
  label: string;
  serves: string[];
  manifest: Record<string, unknown> & {
    version?: number | string;
    model?: string;
    calibration?: string;
    date?: string;
    test_metrics?: { auc?: number; brier?: number; accuracy?: number; n?: number };
  };
}

export interface RegistryResponse {
  latest_core_version: number | string;
  bundles: ModelBundle[];
}

// ---- tracking study model (2015-16 real defender geometry) --------------------------
export interface TrackingScenario {
  shot_distance: number;
  is_3?: 0 | 1;
  player_id?: number;
  shot_clock?: number;
  release_height?: number;
  time_with_ball?: number;
  shooter_speed?: number;
  pre_def_dist?: number;
  pre_def_dist_2?: number;
  pre_def_angle?: number;
  pre_help_defenders?: number;
  pre_closing_speed?: number;
}

export interface TrackingPrediction {
  probability: number;
  quality: string;
  model?: string;
  [k: string]: unknown;
}

// ---- game / challenge ----------------------------------------------------------------
export interface GameSession {
  id: number;
  name: string;
  streak: number;
  best_streak: number;
  level: number;
  xp: number;
  attempts: number;
  created_at: string;
}

export interface DailyChallenge {
  id: number;
  day: string;
  shot_type: string;
  zone: string;
  target_prob: number;
  description: string;
}

export interface AttemptResult {
  prediction: { probability: number; quality: string; factors?: ShotFactor[] };
  passed: boolean;
  xp_awarded: number;
  attempt_id: number;
  session: GameSession;
  badges: string[];
}

export interface SavedShot {
  id: number;
  label: string;
  x: number;
  z: number;
  shot_type: string;
  player_id: number;
  make_prob: number;
  created_at: string;
}

// ---- movement ----------------------------------------------------------------------
/** Raw waypoint in the model's chart frame (x lateral, y = feet from basket).
 *  Convert with `waypointToWorld` before rendering. */
export interface ChartWaypoint {
  x: number;
  y: number;
}

export interface MoveResponse {
  move_type: string;
  confidence: number;
  method?: string;
  waypoints: ChartWaypoint[];
  /** set when the path is THIS player's own tracked movement, not a league template */
  player_id?: number | null;
  n_sequences?: number;
  /** contest tier the returned path was actually drawn from */
  pressure?: string;
  /** tier that was asked for — differs when the player has none in that band */
  pressure_requested?: string;
  release_gap_ft?: number;
  stats?: Record<string, number>;
  /** why a league path was served instead of this player's */
  fallback_reason?: string | null;
}


// ---- real tracked replays (2015-16 SportVU) -------------------------------
//
// A clip is one shot with every player and the ball for the seconds into the
// release. Frames are flat so the payload stays small:
//   [gameClock, shotClock, ballX, ballZ, ballHeight, p0x, p0z, ... p9x, p9z]
// Player order matches `lineup`. Positions are already in the court frame.
export type ReplayFrame = number[];

export interface ReplayPlayer {
  id: number;
  jersey: string;
  name: string;
  side: "home" | "away";
}

export interface ReplayPlay {
  gameId: number;
  eventId: number;
  date: string;
  home: string;
  away: string;
  period: number;
  action: string;
  distance: number;
  made: boolean;
  shooterId: number;
  frames: number;
}

export interface ReplayDetail {
  gameId: number;
  eventId: number;
  date: string;
  home: { abbr: string; name: string };
  away: { abbr: string; name: string };
  period: number;
  action: string;
  distance: number;
  made: boolean;
  shooterId: number;
  lineup: ReplayPlayer[];
  frames: ReplayFrame[];
}

export interface ReplayList {
  total: number;
  plays: ReplayPlay[];
}


// ---- game plan (aggregated tracked outcomes) ------------------------------
export interface PlanCell { makeRate: number; n: number }

/** One delivery cell: an observed make rate over n tracked releases. */
export interface DeliveryCell {
  makeRate: number;
  n: number;
}

/**
 * How a shot is best DELIVERED, from the tracked corpus.
 *
 * `swingPts` is null when either side of the comparison is below the sample
 * floor, which is the service refusing to draw a conclusion rather than a
 * missing value. Read it as "not enough tracked shots here to say".
 */
export interface Delivery {
  band: string;
  bandLabel: string;
  hold: {
    rows: Record<string, DeliveryCell>;
    /** catch-and-shoot minus held, in points of make rate */
    swingPts: number | null;
    bands: { key: string; label: string }[];
  };
  feet: {
    rows: Record<string, DeliveryCell>;
    /** set minus on-the-move, in points of make rate */
    swingPts: number | null;
    bands: { key: string; label: string }[];
  };
  /** the finding worth stating outright: momentum helps at the rim, hurts from range */
  inversion: {
    rimSetVsMoving: number | null;
    threeSetVsMoving: number | null;
  };
  holdGrid: Record<string, Record<string, DeliveryCell>>;
  feetGrid: Record<string, Record<string, DeliveryCell>>;
  distanceBands: { key: string; label: string }[];
  totalPlays: number;
  minN: number;
  source: string;
}

export interface GamePlan {
  band: string;
  bandLabel: string;
  contest: string;
  contestLabel: string;
  observed: PlanCell | null;
  /** what getting open is worth at THIS range, in points of make rate */
  contestValuePts: number | null;
  /** the same figure at the rim, as the contrast */
  rimContestValuePts: number | null;
  grid: Record<string, Record<string, PlanCell>>;
  bands: {
    distance: { key: string; label: string; lo: number; hi: number }[];
    contest: { key: string; label: string; lo: number; hi: number }[];
  };
  totalPlays: number;
  source: string;
}
