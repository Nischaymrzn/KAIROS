/**
 * SHOE — a basketball sneaker.
 *
 * This replaced a box for the upper, a box for the sole and two spheres for the
 * toe and heel. A shoe is small on screen but it is the contact point with the
 * floor, so it is in shot constantly and a rectangular block under a curved leg
 * is very visible.
 *
 * The parts are the ones that actually define the silhouette of a basketball
 * shoe, and they are built in the order a shoe is:
 *
 *   outsole    thin, widest, rounded at the toe, with a slight upward toe spring
 *   midsole    the thick foam wedge, deeper at the heel than the forefoot
 *   upper      toe box, vamp and a heel counter that wraps up behind the ankle
 *   collar     the padded ring at the ankle, the thing that says basketball
 *              rather than running
 *   tongue     under the laces, proud of the vamp
 *   laces      a few crossed bands, enough to break up the vamp
 *
 * A high-top collar is what distinguishes this from any other shoe at a glance,
 * so it is deliberately prominent.
 */
import * as THREE from "three";
import { ball, box, roundedBox, taperedCapsule } from "./geometry";

/**
 * @param len   foot length in feet
 * @param h     foot height (ankle to floor) in feet
 * @param ankleR ankle radius in feet
 * @param yFloor Y of the floor in this bone frame (feet sit here)
 */
export function buildShoe(
  len: number,
  h: number,
  ankleR: number,
  yFloor: number,
  upper: THREE.Material,
  sole: THREE.Material,
  accent: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();

  const W = len * 0.4;                 // width across the forefoot
  const fwd = len * 0.16;              // the foot sits forward of the ankle
  const soleH = h * 0.34;
  const midH = h * 0.5;

  // ---- outsole ------------------------------------------------------------
  const outsole = roundedBox(W * 1.04, soleH, len * 0.97, soleH * 0.45, sole);
  outsole.position.set(0, yFloor + soleH / 2, fwd);
  g.add(outsole);

  // toe spring: the front of the sole lifts slightly off the floor
  const toeLift = ball(W * 0.5, sole, 1, 0.42, 0.6);
  toeLift.position.set(0, yFloor + soleH * 0.75, fwd + len * 0.42);
  g.add(toeLift);

  // ---- midsole ------------------------------------------------------------
  // Deeper at the heel, which is what gives a basketball shoe its wedge profile.
  const mid = roundedBox(W * 0.99, midH, len * 0.92, midH * 0.4, upper);
  mid.position.set(0, yFloor + soleH + midH / 2, fwd);
  g.add(mid);

  const heelWedge = ball(W * 0.5, upper, 1, 0.8, 0.62);
  heelWedge.position.set(0, yFloor + soleH + midH * 0.72, fwd - len * 0.34);
  g.add(heelWedge);

  // ---- upper --------------------------------------------------------------
  const upperH = h * 0.62;
  const vamp = roundedBox(W * 0.92, upperH, len * 0.72, W * 0.3, upper);
  vamp.position.set(0, yFloor + soleH + midH + upperH * 0.42, fwd + len * 0.04);
  g.add(vamp);

  // toe box, rounded and lower than the vamp
  const toeBox = ball(W * 0.46, upper, 1, 0.78, 1.15);
  toeBox.position.set(0, yFloor + soleH + midH + upperH * 0.2, fwd + len * 0.35);
  g.add(toeBox);

  // heel counter, wrapping up behind the ankle
  const counter = ball(W * 0.48, upper, 1, 1.15, 0.7);
  counter.position.set(0, yFloor + soleH + midH + upperH * 0.72, fwd - len * 0.3);
  g.add(counter);

  // ---- collar -------------------------------------------------------------
  // The padded ring the ankle sits in. This is the single most recognisable part
  // of a basketball shoe, so it is generous.
  const collarY = yFloor + soleH + midH + upperH * 1.02;
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(ankleR * 1.34, ankleR * 0.44, 12, 26),
    upper,
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, collarY, fwd - len * 0.06);
  collar.castShadow = true;
  g.add(collar);

  // ---- tongue -------------------------------------------------------------
  const tongue = roundedBox(W * 0.5, upperH * 0.9, len * 0.1, W * 0.16, accent);
  tongue.position.set(0, collarY - upperH * 0.3, fwd + len * 0.2);
  tongue.rotation.x = -0.24;
  g.add(tongue);

  // ---- laces --------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const lace = box(W * 0.62, h * 0.05, len * 0.035, sole);
    lace.position.set(0, collarY - upperH * (0.18 + i * 0.24), fwd + len * (0.14 + i * 0.05));
    lace.rotation.x = -0.24;
    g.add(lace);
  }

  // ---- side accent --------------------------------------------------------
  // A swoosh-like band across the midfoot, the thing that reads as branding
  // without imitating any real brand mark.
  for (const sx of [-1, 1]) {
    const band = taperedCapsule(len * 0.34, W * 0.075, W * 0.035, accent);
    band.position.set(sx * W * 0.46, yFloor + soleH + midH + upperH * 0.55, fwd + len * 0.02);
    band.rotation.z = Math.PI / 2;
    band.rotation.y = sx * 0.22;
    g.add(band);
  }

  return g;
}
