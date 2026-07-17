/**
 * FOCUS TRACKER — a tiny shared channel between moving 3D subjects and the
 * camera. The ball (during a shot flight) and the movement runner write their
 * world position here; <CameraRig/> eases the orbit TARGET toward it while
 * active, giving a cinematic follow without taking camera POSITION control
 * away from the user (orbit/zoom still work mid-follow).
 */
import * as THREE from "three";

export const focusTracker = {
  active: false,
  pos: new THREE.Vector3(),
  /** shooter court position at the trigger — set during shot flights so the
   *  camera can fly to a broadcast-side framing of shooter + rim + ball;
   *  null for non-shot follows (movement runner). */
  shotFrame: null as { x: number; z: number } | null,
};
