/**
 * Mock data used whenever the API is unreachable, so every page renders fully.
 *
 * The numbers are the project's real measured values, not invented ones:
 * league make rates come from 2,524,865 NBA shots (reports/EDA.md) and the model
 * figures from models/production/v8/manifest.json. Keeping them honest means a
 * screenshot taken offline still tells the truth.
 */

export const MODEL_STATS = {
  version: 8,
  model: "CatBoost",
  test_auc: 0.7009,
  test_brier: 0.2134,
  accuracy: 0.6504,
  base_rate: 0.471,
  baseline_auc: 0.6369,
  bss: 0.1434,
  baseline_bss: 0.0660,
  ece: 0.0080,
  shots_trained: 2086191,
  shots_tested: 219157,
  seasons: "2014-15 → 2025-26",
};

export const SHOT_TYPES = [
  {
    group: "Layups",
    items: [
      { id: "driving_layup", label: "Driving layup", rate: 0.507 },
      { id: "running_layup", label: "Running layup", rate: 0.624 },
      { id: "finger_roll", label: "Finger roll", rate: 0.648 },
      { id: "putback", label: "Putback layup", rate: 0.56 },
      { id: "reverse_layup", label: "Reverse layup", rate: 0.46 },
      { id: "tip_in", label: "Tip-in", rate: 0.52 },
    ],
  },
  {
    group: "Jump Shots",
    items: [
      { id: "catch_shoot", label: "Catch and shoot", rate: 0.35 },
      { id: "pullup", label: "Pull-up jump shot", rate: 0.418 },
      { id: "stepback", label: "Step-back jump shot", rate: 0.4 },
      { id: "midrange", label: "Mid-range", rate: 0.406 },
      { id: "corner3", label: "Corner three", rate: 0.387 },
      { id: "above_break3", label: "Above the break three", rate: 0.352 },
    ],
  },
  {
    group: "Specialty Shots",
    items: [
      { id: "fadeaway", label: "Fadeaway", rate: 0.38 },
      { id: "floater", label: "Floater", rate: 0.431 },
      { id: "runner", label: "Runner", rate: 0.43 },
      { id: "hook", label: "Hook shot", rate: 0.44 },
      { id: "bank", label: "Bank shot", rate: 0.45 },
      { id: "dunk", label: "Dunk", rate: 0.892 },
    ],
  },
];

export const ALL_SHOT_TYPES = SHOT_TYPES.flatMap((g) => g.items);

export const POSITIONS = [
  { id: "PG", label: "Point Guard" },
  { id: "SG", label: "Shooting Guard" },
  { id: "SF", label: "Small Forward" },
  { id: "PF", label: "Power Forward" },
  { id: "C", label: "Centre" },
];

/** Measured league make rate per zone (reports/EDA.md). */
export const ZONES = {
  restricted: { label: "Restricted Area", rate: 0.638, points: 2 },
  paint: { label: "Paint", rate: 0.423, points: 2 },
  midrange: { label: "Mid-Range", rate: 0.406, points: 2 },
  corner3: { label: "Corner 3", rate: 0.387, points: 3 },
  break3: { label: "Above Break 3", rate: 0.352, points: 3 },
};

export const MOCK_PREDICTION = {
  probability: 0.52,
  quality_label: "Average",
  zone_average: 0.47,
  expected_points: 1.04,
  shap_values: [
    { feature: "Shot Distance", value: -0.19, direction: "negative" },
    { feature: "Defender Distance", value: 0.09, direction: "positive" },
    { feature: "Zone FG%", value: -0.07, direction: "negative" },
    { feature: "Shot Clock", value: -0.04, direction: "negative" },
    { feature: "Player Skill", value: 0.03, direction: "positive" },
  ],
};

/**
 * Feature importance. Ordering and the possession/shot-clock figure come from
 * the measured ablation (reports/figures/ablation.json): possession context is
 * worth +0.0232 val AUC and was the only enrichment family of nine that moved
 * the model.
 */
export const FEATURE_IMPORTANCE = [
  { name: "Shot Distance", importance: 1.0, description: "Correlates 0.219 with the outcome, by far the strongest single feature." },
  { name: "Shot Zone FG%", importance: 0.72, description: "The train-fit zone baseline the model starts from." },
  { name: "Shot Clock", importance: 0.46, description: "Possession context was worth +0.0232 val AUC, the only enrichment of nine that helped. Make rate runs 43% with 0-4s left to 61% with 20-24s." },
  { name: "Action Type", importance: 0.41, description: "Dunk vs jump shot vs layup. Captures much of the contest signal indirectly." },
  { name: "Player 3P%", importance: 0.28, description: "Train-fit shooter skill. Lifted 3PT discrimination from 0.534 to 0.559." },
  { name: "Player FG%", importance: 0.26, description: "Historical make rate for this shooter." },
  { name: "Shot Angle", importance: 0.18, description: "Angle from the baseline. Corners differ from the wings." },
  { name: "Transition", importance: 0.12, description: "Transition shots make 0.519 versus 0.455 in the half court." },
  { name: "Catch & Shoot FG%", importance: 0.09, description: "Tracking tendency from leaguedashptstats." },
  { name: "Period", importance: 0.04, description: "Weak. Game state governs shot selection, not whether one falls." },
];

export const MOCK_PLAYER = {
  name: "Stephen Curry",
  position: "PG",
  team: "Golden State Warriors",
  height_in: 74,
  weight_lb: 185,
  experience: 15,
  fg_pct: 0.453,
  fg3_pct: 0.408,
  ts_pct: 0.625,
  usage: 0.292,
  tendencies: ["Three-point specialist", "Catch-and-shoot", "Off-ball movement"],
  zones: [
    { zone: "restricted", attempts: 182, actual: 0.612, predicted: 0.598 },
    { zone: "paint", attempts: 96, actual: 0.441, predicted: 0.432 },
    { zone: "midrange", attempts: 74, actual: 0.451, predicted: 0.418 },
    { zone: "corner3", attempts: 118, actual: 0.441, predicted: 0.412 },
    { zone: "break3", attempts: 604, actual: 0.401, predicted: 0.388 },
  ],
};

export const MOCK_CHALLENGE = {
  id: "2026-08-11",
  x: -22,
  z: 16,
  shot_type: "catch_shoot",
  defender_distance: 4.5,
  shot_clock: 8,
  period: 4,
  score_margin: -3,
  probability: 0.412,
  zone: "break3",
};
