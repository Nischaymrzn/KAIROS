/**
 * RIG GEOMETRY — the shape vocabulary the body is built from.
 *
 * WHY THIS EXISTS
 * The body read as a robot for reasons that were all geometric rather than
 * artistic. Segments met at flat lathe ends, so every joint had a visible seam.
 * Hands and shoes were literal boxes. The whole rig ran at twenty radial
 * segments, which is few enough that the silhouette of an arm is a visible
 * polygon against the arena lights.
 *
 * These helpers fix the class of problem rather than each instance:
 *
 *   capsule      a limb segment with hemispherical ends, so two segments meeting
 *                at a joint interpenetrate smoothly instead of showing a rim
 *   smoothLathe  a muscle profile resampled through a Catmull-Rom curve, so the
 *                surface flows instead of stepping between the four points an
 *                author typed
 *   roundedBox   a box with actual fillets, for things that are boxy but not
 *                machined
 *
 * Segment counts live here too, in one place, so quality can be tuned globally
 * rather than by hunting magic numbers through the builder.
 */
import * as THREE from "three";

/** Radial segments around a limb. 20 showed as a faceted silhouette. */
export const RADIAL = 32;
/** Rings on a joint sphere. */
export const SPHERE_RINGS = 20;
/** Points a muscle profile is resampled to before it becomes a surface. */
export const PROFILE_SAMPLES = 26;

/**
 * Resample a muscle profile through a Catmull-Rom curve and lathe it.
 *
 * A profile is [radius, t] pairs with t as the fraction along the segment. Lathing
 * four points directly gives four rings and three visible bands down the arm; the
 * curve puts a smooth surface through the same authored intent.
 */
export function smoothLathe(
  len: number,
  profile: [number, number][],
  mat: THREE.Material,
  samples = PROFILE_SAMPLES,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(
    profile.map(([r, t]) => new THREE.Vector3(r, -t * len, 0)),
    false,
    "catmullrom",
    0.5,
  );
  const pts = curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(p.x, 0.001), p.y));
  const g = new THREE.LatheGeometry(pts, RADIAL);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/**
 * A capsule along -Y, radius tapering from `r0` at the top to `r1` at the bottom.
 *
 * Built as a lathe rather than CapsuleGeometry because a real limb segment is not
 * a constant radius, and the hemispherical caps are what let the next segment
 * overlap it without a seam appearing at any camera angle.
 */
export function taperedCapsule(
  len: number,
  r0: number,
  r1: number,
  mat: THREE.Material,
): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const CAP = 6;
  // top hemisphere
  for (let i = CAP; i >= 0; i--) {
    const a = (i / CAP) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  // the shaft
  pts.push(new THREE.Vector2(r0, 0));
  pts.push(new THREE.Vector2(r1, -len));
  // bottom hemisphere
  for (let i = 0; i <= CAP; i++) {
    const a = (i / CAP) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, -len - Math.sin(a) * r1));
  }
  const g = new THREE.LatheGeometry(pts, RADIAL);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** A sphere used as a joint or a soft mass. */
export function ball(
  r: number,
  mat: THREE.Material,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, RADIAL, SPHERE_RINGS), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

/**
 * A box with rounded edges, approximated by scaling a subdivided sphere toward a
 * cube. Cheaper than a real fillet and enough for a palm or a heel counter, which
 * only need to stop reading as machined.
 */
export function roundedBox(
  w: number,
  h: number,
  d: number,
  round: number,
  mat: THREE.Material,
): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const half = new THREE.Vector3(w / 2, h / 2, d / 2);
  const inner = new THREE.Vector3(
    Math.max(half.x - round, 0.0001),
    Math.max(half.y - round, 0.0001),
    Math.max(half.z - round, 0.0001),
  );
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // clamp to the inner box, then push back out by the fillet radius
    const c = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -inner.x, inner.x),
      THREE.MathUtils.clamp(v.y, -inner.y, inner.y),
      THREE.MathUtils.clamp(v.z, -inner.z, inner.z),
    );
    const d2 = v.clone().sub(c);
    if (d2.lengthSq() > 1e-9) d2.normalize().multiplyScalar(round);
    pos.setXYZ(i, c.x + d2.x, c.y + d2.y, c.z + d2.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Plain box, for the few things that really are flat panels. */
export function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}
