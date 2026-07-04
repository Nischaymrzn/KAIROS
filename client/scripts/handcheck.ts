/**
 * HAND CHECK — where the shooting hand actually ends up in world space.
 *
 * The pose check reads joint ANGLES, which is not the same question. A chain can
 * be monotonically forward at every joint and still put the ball behind the head,
 * because the torso lean and the clavicle move the shoulder before the arm does
 * anything. This builds the real rig, applies each pose, and measures the hand.
 *
 * The player faces +Z, so:
 *   fwd   hand Z minus head Z. Positive = ball in front of the face. At release
 *         a jump shot has the ball clearly in front and above.
 *   up    hand Y minus head Y. Positive = above the head.
 *
 * A negative `fwd` at the release frame is the "reaching back for the ball" look.
 */
import * as THREE from "three";
import type { Pose } from "../src/player/animation/poses";

// The rig paints its fabric textures on a canvas at build time. Geometry does
// not need them, so a stub is enough to get the skeleton out of a node process.
const stubCtx = new Proxy({}, { get: () => () => stubCtx }) as unknown as CanvasRenderingContext2D;
(globalThis as { document?: unknown }).document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => stubCtx,
    toDataURL: () => "",
  }),
};

const { buildRig } = await import("../src/player/rig/buildRig");
const { makeArchetype } = await import("../src/player");
const { POSES } = await import("../src/player/animation/poses");

const rig = buildRig(makeArchetype("SG", { uniform: { number: "0", kit: "home" } }));

function measure(pose: Pose) {
  for (const b of Object.values(rig.bones)) b.rotation.set(0, 0, 0);
  for (const [name, rot] of Object.entries(pose)) {
    const b = rig.bones[name as keyof typeof rig.bones];
    if (b) b.rotation.set(rot[0], rot[1], rot[2]);
  }
  rig.root.updateMatrixWorld(true);
  const hand = new THREE.Vector3();
  const head = new THREE.Vector3();
  const shoulder = new THREE.Vector3();
  rig.bones.RightHand.getWorldPosition(hand);
  rig.bones.Head.getWorldPosition(head);
  rig.bones.RightShoulder.getWorldPosition(shoulder);
  return {
    fwd: hand.z - head.z,
    up: hand.y - head.y,
    fromShoulder: hand.z - shoulder.z,
    handY: hand.y,
  };
}

/** Poses where the ball is in the shooter's hands at or near release. */
const RELEASE = ["shoot", "shootFade", "follow", "layup", "floater", "hook", "dunk", "hookFollow"];
/** Loading poses: the ball SHOULD still be low and close to the body. */
const LOADING = ["gather", "dip", "rise", "ready", "tuck"];

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
};

console.log("hand position at release, relative to the head (player faces +Z)");
console.log("  pose            fwd(ft)   up(ft)   vs shoulder");
for (const name of RELEASE) {
  const p = POSES[name as keyof typeof POSES];
  if (!p) continue;
  const m = measure(p);
  console.log(
    `  ${name.padEnd(14)}${m.fwd.toFixed(2).padStart(8)}${m.up.toFixed(2).padStart(9)}${m.fromShoulder.toFixed(2).padStart(14)}`
  );
}

console.log("\nrelease poses put the ball in front of the face");
for (const name of RELEASE) {
  const p = POSES[name as keyof typeof POSES];
  if (!p) continue;
  const m = measure(p);
  // Reverse layups finish the ball back over the head on purpose; everything
  // else must have the hand ahead of the face at release.
  ok(`${name} hand is forward of the head`, m.fwd > 0.05, `${m.fwd.toFixed(2)} ft`);
}

console.log("\nthe ball is above the head at release on a jump shot");
for (const name of ["shoot", "follow"]) {
  const m = measure(POSES[name as keyof typeof POSES]);
  ok(`${name} hand is above the head`, m.up > 0, `${m.up.toFixed(2)} ft`);
}

