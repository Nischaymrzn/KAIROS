/**
 * HAND TRACKER — the shooter publishes both hands every frame; ShotArc uses them
 * to seat the ball while it is still being held, then releases it at releaseAt.
 * Same shared-channel pattern as focusTracker.
 *
 * WHY ORIENTATION AND NOT JUST POSITION
 * The ball used to be placed at the midpoint of the two hand positions and pushed
 * outward from the chest by its own radius. That gets the ball roughly between the
 * hands, which is enough at a distance, but it has no idea which way the hands are
 * facing. So the ball floated at the wrist rather than sitting on the fingers, and
 * as the arm rotated up through the shot the ball slid around the hand instead of
 * being carried by it.
 *
 * The hand bones now publish their world QUATERNION as well, and the ball is
 * placed in the shooting hand's own frame. In that frame the fingers run down
 * local -Y and the palm faces local +Z, so a ball resting on the fingertips of a
 * cocked shooting hand is a fixed offset, and it stays correct through every pose
 * without a single special case.
 */
import * as THREE from "three";

export const handTracker = {
  live: false,
  right: new THREE.Vector3(),
  left: new THREE.Vector3(),
  chest: new THREE.Vector3(),
  /** world orientation of each hand bone, for seating the ball in the palm */
  rightQ: new THREE.Quaternion(),
  leftQ: new THREE.Quaternion(),
};

const _shoot = new THREE.Vector3();
const _guide = new THREE.Vector3();

/**
 * Where the ball should sit right now, in world space.
 *
 * `toShooting` ramps 0 to 1 as the release approaches, sliding the anchor from
 * both hands onto the shooting hand alone. That ramp is the guide hand coming off
 * the ball, which is a real and very visible part of a jump shot.
 *
 * The offsets are in the hand's own frame:
 *   -Y  toward the fingertips, so the ball sits ON the fingers
 *   +Z  out from the palm, so the palm meets the ball surface and not its centre
 */
export function ballHold(radius: number, toShooting: number, out: THREE.Vector3) {
  const k = Math.min(Math.max(toShooting, 0), 1);

  // shooting hand: ball seated on the fingers, palm against its underside
  _shoot.set(0, -radius * 0.42, radius * 0.92).applyQuaternion(handTracker.rightQ);
  _shoot.add(handTracker.right);

  // guide hand: ball sits against the palm from the side
  _guide.set(0, -radius * 0.3, radius * 0.86).applyQuaternion(handTracker.leftQ);
  _guide.add(handTracker.left);

  // Early in the motion the ball is between the hands; by the release it is on
  // the shooting hand alone.
  return out.copy(_guide).lerp(_shoot, 0.5 + 0.5 * k);
}
