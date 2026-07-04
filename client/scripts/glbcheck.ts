/**
 * Headless GLB check: parses public/models/player.glb, replicates the
 * GlbCharacter build path (bone mapping, stature from bone world positions,
 * scale, grounding, idle harvest) and reports what the pipeline would produce.
 *
 *   npx esbuild scripts/glbcheck.ts --bundle --platform=node --format=esm \
 *     --outfile=scripts/glbcheck.mjs && node scripts/glbcheck.mjs
 */
import { readFileSync } from "node:fs";

// GLTFLoader reaches for browser globals when decoding textures. We only care
// about the skeleton here, so stub enough for the parse to complete.
const g = globalThis as unknown as Record<string, unknown>;
g.self = g;
g.createImageBitmap = () =>
  Promise.resolve({ width: 1, height: 1, close() {} } as unknown as ImageBitmap);
g.URL = g.URL ?? {};
(g.URL as Record<string, unknown>).createObjectURL = () => "blob:stub";
(g.URL as Record<string, unknown>).revokeObjectURL = () => {};
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const UE_ALIASES: Record<string, string> = {
  pelvis: "Hips", spine_01: "Spine", spine_02: "Spine1", spine_03: "Spine2",
  neck_01: "Neck", head: "Head",
  clavicle_l: "LeftShoulder", upperarm_l: "LeftArm", lowerarm_l: "LeftForeArm", hand_l: "LeftHand",
  clavicle_r: "RightShoulder", upperarm_r: "RightArm", lowerarm_r: "RightForeArm", hand_r: "RightHand",
  thigh_l: "LeftUpLeg", calf_l: "LeftLeg", foot_l: "LeftFoot",
  thigh_r: "RightUpLeg", calf_r: "RightLeg", foot_r: "RightFoot",
};
const canonical = (n: string) => {
  const s = n.replace(/^mixamorig[:_]?/i, "");
  return UE_ALIASES[s.toLowerCase()] ?? s;
};

const REQUIRED = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
];

const buf = readFileSync("public/models/player.glb");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

new GLTFLoader().parse(ab as ArrayBuffer, "", (gltf) => {
  const bones: Record<string, THREE.Bone> = {};
  const allNames: string[] = [];
  let skinned = 0;
  let tris = 0;
  const mats = new Set<string>();

  gltf.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      allNames.push(o.name);
      const c = canonical(o.name);
      if (REQUIRED.includes(c) && !bones[c]) bones[c] = o as THREE.Bone;
    }
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      skinned++;
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const mm = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of mm) if (x) mats.add((x as THREE.Material).type + ":" + ((x as THREE.Material).name || "unnamed"));
    }
  });

  gltf.scene.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();

  console.log(`bones in file         : ${allNames.length}`);
  const missing = REQUIRED.filter((r) => !bones[r]);
  console.log(`required bones mapped : ${REQUIRED.length - missing.length}/${REQUIRED.length}` +
    (missing.length ? `  MISSING: ${missing.join(", ")}` : ""));
  console.log(`skinned meshes        : ${skinned}`);
  console.log(`triangles             : ${Math.round(tris).toLocaleString()}`);
  console.log(`materials             : ${[...mats].join(", ") || "none"}`);
  console.log(`animation clips       : ${gltf.animations.map((a) => `${a.name}(${a.duration.toFixed(2)}s)`).join(", ") || "none"}`);

  if (missing.length) {
    console.log("\nFAIL: bone mapping incomplete");
    process.exit(1);
  }

  const headY = bones.Head.getWorldPosition(v).y;
  const footY = Math.min(
    bones.LeftFoot.getWorldPosition(v).y,
    bones.RightFoot.getWorldPosition(new THREE.Vector3()).y
  );
  const statureNative = Math.max((headY - footY) / 0.89, 1e-6);
  const targetH = 6.5;
  const s = targetH / statureNative;

  console.log(`\nbind-pose head Y      : ${headY.toFixed(3)}`);
  console.log(`bind-pose foot Y      : ${footY.toFixed(3)}`);
  console.log(`native stature        : ${statureNative.toFixed(3)}`);
  console.log(`scale for 6.5 ft      : ${s.toFixed(3)}`);

  // grounding: ankle sits ~4% of stature above the sole
  const ankleWorld = Math.min(
    bones.LeftFoot.getWorldPosition(v).y,
    bones.RightFoot.getWorldPosition(new THREE.Vector3()).y
  ) * s;
  const lift = -(ankleWorld - targetH * 0.04);
  const soleY = ankleWorld + lift - targetH * 0.04;
  const headTop = headY * s + lift;
  console.log(`grounded sole Y       : ${soleY.toFixed(4)}  (want ~0)`);
  console.log(`head joint Y          : ${headTop.toFixed(3)} ft  (target stature ${targetH})`);

  // idle harvest
  const clip = gltf.animations.find((a) => /idle/i.test(a.name)) ?? gltf.animations[0];
  let harvested = 0;
  if (clip) {
    for (const track of clip.tracks) {
      const m = track.name.match(/^(.+)\.quaternion$/);
      if (!m || track.values.length < 4) continue;
      if (REQUIRED.includes(canonical(m[1]))) harvested++;
    }
  }
  console.log(`idle clip             : ${clip?.name ?? "none"}`);
  console.log(`rest quats harvested  : ${harvested}/${REQUIRED.length}`);

  const ok = missing.length === 0 && Math.abs(soleY) < 0.05 && s > 0.01 && s < 1000;
  console.log(ok ? "\nGLB pipeline OK" : "\nFAIL: pipeline produced implausible values");
  process.exit(ok ? 0 : 1);
}, (e) => {
  console.log("FAIL: GLTF parse error", e);
  process.exit(1);
});