console.log("\nloading poses keep the ball low and close (nothing to assert forward)");
for (const name of LOADING) {
  const p = POSES[name as keyof typeof POSES];
  if (!p) continue;
  const m = measure(p);
  console.log(`  ${name.padEnd(14)} fwd ${m.fwd.toFixed(2)}  up ${m.up.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// The invariant that actually governs how a shot LOOKS. Through the shooting
// motion the ball must travel forward and up without ever retreating: gather at
// the waist, set point in front of the face, release above and ahead, follow
// through furthest. One backward step anywhere in that chain reads as pulling
// the ball back before throwing it, however correct each pose is on its own.
console.log("\nthe ball never travels backwards through a shot");
{
  const CHAIN = ["gather", "rise", "shoot", "follow"] as const;
  const pts = CHAIN.map((n) => ({ n, ...measure(POSES[n as keyof typeof POSES]) }));
  console.log("  " + pts.map((p) => `${p.n} ${p.fwd.toFixed(2)}`).join("  ->  "));
  for (let i = 1; i < pts.length; i++) {
    ok(`${pts[i - 1].n} -> ${pts[i].n} carries the ball forward`,
      pts[i].fwd >= pts[i - 1].fwd - 0.02,
      `${pts[i - 1].fwd.toFixed(2)} -> ${pts[i].fwd.toFixed(2)} ft`);
  }
  for (let i = 1; i < pts.length; i++) {
    ok(`${pts[i - 1].n} -> ${pts[i].n} does not drop the ball`,
      pts[i].up >= pts[i - 1].up - 0.3,
      `${pts[i - 1].up.toFixed(2)} -> ${pts[i].up.toFixed(2)} ft`);
  }
  ok("the load starts at the body, not out in front",
    pts[0].fwd < 0.4, `gather ${pts[0].fwd.toFixed(2)} ft`);
  ok("the ball never sits far behind the head",
    pts.every((p) => p.fwd > -0.5), pts.map((p) => p.fwd.toFixed(2)).join(", "));
}

// ---------------------------------------------------------------------------
// The same invariant, applied to EVERY sequence rather than to one hand-written
// chain. The block above walks gather -> rise -> shoot -> follow, which is the
// catch-and-shoot path; a pull-up loads through `stride`, a step-back through
// `plant` and `pushback`, and a dunk through `tuck`. Those paths were never
// measured, which is how a reach-back survived in the LOAD phase while every
// release pose checked out clean.
//
// Rule: from the first frame to the release frame the ball may dip, but it must
// not end up meaningfully behind where it started, and no single step may throw
// it backwards past the head.
console.log("\nevery sequence carries the ball forward into its release");
{
  const { SHOT_SEQUENCES } = await import("../src/player/animation/sequences");

  // `idle` is a player standing at rest with the arms hanging, so the hand sits
  // naturally behind the plane of the face. That is posture, not a reach-back,
  // and only the free throw begins from it.
  const REST = new Set(["idle"]);

  // Releases that travel BACKWARDS on purpose. A step-back and a fadeaway create
  // separation by moving away from the defender, and a reverse layup finishes the
  // ball back over the head on the far side of the rim. Asserting these go
  // forward would be asserting the animation is wrong about basketball.
  const RETREATING = new Set(["shootFade", "reverse"]);

  // Finishes that reach UP rather than out. A driving layup's forward progress is
  // in the ROOT — the player travels 4.4 ft toward the rim — not in where the hand
  // sits relative to the head, which stays put while the arm extends vertically.
  // Asserting forward progress here measures the wrong axis and fails a lay-in
  // that is doing exactly what a lay-in does.
  const REACHING = new Set(["layup"]);

  for (const [verb, seq] of Object.entries(SHOT_SEQUENCES)) {
    const frames = seq.frames.filter((f) => f.at <= seq.releaseAt + 1e-9);
    const pts = frames.map((f) => {
      const pose = POSES[f.pose as keyof typeof POSES];
      return { n: f.pose, at: f.at, ...measure(pose) };
    });
    if (pts.length < 2) continue;

    console.log(`  ${verb.padEnd(15)} ` + pts.map((p) => `${p.n} ${p.fwd.toFixed(2)}`).join(" -> "));

    // No ACTIVE load frame may put the hand behind the head. This is the check
    // that would have caught the reach-back, and it is the reason it now walks
    // every sequence instead of one hand-written chain.
    const behind = pts.filter((p) => !REST.has(p.n) && p.fwd < -0.5);
    ok(`${verb}: never reaches back behind the head`, behind.length === 0,
      behind.length ? behind.map((p) => `${p.n} ${p.fwd.toFixed(2)}`).join(", ") : "");

    const release = pts[pts.length - 1];
    if (RETREATING.has(release.n)) {
      // The ball moves back, so the thing to verify is that it still went UP —
      // a fade that does not rise is a shot put.
      const peak = Math.max(...pts.map((p) => p.up));
      ok(`${verb}: fades back but still rises`, release.up > 0 && peak > 0,
        `release up ${release.up.toFixed(2)} ft`);
    } else if (REACHING.has(release.n)) {
      ok(`${verb}: lays the ball up above the head`, release.up > 0.3,
        `up ${release.up.toFixed(2)} ft`);
    } else {
      // Otherwise the release must be ahead of the deepest point of the load.
      const deepest = Math.min(...pts.slice(0, -1).map((p) => p.fwd));
      ok(`${verb}: release is ahead of the load`, release.fwd > deepest,
        `deepest ${deepest.toFixed(2)} -> ${release.n} ${release.fwd.toFixed(2)} ft`);
    }
  }
}

console.log(fail === 0 ? "\nall hand-position checks passed" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
