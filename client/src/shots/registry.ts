/**
 * SHOT REGISTRY — the single source of truth for every shot the platform teaches.
 *
 * ── WHY A REGISTRY AND NOT 21 PAGES ─────────────────────────────────────────
 * The brief lists 21 "shot types", but they are two orthogonal dimensions, and
 * the model already factorises exactly this way:
 *
 *   ACTION  (what the body does)  -> the model's ACTION_TYPE
 *   ZONE    (where you are)       -> the model's BASIC_ZONE
 *
 * "Corner Three" is not a sibling of "Fadeaway" — it is the other axis. A corner
 * three can be a catch-and-shoot, a pull-up, or a step-back. Encoding 21 flat
 * pages would duplicate every piece of mechanics content across locations and
 * fight the data model. So: a *shot* is an ACTION, playable across a set of
 * ZONES, and one template renders any (action, zone) pair.
 *
 * ── PROVENANCE IS PART OF THE TYPE ──────────────────────────────────────────
 * Two kinds of information live here and they must never be confused in the UI:
 *
 *   `leagueRate`  MEASURED. Real make rates from 2,524,865 NBA shots
 *                 (reports/EDA.md). Rendered as data.
 *   `coaching`    DOMAIN KNOWLEDGE. Standard coaching instruction. It is NOT a
 *                 model output and NOT personalised. Rendered with an explicit
 *                 "coaching guidance" treatment so a user never mistakes it for
 *                 analysis of their own shot.
 *
 * The platform has no camera, no pose estimation and no video. It cannot say
 * anything about *your* elbow. Anything that would require that is absent by
 * design — see `AI_CAPABILITY` at the bottom.
 *
 * ── ADDING A SHOT ───────────────────────────────────────────────────────────
 * Append one entry. No component changes. If it has an animation, set
 * `animationKey` to a key registered in `player/animation/sequences.ts`; if not,
 * leave it undefined and the viewer degrades to the static court diagram.
 */

/** Court zones, matching the model's BASIC_ZONE vocabulary exactly. */
export type ZoneId =
  | "restricted_area" | "paint" | "mid_range"
  | "corner_3" | "above_break_3" | "deep_3";

export interface Zone {
  id: ZoneId;
  label: string;
  /** MEASURED league make rate, 2014-2026, n = 2,524,865 (reports/EDA.md). */
  leagueRate: number;
  sampleSize: number;
  /** Representative court position in the shared feet frame (hoop at x=-41.75). */
  spot: { x: number; z: number };
  pointValue: 2 | 3;
}

export const ZONES: Record<ZoneId, Zone> = {
  restricted_area: { id: "restricted_area", label: "Restricted area", leagueRate: 0.638, sampleSize: 774093, spot: { x: -40.0, z: 0.5 }, pointValue: 2 },
  paint:           { id: "paint",           label: "Paint (non-RA)",  leagueRate: 0.423, sampleSize: 437109, spot: { x: -33.0, z: 3.0 }, pointValue: 2 },
  mid_range:       { id: "mid_range",       label: "Mid-range",       leagueRate: 0.406, sampleSize: 396210, spot: { x: -28.0, z: 8.0 }, pointValue: 2 },
  corner_3:        { id: "corner_3",        label: "Corner three",    leagueRate: 0.387, sampleSize: 224405, spot: { x: -39.0, z: 22.5 }, pointValue: 3 },
  above_break_3:   { id: "above_break_3",   label: "Above the break", leagueRate: 0.352, sampleSize: 688153, spot: { x: -16.5, z: 0.0 }, pointValue: 3 },
  deep_3:          { id: "deep_3",          label: "Deep three",      leagueRate: 0.220, sampleSize: 0,      spot: { x: -8.0,  z: 0.0 }, pointValue: 3 },
};

/** One phase of the shooting motion. `at` is a fraction of the total motion so a
 *  timeline can be rendered without knowing the animation's real duration, and
 *  the same data drives both the static diagram and the animated playback. */
