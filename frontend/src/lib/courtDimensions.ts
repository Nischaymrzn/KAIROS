/**
 * Official NBA court dimensions — all values in FEET (world units = 1 ft).
 * Sources: NBA Rule Book (court diagram). Coordinate system used by the 3D scene:
 *   - X axis  = court length  (baseline to baseline), range [-47, +47]
 *   - Z axis  = court width   (sideline to sideline), range [-25, +25]
 *   - Y axis  = up (height)
 * The basket at the LEFT end (-X) is the "home" attacking basket.
 */

// ---- Overall court ----
export const COURT_LENGTH = 94; // ft
export const COURT_WIDTH = 50; // ft
export const HALF_LENGTH = COURT_LENGTH / 2; // 47
export const HALF_WIDTH = COURT_WIDTH / 2; // 25

// ---- Line styling ----
export const LINE_WIDTH = 0.1667; // 2 inches
export const FLOOR_THICKNESS = 0.5;

// ---- Basket / hoop ----
export const BASKET_FROM_BASELINE = 5.25; // center of rim from baseline
export const RIM_HEIGHT = 10; // ft
export const RIM_RADIUS = 0.75; // 18 in diameter
export const RIM_TUBE = 0.05;
export const BACKBOARD_FROM_BASELINE = 4; // inner face of backboard
export const BACKBOARD_WIDTH = 6;
export const BACKBOARD_HEIGHT = 3.5;
export const BACKBOARD_BOTTOM = 9.0; // bottom edge height (rim at 10)
export const BACKBOARD_INNER_SQ_W = 2; // shooter's square width (24 in)
export const BACKBOARD_INNER_SQ_H = 1.5; // 18 in

// ---- The paint / lane ----
export const PAINT_WIDTH = 16; // NBA lane width
export const FT_FROM_BASELINE = 19; // free-throw line (15 ft from backboard face)
export const FT_CIRCLE_RADIUS = 6;
export const RESTRICTED_RADIUS = 4; // restricted-area arc

// ---- Three-point line ----
export const THREE_RADIUS = 23.75; // arc radius from basket center
export const CORNER_3_FROM_SIDELINE = 3; // corner line 3 ft inside sideline
export const CORNER_3_Z = HALF_WIDTH - CORNER_3_FROM_SIDELINE; // 22

// ---- Center court ----
export const CENTER_CIRCLE_RADIUS = 6;
export const CENTER_INNER_RADIUS = 2;

// ---- Derived helpers ----
/** X position of the rim center for a given end (-1 = left, +1 = right). */
export const basketX = (end: -1 | 1) =>
  end * (HALF_LENGTH - BASKET_FROM_BASELINE); // ±41.75

/** Baseline X for a given end. */
export const baselineX = (end: -1 | 1) => end * HALF_LENGTH; // ±47

/** Horizontal distance from basket where the 3pt arc meets the corner line. */
export const cornerArcMeetX = Math.sqrt(
  THREE_RADIUS * THREE_RADIUS - CORNER_3_Z * CORNER_3_Z,
); // ≈ 8.95 ft
