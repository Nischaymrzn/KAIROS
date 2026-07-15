/**
 * HAND — a palm, four fingers and an opposed thumb.
 *
 * This replaced three boxes: a slab for the palm, a slab for all four fingers
 * together, and an ellipsoid for the thumb. On a basketball player that is the
 * most damaging simplification in the whole body, because the hands are what the
 * eye follows. They hold the ball, they are the highest thing in the frame at
 * release, and the follow-through is the pose everyone recognises. A mitten
 * cannot sell any of it.
 *
 * Anatomy that matters here and is cheap to honour:
 *   - four fingers of DIFFERENT lengths, in the real order (middle longest, then
 *     ring, index, little)
 *   - three phalanges each, so a curl bends in three places rather than one
 *   - the knuckle line is an ARC, not a straight edge, so the hand reads as a
 *     hand from the side
 *   - the thumb is opposed, set low on the radial side and rotated across the
 *     palm rather than splayed in the same plane
 *
 * The curl is baked into the rest pose. The animation system drives whole-hand
 * rotation, not individual fingers, so a relaxed shooting hand is authored once
 * here and reads correctly through every sequence.
 */
import * as THREE from "three";
import { RADIAL, ball, roundedBox, taperedCapsule } from "./geometry";

export interface HandParts {
  group: THREE.Group;
}

/**
 * @param side  -1 left, +1 right. Mirrors the thumb.
 * @param len   hand length, wrist to fingertip, in feet
 * @param wristR wrist radius in feet
 * @param curl  0 flat, 1 fist. Around 0.25 is a relaxed shooting hand.
 */
export function buildHand(
  side: 1 | -1,
  len: number,
  wristR: number,
  skin: THREE.Material,
  curl = 0.25,
): THREE.Group {
  const g = new THREE.Group();

  const palmW = wristR * 2.15;
  const palmH = len * 0.46;
  const palmD = wristR * 1.35;

  // ---- palm ---------------------------------------------------------------
  // Wider at the knuckles than at the wrist, and thicker on the thumb side,
  // which is what stops it reading as a paddle.
  const palm = roundedBox(palmW, palmH, palmD, wristR * 0.5, skin);
  palm.position.y = -palmH / 2 - wristR * 0.25;
  g.add(palm);

  // the fleshy mass at the base of the thumb
  const thenar = ball(wristR * 0.78, skin, 0.9, 1.25, 0.8);
  thenar.position.set(side * palmW * 0.3, -palmH * 0.55, palmD * 0.18);
  g.add(thenar);

  // ---- fingers ------------------------------------------------------------
  // Relative length, index to little. Middle is longest.
  const FINGERS = [
    { rel: 0.92, xr: -0.33 }, // index
    { rel: 1.0, xr: -0.11 },  // middle
    { rel: 0.94, xr: 0.11 },  // ring
    { rel: 0.78, xr: 0.33 },  // little
  ];
  const fingerLen = len * 0.54;
  const knuckleY = -palmH - wristR * 0.25;

  for (const f of FINGERS) {
    const total = fingerLen * f.rel;
    // proximal, middle, distal — real proportions, roughly 45/30/25
    const seg = [total * 0.45, total * 0.3, total * 0.25];
    const r0 = wristR * 0.34 * (0.85 + f.rel * 0.2);

    // The knuckle line arcs forward: the middle finger sits further out than the
    // little finger, which is the difference between a hand and a comb.
    const arc = (1 - Math.abs(f.xr) * 2.2) * palmD * 0.16;

    const root = new THREE.Group();
    root.position.set(side * f.xr * palmW, knuckleY, arc);
    // fingers splay very slightly outward from the middle
    root.rotation.z = -side * f.xr * 0.28;
    // and curl forward, the little finger a touch more than the index
    root.rotation.x = curl * (1.15 + f.xr * 0.25);
    g.add(root);

    let parent: THREE.Object3D = root;
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const r = r0 * (1 - i * 0.16);
      const rEnd = r0 * (1 - (i + 1) * 0.16);
      const joint = new THREE.Group();
      joint.position.y = y;
      // each phalanx curls further than the last
      joint.rotation.x = i === 0 ? 0 : curl * 0.85;
      parent.add(joint);

      const bone = taperedCapsule(seg[i], r, rEnd, skin);
      joint.add(bone);

      parent = joint;
      y = -seg[i];
    }
  }

  // ---- thumb --------------------------------------------------------------
  // Opposed: rotated across the palm rather than lying in its plane. Two
  // phalanges, set low on the radial side.
  const thumbRoot = new THREE.Group();
  thumbRoot.position.set(side * palmW * 0.46, -palmH * 0.42, palmD * 0.3);
  thumbRoot.rotation.z = side * 0.95;
  thumbRoot.rotation.x = 0.55;
  thumbRoot.rotation.y = -side * 0.5;
  g.add(thumbRoot);

  const tLen = len * 0.3;
  const tR = wristR * 0.44;
  const prox = taperedCapsule(tLen * 0.58, tR, tR * 0.85, skin);
  thumbRoot.add(prox);

  const distal = new THREE.Group();
  distal.position.y = -tLen * 0.58;
  distal.rotation.x = curl * 0.7;
  thumbRoot.add(distal);
  distal.add(taperedCapsule(tLen * 0.42, tR * 0.85, tR * 0.66, skin));

  return g;
}

/** Radial segment count is shared so the hand matches the arm it is on. */
export const HAND_RADIAL = RADIAL;