export interface MechanicPhase {
  name: string;
  at: number;              // 0..1 through the motion
  body: string;            // what the body does
  cue: string;             // the short coaching cue for this phase
}

export interface Coaching {
  /** Ordered phases of the motion — drives the timeline component. */
  phases: MechanicPhase[];
  /** Things that go wrong, most common first. */
  mistakes: { fault: string; fix: string }[];
  /** Binary self-checks a player can actually verify without equipment. */
  checkpoints: string[];
}

export type ShotFamily = "jumper" | "finish" | "post" | "set";

export interface ShotAction {
  id: string;
  label: string;
  family: ShotFamily;
  /** One line, plain language — shown on the card and as the page subtitle. */
  summary: string;
  /** Verb sent to the backend adapter's ACTION_MAP. `null` = not in the model's
   *  vocabulary; the page must say so rather than silently scoring something
   *  else. (Free throws are the honest example: they are not field goals.) */
  backendVerb: string | null;
  /** Key in player/animation/sequences.ts, if an animation exists. */
  animationKey?: string;
  /** MEASURED league make rate for this action, or null where the corpus does
   *  not isolate it. Never invent one. */
  leagueRate: number | null;
  sampleSize: number | null;
  /** Zones where this action is actually played. Drives the zone switcher. */
  zones: ZoneId[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  coaching: Coaching;
}

export const SHOTS: ShotAction[] = [
  {
    id: "catch_shoot",
    label: "Catch & shoot",
    family: "jumper",
    summary: "Feet and hands ready before the pass arrives, so the catch flows straight into the release.",
    backendVerb: "catch_shoot",
    animationKey: "catch_shoot",
    leagueRate: 0.350,
    sampleSize: 920212,
    zones: ["mid_range", "corner_3", "above_break_3"],
    difficulty: 2,
    coaching: {
      phases: [
        { name: "Prepare", at: 0.00, body: "Feet set toward the rim, knees soft, hands up as a target before the ball leaves the passer.", cue: "Show your hands early" },
        { name: "Catch", at: 0.25, body: "Receive with the shooting hand already under the ball; no re-grip.", cue: "Catch it shot-ready" },
        { name: "Dip & rise", at: 0.45, body: "Short dip to the hip, then one continuous upward chain from ankles to wrist.", cue: "One motion, no pause" },
        { name: "Release", at: 0.72, body: "Ball leaves at the top of the rise, elbow under the ball, wrist snapping through.", cue: "Release at the top" },
        { name: "Follow through", at: 1.00, body: "Fingers point into the rim, hold until the ball lands.", cue: "Hold the finish" },
      ],
      mistakes: [
        { fault: "Catching flat-footed, then gathering", fix: "Set your feet while the ball is in the air — the catch should not start the motion." },
        { fault: "Thumb flick pushing the ball sideways", fix: "Guide hand comes off at release; it steadies, it never pushes." },
        { fault: "Drifting sideways on the jump", fix: "Land where you took off. Drift changes the distance mid-flight." },
      ],
      checkpoints: ["Feet set before the catch", "One continuous motion", "Land on the same spot", "Finish held to the landing"],
    },
  },
  {
    id: "pullup",
    label: "Pull-up jumper",
    family: "jumper",
    summary: "Create separation off the dribble and rise straight up from a controlled gather.",
    backendVerb: "pullup",
    animationKey: "pullup",
    leagueRate: 0.418,
    sampleSize: 253294,
    zones: ["paint", "mid_range", "above_break_3"],
    difficulty: 3,
    coaching: {
      phases: [
        { name: "Attack", at: 0.00, body: "Push the defender back with a downhill dribble to create the space you need.", cue: "Get him moving first" },
        { name: "Gather", at: 0.30, body: "Last dribble pulled hard into the hip pocket; feet gather under the shoulders.", cue: "Gather under yourself" },
        { name: "Rise", at: 0.55, body: "Jump straight up, not forward — momentum stays vertical.", cue: "Up, not out" },
        { name: "Release", at: 0.78, body: "Release at the apex with the same hand path as a stationary jumper.", cue: "Same shot, moving feet" },
        { name: "Land", at: 1.00, body: "Land balanced and square, ready to rebound.", cue: "Land square" },
      ],
      mistakes: [
        { fault: "Fading forward into the defender", fix: "Stop your momentum in the gather, not in the air." },
        { fault: "Rushing the release because a hand is near", fix: "The rise buys the space. Trust it and keep your normal rhythm." },
        { fault: "Feet landing wide and unbalanced", fix: "Gather with feet inside the shoulders." },
      ],
      checkpoints: ["Dribble pulled into the hip", "Vertical jump, no forward drift", "Same release as a set shot", "Balanced landing"],
    },
  },
  {
    id: "stepback",
    label: "Step-back",
    family: "jumper",
    summary: "Sell forward pressure, then push off hard to create backward separation before the rise.",
    backendVerb: "stepback",
    animationKey: "stepback",
    leagueRate: 0.400,
    sampleSize: 97644,
    zones: ["mid_range", "above_break_3", "deep_3"],
    difficulty: 5,
    coaching: {
      phases: [
        { name: "Sell", at: 0.00, body: "Attack downhill hard enough that the defender must commit forward.", cue: "Make him believe the drive" },
        { name: "Plant", at: 0.28, body: "Plant the inside foot and load it — this is the whole shot.", cue: "Load the front foot" },
        { name: "Push back", at: 0.50, body: "Drive off that foot away from the defender, ball swept to the hip.", cue: "Push, don't hop" },
        { name: "Rise", at: 0.72, body: "Absorb backward momentum in the legs and rise square to the rim.", cue: "Square up in the air" },
        { name: "Release", at: 0.88, body: "Slightly higher arc to clear the recovering hand.", cue: "Higher over the contest" },
      ],
      mistakes: [
        { fault: "Drifting so far back the shot comes up short", fix: "Separation is for the contest, not distance. One hard step, not two." },
        { fault: "Landing off balance on one foot", fix: "Absorb into both legs; the plant foot does the work, both feet land." },
        { fault: "Shoulders still turned at release", fix: "Square the chest to the rim before the ball leaves." },
      ],
      checkpoints: ["Defender committed forward", "One decisive push-off", "Shoulders square at release", "Both feet land together"],
    },
  },
  {
    id: "fadeaway",
    label: "Fadeaway",
    family: "post",
    summary: "Turn and lean away from the contest, trading balance for an untouchable release.",
    backendVerb: "fadeaway",
    animationKey: "fadeaway",
    leagueRate: null,
    sampleSize: null,
    zones: ["paint", "mid_range"],
    difficulty: 5,
    coaching: {
      phases: [
        { name: "Establish", at: 0.00, body: "Feel the defender with your back; know which shoulder is free.", cue: "Read him with your back" },
        { name: "Turn", at: 0.30, body: "Pivot toward the free shoulder, ball swept high and away from the reach.", cue: "Sweep it high" },
        { name: "Fade", at: 0.55, body: "Jump back and slightly across, creating a gap the arm cannot close.", cue: "Fade away, not sideways" },
        { name: "Release", at: 0.78, body: "Higher release point and extra arc to compensate for the backward drift.", cue: "More legs, more arc" },
        { name: "Land", at: 1.00, body: "Land softly on both feet, absorbing the backward momentum.", cue: "Soft landing" },
      ],
      mistakes: [
        { fault: "Fading so far the legs cannot reach the rim", fix: "The fade is inches, not feet. Shorten it until the ball reaches naturally." },
        { fault: "Shooting across the body", fix: "Keep the shooting shoulder aligned to the rim through the turn." },
        { fault: "Using it as a first option", fix: "This is a counter to pressure, not a primary shot. Its efficiency is low by design." },
      ],
      checkpoints: ["Defender located before turning", "Ball swept high", "Extra leg drive for the fade", "Both feet land"],
    },
  },
  {
    id: "driving_layup",
    label: "Driving layup",
    family: "finish",
    summary: "Attack the rim on the move and finish high off the glass or over the front rim.",
    backendVerb: "driving_layup",
    animationKey: "driving_layup",
    leagueRate: 0.507,
    sampleSize: 209047,
    zones: ["restricted_area", "paint"],
    difficulty: 1,
    coaching: {
      phases: [
        { name: "Attack", at: 0.00, body: "Get the defender's hip behind you — the angle decides the finish.", cue: "Win the hip" },
        { name: "Gather", at: 0.35, body: "Two-count gather: last dribble, inside foot, outside foot.", cue: "Long-short steps" },
        { name: "Rise", at: 0.60, body: "Drive the inside knee up hard; it protects the ball and adds height.", cue: "Knee to the ceiling" },
        { name: "Release", at: 0.80, body: "Lay it high off the square, fingertips soft.", cue: "High off the glass" },
        { name: "Land", at: 1.00, body: "Land under control, chest up.", cue: "Balanced finish" },
      ],
      mistakes: [
        { fault: "Taking off too far under the rim", fix: "Plant a step earlier — you want to rise into the glass, not past it." },
        { fault: "Throwing the ball at the backboard", fix: "Lay it, don't shoot it. Soft fingertips off the top corner of the square." },
        { fault: "Dropping the ball to the waist in traffic", fix: "Keep it high through the gather; the knee shields the low side." },
      ],
      checkpoints: ["Defender's hip behind you", "Two-count gather", "Inside knee driven up", "Ball placed high off the glass"],
    },
  },
  {
    id: "reverse_layup",
    label: "Reverse layup",
    family: "finish",
    summary: "Carry the ball under the rim and finish on the far side, using the hoop as the shield.",
    backendVerb: "layup",
    animationKey: "reverse_layup",
    leagueRate: 0.460,
    sampleSize: 126417,
    zones: ["restricted_area"],
    difficulty: 4,
    coaching: {
      phases: [
        { name: "Baseline drive", at: 0.00, body: "Attack along the baseline, forcing the help to commit on the near side.", cue: "Get under the rim" },
        { name: "Carry through", at: 0.35, body: "Take the ball under the backboard, protected by the rim itself.", cue: "Rim between you and him" },
        { name: "Extend", at: 0.60, body: "Reach across and scoop up on the far side, body arched away.", cue: "Reach across" },
        { name: "Release", at: 0.82, body: "Soft touch off the far lip or high off the far corner of the square.", cue: "Kiss the far side" },
        { name: "Land", at: 1.00, body: "Land beyond the rim, clear of the contact.", cue: "Land clear" },
      ],
      mistakes: [
        { fault: "Releasing too early, before clearing the rim", fix: "Let the rim pass your shoulder before you extend." },
        { fault: "Losing sight of the target", fix: "Turn the head — you should see the far corner of the square." },
        { fault: "Flat trajectory into the bottom of the rim", fix: "Scoop upward; the ball must rise onto the far lip." },
      ],
      checkpoints: ["Baseline angle taken", "Ball carried under the rim", "Head turned to the target", "Upward scoop, not a push"],
    },
  },
  {
    id: "floater",
    label: "Floater",
    family: "finish",
    summary: "A high, soft one-hander released early to clear a bigger defender before he can rise.",
    backendVerb: "floater",
    animationKey: "floater",
    leagueRate: 0.431,
    sampleSize: 92028,
    zones: ["paint", "mid_range"],
    difficulty: 4,
    coaching: {
      phases: [
        { name: "Attack the gap", at: 0.00, body: "Drive into the space between the guard and the help big.", cue: "Into the gap" },
        { name: "Early gather", at: 0.30, body: "Gather a full step earlier than a layup — before the big can set.", cue: "Shoot it early" },
        { name: "One-foot rise", at: 0.52, body: "Rise off the inside foot, opposite knee up for balance and protection.", cue: "One foot, knee up" },
        { name: "Release", at: 0.72, body: "Push the ball high and soft off the fingertips, well above the reach.", cue: "High and soft" },
        { name: "Land", at: 1.00, body: "Land balanced, ready to follow the miss.", cue: "Follow your shot" },
      ],
      mistakes: [
        { fault: "Releasing flat so the big blocks it", fix: "Arc is the whole shot. If it can be touched, it was too low." },
        { fault: "Drifting sideways under the rim", fix: "Rise into the gap, not across it." },
        { fault: "Using the wrist like a jump shot", fix: "It is a push-and-lift from the fingers, not a snap." },
      ],
      checkpoints: ["Gathered a step early", "Off one foot", "Released above the contest", "Ball peaks well above the square"],
    },
  },
  {
    id: "hook",
    label: "Hook shot",
    family: "post",
    summary: "Turn shoulder-on to the defender and sweep the ball over with the far hand.",
    backendVerb: "hook",
    animationKey: "hook",
    leagueRate: null,
    sampleSize: null,
    zones: ["restricted_area", "paint"],
    difficulty: 4,
    coaching: {
      phases: [
        { name: "Seal", at: 0.00, body: "Establish position with the forearm; feel where the defender is.", cue: "Seal and feel" },
        { name: "Step across", at: 0.30, body: "Step the lead foot across his body, putting your torso between him and the ball.", cue: "Body as the wall" },
        { name: "Sweep", at: 0.55, body: "Sweep the far arm up in one arc, ball on the fingertips.", cue: "One long sweep" },
        { name: "Release", at: 0.78, body: "Release at full extension at the top of the arc, hand rolling over the ball.", cue: "Full extension" },
        { name: "Land", at: 1.00, body: "Land facing the rim, ready to rebound.", cue: "Turn and follow" },
      ],
      mistakes: [
        { fault: "Releasing before full extension", fix: "The height is the defence. Extend all the way." },
        { fault: "Falling away from the rim", fix: "Step across and go up, not backwards." },
        { fault: "Turning the shoulders too early", fix: "Stay shoulder-on until the ball is above the reach." },
      ],
      checkpoints: ["Position sealed first", "Lead foot stepped across", "Full arm extension", "Landed facing the rim"],
    },
  },
  {
    id: "dunk",
    label: "Dunk",
    family: "finish",
    summary: "The highest-percentage shot in basketball — get to the rim and put it through.",
    backendVerb: "dunk",
    animationKey: "dunk",
    leagueRate: 0.892,
    sampleSize: null,
    zones: ["restricted_area"],
    difficulty: 3,
    coaching: {
      phases: [
        { name: "Attack", at: 0.00, body: "Build speed toward the rim; the run-up supplies most of the height.", cue: "Speed becomes height" },
        { name: "Gather", at: 0.35, body: "Gather off one or two feet depending on the angle and the traffic.", cue: "Gather on the run" },
        { name: "Rise", at: 0.58, body: "Explode up, ball secured in one or two hands above the head.", cue: "Ball high early" },
        { name: "Finish", at: 0.80, body: "Reach over the rim and drive it down; strong wrist through contact.", cue: "Through the rim" },
        { name: "Land", at: 1.00, body: "Land on both feet, absorbing through the knees.", cue: "Absorb the landing" },
      ],
      mistakes: [
        { fault: "Gathering too close to the rim", fix: "Take off earlier — you want to rise to the rim, not under it." },
        { fault: "Losing the ball through contact", fix: "Two hands whenever traffic is likely." },
        { fault: "Landing stiff-legged", fix: "Bend the knees on impact; this is where injuries happen." },
      ],
      checkpoints: ["Approach speed built", "Ball secured above the head", "Reach clears the rim", "Two-footed absorbing landing"],
    },
  },
  {
    id: "free_throw",
    label: "Free throw",
    family: "set",
    summary: "The only uncontested shot in the game — entirely a routine and repetition problem.",
    backendVerb: null,           // NOT a field goal; the model has no FT vocabulary
    animationKey: "free_throw",
    leagueRate: 0.780,
    sampleSize: null,
    zones: ["mid_range"],
    difficulty: 1,
    coaching: {
      phases: [
        { name: "Set up", at: 0.00, body: "Same spot on the line every time; align the shooting foot to the rim's centre.", cue: "Same feet, always" },
        { name: "Routine", at: 0.22, body: "The identical routine every attempt — dribbles, breath, look.", cue: "Repeat the ritual" },
        { name: "Dip", at: 0.48, body: "Small controlled dip; almost no jump.", cue: "Legs, not arms" },
        { name: "Release", at: 0.72, body: "Smooth rise, elbow under the ball, high soft arc.", cue: "Up and through" },
        { name: "Follow through", at: 1.00, body: "Hold the finish until the ball hits.", cue: "Hold it" },
      ],
      mistakes: [
        { fault: "Changing the routine under pressure", fix: "The routine exists precisely for pressure. Never shorten it." },
        { fault: "Shooting with the arms because the legs are tired", fix: "Late in games the legs go first — consciously add leg drive." },
        { fault: "Aiming at the whole rim", fix: "Pick one point on the back of the rim and shoot at that." },
      ],
      checkpoints: ["Feet on the same spot", "Routine identical to practice", "Legs involved", "Finish held"],
    },
  },
];

/** Fast lookup. */
export const SHOT_BY_ID: Record<string, ShotAction> = Object.fromEntries(
  SHOTS.map((s) => [s.id, s]),
);

export function getShot(id: string | undefined): ShotAction | undefined {
  return id ? SHOT_BY_ID[id] : undefined;
}

/** Expected points for a zone at a given make probability — the number that
 *  actually decides shot selection, and the reason a 35% three beats a 45% two. */
export function expectedPoints(p: number, zone: ZoneId): number {
  return p * ZONES[zone].pointValue;
}

/**
 * CAPABILITY DECLARATION — what the platform can and cannot say.
 *
 * The UI reads this to decide whether to render a feature or an honest
 * "not available" state. It exists so that adding a camera pipeline later is a
 * one-line change here plus a real implementation — and so that nobody ships a
 * mocked version in the meantime.
 *
 * Everything `false` requires input this system does not have. The model scores
 * shot CONTEXT (location, action, shooter, game state) and returns a calibrated
 * make probability. It has never observed a human body.
 */
export const AI_CAPABILITY = {
  /** Calibrated make probability for a described shot. */
  makeProbability: true,
  /** Per-prediction feature attribution (SHAP) from the backend. */
  featureAttribution: true,
  /** Expected-points ranking of actions at a spot. */
  shotSelectionRanking: true,
  /** Contest sensitivity, from the labelled 2014-15 defender curve. */
  contestCurve: true,
  /** Predicted approach path (GRU, 2015-16 tracking). */
  approachPath: true,

  /** --- requires a camera / pose pipeline that does not exist --- */
  poseAnalysis: false,
  releaseAngleMeasurement: false,
  formFaultDetection: false,
  personalisedCorrection: false,
  videoUpload: false,
  /** --- requires logging real user attempts, not simulated ones --- */
  personalProgressHistory: false,
  /** --- no drill library or recommender exists --- */
  drillRecommendation: false,
  /** --- the served model emits a point probability, not an interval --- */
  predictionConfidenceInterval: false,
} as const;

export type CapabilityKey = keyof typeof AI_CAPABILITY;
