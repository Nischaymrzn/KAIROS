/**
 * CAMERA PRESETS — named viewpoints onto the court. Each is computed from the real
 * court coordinates (constants/dimensions.ts) so it points at the right spot. This
 * is the SINGLE place to add or edit views: drop a new entry in CAMERA_VIEWS and it
 * automatically appears as a button, a number-key shortcut, and in the double-click
 * cycle. Later, per-player views can be generated the same way (position from the
 * chosen player's court location, target the rim).
 *
 * Convention: the attacking basket is the LEFT end (end = -1). Player-area views sit
 * out by the 3-point line at ~9 ft (a touch above eye level) and look in at the rim.
 */
import * as D from "../constants/dimensions";

export interface CameraView {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const bx = D.basketX(-1); // -41.75, basket centre

export const CAMERA_VIEWS: CameraView[] = [
  {
    // Pulled back and lifted. The old framing filled the screen with hardwood and
    // cropped the building off the top, so the arena that was built around the
    // court never appeared in the default view. From here the near stand, the
    // ribbon and the bowl are all in shot behind the play.
    name: "Broadcast",
    position: [2, 27, 42],
    target: [-26, 3, 0],
    fov: 40,
  },
  {
    name: "Top of Key",
    position: [-13, 9, 0],
    target: [bx + 3, 4.5, 0],
    fov: 46,
  },
  {
    name: "Right Wing",
    position: [bx + 15, 9, 25],
    target: [bx + 2, 4.5, 0],
    fov: 50,
  },
  {
    name: "Left Wing",
    position: [bx + 15, 9, -25],
    target: [bx + 2, 4.5, 0],
    fov: 50,
  },
  {
    name: "Corner 3",
    position: [bx - 3, 8, 31],
    target: [bx, 4.5, 0],
    fov: 52,
  },
  {
    name: "Deep 3",
    position: [-3, 13, 9],
    target: [bx + 2, 4, 0],
    fov: 44,
  },
  {
    // A steep broadcast angle for watching a possession develop, which is what a
    // replay of ten tracked players needs: high enough to read the spacing,
    // shallow enough to keep the rim and the building in shot.
    //
    // Deliberately NOT a plan view. Two things bite a near-vertical camera here.
    // Its view direction runs along the default up vector, which collapses the
    // right vector and degenerates the view matrix; and at plan-view heights it
    // sits inside the scoreboard hanging at y = 52 over x = -16, so the frame
    // fills with the underside of a scoreboard and reads as a black screen.
    name: "Play View",
    position: [-14, 34, 33],
    target: [-33, 2, 0],
    fov: 42,
  },
];
