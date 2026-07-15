/**
 * SKINNED BODY — one continuous surface, deformed by the skeleton.
 *
 * WHY THIS REPLACES THE SEGMENT MESHES.
 * The body was built as separate meshes parented to bones: an upper-arm capsule
 * on `LeftArm`, a forearm capsule on `LeftForeArm`, a ball at the elbow to cover
 * the gap between them. That construction cannot look like a body, and no amount
 * of material work rescues it, because each piece is RIGID. When the elbow bends,
 * two solid tubes rotate past each other and the covering ball slides out of the
 * crease. At any distance closer than the wide court shot you see exactly what it
 * is: parts stuck on a stick figure. That is the "robot" complaint, and it is
 * structural.
 *
 * A skinned mesh has no seams to show. Every vertex is weighted to one or two
 * bones, so the surface at a joint is shared between the segments either side of
 * it and bends as one piece of skin.
 *
 * HOW THE WEIGHTS WORK. Each chain is a list of nodes at bone positions. A ring of
 * vertices is swept along the path between them. Away from a joint a ring belongs
 * entirely to the bone driving that segment. Approaching a joint it blends to
 * exactly 50/50 at the joint itself and back out along the next segment, which is
 * the standard linear-blend setup and is what produces a crease that folds instead
 * of tearing. `JOINT_BLEND` is the fraction of each segment spent blending: too
 * small and the joint creases like paper, too large and the limb looks rubbery.
 *
 * WHAT IS STILL RIGID, on purpose: head, hands, shoes, hair. A skull does not
 * deform, and the hands and shoes are small, already detailed, and attached at
 * ends of chains where nothing bends through them.
 *
 * Geometry is generated in REST WORLD space and bound after the skeleton is
 * built, so `Skeleton.calculateInverses()` reads the same rest pose the rings
 * were swept in.
 */
import * as THREE from "three";
import type { BoneName } from "./buildRig";

/** Vertices around each ring. 24 is smooth at arm radius and cheap. */
const RADIAL = 24;
/** Fraction of a segment spent blending into the next bone at a joint. */
const JOINT_BLEND = 0.3;

/** Material slots, in the order the returned groups reference them. */
export const MAT_SKIN = 0;
export const MAT_JERSEY = 1;
export const MAT_SHORTS = 2;

export interface Node {
  /** rest-pose world position */
  p: THREE.Vector3;
  /** cross-section half-width along X and along Z, in feet */
  rx: number;
  rz: number;
  /** the bone that drives the segment starting at this node */
  bone: BoneName;
  /** material slot for the segment starting here */
  mat: number;
}

interface Built {
  pos: number[];
  norm: number[];
  uv: number[];
  idx: number[];
  skinIdx: number[];
  skinWgt: number[];
  /** [start, count, materialIndex] per group */
  groups: [number, number, number][];
}

/**
 * Sweep one chain into rings and append it to the buffers.
 *
 * `boneIndex` maps a bone name to its slot in the skeleton, which is what the
 * skinIndex attribute stores.
 */
