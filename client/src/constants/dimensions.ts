/**
 * Official NBA court dimensions — all values in FEET (1 world unit = 1 ft).
 * SINGLE SOURCE OF TRUTH. Every layer (floor, markings, hoop, and future ball /
 * players / heat-map) positions itself from these numbers, in one shared frame,
 * so nothing is hard-coded twice.
 *
 * Coordinate system:
 *   X = length (baseline → baseline)   range [-47, +47]
 *   Z = width  (sideline → sideline)   range [-25, +25]
 *   Y = up
 * The LEFT end (-X) is the attacking basket for the half court.
 */

// ---- overall court ----
export const COURT_LENGTH = 94;
export const COURT_WIDTH = 50;
export const HALF_LENGTH = COURT_LENGTH / 2; // 47
export const HALF_WIDTH = COURT_WIDTH / 2; // 25

// ---- surrounding hardwood (the gym floor the court sits on) ----
// Extends past the court on every side so the court never looks like it floats.
// The out-of-bounds apron is ~8 ft; we give a little more for the environment later.
export const APRON = 15;
export const FLOOR_THICKNESS = 0.5;

// ---- line styling ----
export const LINE_WIDTH = 0.1667; // 2 inches, regulation

// ---- basket / hoop ----
export const BASKET_FROM_BASELINE = 5.25; // rim centre is 63" from baseline
export const RIM_HEIGHT = 10;
export const RIM_RADIUS = 0.75; // 18" diameter
export const BACKBOARD_FROM_BASELINE = 4; // backboard face is 48" from baseline
export const BACKBOARD_WIDTH = 6; // 72"
export const BACKBOARD_HEIGHT = 3.5; // 42"
export const BACKBOARD_BOTTOM = 9.0; // bottom of glass is 9 ft up
export const BACKBOARD_INNER_SQ_W = 2; // shooter's square 24" wide
export const BACKBOARD_INNER_SQ_H = 1.5; // 18" tall, bottom on the rim line

// ---- paint / lane ----
export const PAINT_WIDTH = 16; // regulation lane is 16 ft wide
export const FT_FROM_BASELINE = 19; // free-throw line 19 ft from baseline
export const FT_CIRCLE_RADIUS = 6; // 12 ft diameter
export const RESTRICTED_RADIUS = 4; // restricted-area arc, 4 ft

// lane "hash" block markers along the outside of the lane lines
export const LANE_MARKS_FROM_BASELINE = [7, 8, 11, 14]; // approx NBA block/hash spacing
export const LANE_MARK_LENGTH = 0.66; // ~8"

// ---- three-point line ----
export const THREE_RADIUS = 23.75; // arc radius from basket centre
export const CORNER_3_FROM_SIDELINE = 3; // corner 3 is 22 ft (3 ft in from sideline)
export const CORNER_3_Z = HALF_WIDTH - CORNER_3_FROM_SIDELINE; // 22

// ---- centre court ----
export const CENTER_CIRCLE_RADIUS = 6;
export const CENTER_INNER_RADIUS = 2;

// ---- derived helpers ----
/** X of the basket centre for a given end (-1 = left/attacking, +1 = right). */
export const basketX = (end: -1 | 1) => end * (HALF_LENGTH - BASKET_FROM_BASELINE); // ±41.75
/** X of the baseline for a given end. */
export const baselineX = (end: -1 | 1) => end * HALF_LENGTH; // ±47
/** X where the 3-pt arc meets the straight corner-3 segments. */
export const cornerArcMeetX = Math.sqrt(THREE_RADIUS * THREE_RADIUS - CORNER_3_Z * CORNER_3_Z); // ≈8.95

// ---- surrounding hardwood floor footprint (the plane the court sits on) ----
// Single source of truth, shared by <Hardwood/> and the arena bowl so the seating
// always lines up exactly with the floor edge. A little deeper toward the division
// line (front) than behind the hoop.
export const FLOOR_X_MIN = -66; // behind the hoop (baseline is -47)
export const FLOOR_X_MAX = 34; // past the division line
export const FLOOR_Z_MIN = -38; // sideline (-25) + apron
export const FLOOR_Z_MAX = 38;
export const FLOOR_CENTER_X = (FLOOR_X_MIN + FLOOR_X_MAX) / 2; // -16
export const FLOOR_LEN_X = FLOOR_X_MAX - FLOOR_X_MIN; // 100
export const FLOOR_LEN_Z = FLOOR_Z_MAX - FLOOR_Z_MIN; // 76

// ---- arena bowl (simple, believable surroundings) ----
export const BARRIER_HEIGHT = 3.6; // courtside LED-board / dasher barrier
export const SEAT_ROWS = 20; // rows of the lower bowl
export const SEAT_RISE = 1.35; // ft up per row
export const SEAT_RUN = 2.7; // ft outward per row
export const SEAT_GAP = 6; // corner aisle gap at each stand end (vomitory)
export const CONCOURSE_MARGIN = 20; // flat concourse behind the seating

/** Convert a court position (feet from centre) to a THREE position tuple. */
export function courtToWorld(x: number, z: number, y = 0): [number, number, number] {
  return [x, y, z];
}