function sweep(
  b: Built,
  nodes: Node[],
  boneIndex: Record<string, number>,
  opts: { capStart?: boolean; capEnd?: boolean; ringsPerSeg?: number } = {},
) {
  const { capStart = false, capEnd = false, ringsPerSeg = 5 } = opts;
  const baseVertex = b.pos.length / 3;

  // Ring frame. Every chain here is close to vertical in rest, so a fixed world-Z
  // reference gives a stable basis with no twist along the sweep; a per-ring
  // recomputed frame would rotate the seam and shear the UVs.
  const REF = new THREE.Vector3(0, 0, 1);
  const t = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();

  const rows: { start: number; mat: number }[] = [];

  for (let s = 0; s < nodes.length - 1; s++) {
    const a = nodes[s];
    const c = nodes[s + 1];
    t.subVectors(c.p, a.p).normalize();
    if (Math.abs(t.dot(REF)) > 0.9) u.set(1, 0, 0);
    else u.crossVectors(REF, t).normalize();
    v.crossVectors(t, u).normalize();

    const ia = boneIndex[a.bone] ?? 0;
    const ib = boneIndex[c.bone] ?? ia;

    // last segment emits its closing ring, earlier ones leave it to the next
    const last = s === nodes.length - 2;
    const steps = last ? ringsPerSeg : ringsPerSeg - 1;

    for (let r = 0; r <= steps; r++) {
      const k = r / ringsPerSeg;
      const cx = a.p.x + (c.p.x - a.p.x) * k;
      const cy = a.p.y + (c.p.y - a.p.y) * k;
      const cz = a.p.z + (c.p.z - a.p.z) * k;
      const rx = a.rx + (c.rx - a.rx) * k;
      const rz = a.rz + (c.rz - a.rz) * k;

      // --- weights ---------------------------------------------------------
      // Tail of this segment blends toward the next bone, reaching 50/50 at the
      // joint. The head of the NEXT segment continues from 50/50 back to full,
      // which is what makes the two halves meet without a step.
      let wA = 1;
      if (s > 0 && k < JOINT_BLEND) {
        // head of a segment: still carrying the previous bone
        wA = 0.5 + 0.5 * (k / JOINT_BLEND);
      }
      let wNext = 0;
      if (!last && k > 1 - JOINT_BLEND) {
        wNext = 0.5 * ((k - (1 - JOINT_BLEND)) / JOINT_BLEND);
        wA = 1 - wNext;
      }
      const prevBone = s > 0 ? boneIndex[nodes[s - 1].bone] ?? ia : ia;
      const secondIdx = wNext > 0 ? ib : prevBone;
      const secondW = wNext > 0 ? wNext : 1 - wA;

      rows.push({ start: b.pos.length / 3, mat: a.mat });

      for (let i = 0; i <= RADIAL; i++) {
        const th = (i / RADIAL) * Math.PI * 2;
        const ct = Math.cos(th);
        const st = Math.sin(th);
        const px = cx + u.x * rx * ct + v.x * rz * st;
        const py = cy + u.y * rx * ct + v.y * rz * st;
        const pz = cz + u.z * rx * ct + v.z * rz * st;
        b.pos.push(px, py, pz);

        // radial normal, good enough for a smooth tapered tube
        const nx = u.x * ct + v.x * st;
        const ny = u.y * ct + v.y * st;
        const nz = u.z * ct + v.z * st;
        const nl = Math.hypot(nx, ny, nz) || 1;
        b.norm.push(nx / nl, ny / nl, nz / nl);
        b.uv.push(i / RADIAL, (s + k) / (nodes.length - 1));

        b.skinIdx.push(ia, secondIdx, 0, 0);
        b.skinWgt.push(wA, secondW, 0, 0);
      }
    }
  }

  // --- faces, grouped by material so one mesh can wear skin, jersey and shorts
  let groupStart = b.idx.length;
  let groupMat = rows[0]?.mat ?? MAT_SKIN;
  for (let r = 0; r < rows.length - 1; r++) {
    const a0 = rows[r].start;
    const b0 = rows[r + 1].start;
    if (rows[r].mat !== groupMat) {
      b.groups.push([groupStart, b.idx.length - groupStart, groupMat]);
      groupStart = b.idx.length;
      groupMat = rows[r].mat;
    }
    for (let i = 0; i < RADIAL; i++) {
      const a1 = a0 + i, a2 = a0 + i + 1;
      const b1 = b0 + i, b2 = b0 + i + 1;
      b.idx.push(a1, b1, a2, a2, b1, b2);
    }
  }
  b.groups.push([groupStart, b.idx.length - groupStart, groupMat]);

  // --- caps, so an open tube does not show its hollow interior ---------------
  const capRing = (rowIdx: number, flip: boolean, node: Node) => {
    const start = rows[rowIdx].start;
    const centre = b.pos.length / 3;
    b.pos.push(node.p.x, node.p.y, node.p.z);
    const sgn = flip ? -1 : 1;
    b.norm.push(0, sgn, 0);
    b.uv.push(0.5, 0.5);
    const bi = boneIndex[node.bone] ?? 0;
    b.skinIdx.push(bi, 0, 0, 0);
    b.skinWgt.push(1, 0, 0, 0);
    const gs = b.idx.length;
    for (let i = 0; i < RADIAL; i++) {
      const a1 = start + i, a2 = start + i + 1;
      if (flip) b.idx.push(centre, a2, a1);
      else b.idx.push(centre, a1, a2);
    }
    b.groups.push([gs, b.idx.length - gs, node.mat]);
  };
  if (capStart) capRing(0, true, nodes[0]);
  if (capEnd) capRing(rows.length - 1, false, nodes[nodes.length - 1]);

  return baseVertex;
}

/**
 * Build the whole body as one geometry.
 *
 * Chains are passed in already positioned in rest world space by the caller,
 * which owns the anthropometry; this module owns only the sweeping and skinning.
 */
export function buildSkinnedGeometry(
  chains: { nodes: Node[]; capStart?: boolean; capEnd?: boolean; ringsPerSeg?: number }[],
  boneIndex: Record<string, number>,
): THREE.BufferGeometry {
  const b: Built = { pos: [], norm: [], uv: [], idx: [], skinIdx: [], skinWgt: [], groups: [] };
  for (const c of chains) {
    sweep(b, c.nodes, boneIndex, {
      capStart: c.capStart, capEnd: c.capEnd, ringsPerSeg: c.ringsPerSeg,
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(b.skinIdx, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(b.skinWgt, 4));
  g.setIndex(b.idx);

  // Merge adjacent groups that share a material, so the draw-call count follows
  // the number of materials rather than the number of chains.
  const merged: [number, number, number][] = [];
  for (const gr of b.groups) {
    const last = merged[merged.length - 1];
    if (last && last[2] === gr[2] && last[0] + last[1] === gr[0]) last[1] += gr[1];
    else merged.push([...gr]);
  }
  for (const [start, count, mat] of merged) {
    if (count > 0) g.addGroup(start, count, mat);
  }

  g.computeVertexNormals();
  return g;
}
