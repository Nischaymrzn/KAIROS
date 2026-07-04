/**
 * Headless animation check. Builds a bare bone hierarchy (no meshes, no canvas),
 * runs every shot sequence through the real AnimationController at 20 ms steps
 * and reports timing, smoothness and chain ordering.
 *
 *   npx esbuild scripts/animcheck.ts --bundle --platform=node --format=esm \
 *     --outfile=scripts/animcheck.mjs && node scripts/animcheck.mjs
 */
import * as THREE from "three";
import { AnimationController } from "../src/player/animation/AnimationController";
import { SHOT_SEQUENCES, shotSequence } from "../src/player/animation/sequences";
import { POSES } from "../src/player/animation/poses";
import type { BoneName, PlayerRig } from "../src/player/rig/buildRig";

const NAMES: BoneName[] = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
];

function stubRig(): PlayerRig {
  const root = new THREE.Group();
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of NAMES) {
    const b = new THREE.Bone();
    b.name = n;
    root.add(b);
    bones[n] = b;
  }
  return { root, bones, plan: {} as never, dispose() {} };
}

// proximal-to-distal ordering is a jump-shot property; finishes lead with the
// reaching arm by design, so they are reported but not asserted.
const JUMPERS = new Set(["catch_shoot", "pullup", "stepback", "fadeaway", "free_throw"]);

const STEP = 0.02;
let failures = 0;

function fail(msg: string) {
  failures++;
  console.log(`    FAIL ${msg}`);
}

// Every verb the scenario schema lets a user pick must have its own timeline.
// `shotSequence` falls back to `pullup` for anything missing, so a gap here is
// silent at runtime: `layup` was absent for a long time and every standing layup
// animated as a jump shot without raising anything.
{
  const SELECTABLE = [
    "catch_shoot", "pullup", "stepback", "fadeaway", "floater",
    "driving_layup", "layup", "hook", "dunk",
  ];
  const missing = SELECTABLE.filter((v) => !(v in SHOT_SEQUENCES));
  if (missing.length) {
    fail(`selectable shot verbs with no timeline of their own: ${missing.join(", ")}`);
  } else {
    console.log(`  ok    every selectable verb has its own timeline (${SELECTABLE.length})`);
  }
}

for (const verb of Object.keys(SHOT_SEQUENCES)) {
  const seq = shotSequence(verb);
  const rig = stubRig();
  const ctrl = new AnimationController(rig, "idle");

  // every referenced pose must exist and be in timeline order
  let lastAt = -1;
  for (const f of seq.frames) {
    if (!(f.pose in POSES)) fail(`${verb}: unknown pose "${f.pose}"`);
    if (f.at < lastAt) fail(`${verb}: frame times out of order at ${f.at}`);
    lastAt = f.at;
  }

  ctrl.playShot(verb, 1, 22);

  let t = 0;
  let apexT = 0;
  let apexY = -1;
  let maxJerk = 0;
  let maxJerkAt = 0;
  let maxJerkBone = "";
  let groundedFault = 0;
  const prev = new Map<BoneName, number>();
  const prevDelta = new Map<BoneName, number>();
  // when each chain tier passes 80% of its travel toward the release pose
  const trace: { t: number; hip: number; wrist: number }[] = [];
  // airborne translation: peak reach, when it happens, and where it ends up
  let peakBack = 0;
  let peakSide = 0;
  let travelWhileGrounded = 0;

  while (t <= seq.duration + 0.1) {
    ctrl.update(t, STEP);

    const y = rig.root.position.y;
    if (y > apexY) { apexY = y; apexT = t; }
    if (y < -1e-6) groundedFault++;

    for (const n of NAMES) {
      const cur = rig.bones[n].rotation.x;
      const p = prev.get(n);
      if (p !== undefined) {
        const d = cur - p;
        const pd = prevDelta.get(n);
        // a pop is a JERK: one frame stepping far more than its neighbour.
        // Raw speed is fine, a shooting arm genuinely moves at ~18 rad/s.
        if (pd !== undefined) {
          const j = Math.abs(d - pd);
          if (j > maxJerk) { maxJerk = j; maxJerkAt = t; maxJerkBone = n; }
        }
        prevDelta.set(n, d);
      }
      prev.set(n, cur);
    }

    // -z in the rig's local frame is away from the rim
    if (Math.abs(ctrl.travel.z) > Math.abs(peakBack)) peakBack = -ctrl.travel.z;
    if (Math.abs(ctrl.travel.x) > Math.abs(peakSide)) peakSide = ctrl.travel.x;
    // the feet may only leave the spot while the body is off the floor
    if (y <= 1e-6 && t < seq.liftAt - STEP &&
        (Math.abs(ctrl.travel.x) > 1e-6 || Math.abs(ctrl.travel.z) > 1e-6)) {
      travelWhileGrounded++;
    }

    trace.push({ t, hip: rig.bones.RightUpLeg.rotation.x, wrist: rig.bones.RightHand.rotation.x });

    t += STEP;
  }

  const apexErr = Math.abs(apexT - seq.releaseAt);
  // proximal-to-distal: time each joint first reaches 90% of its value at the
  // held follow-through, measured from the deepest load onward
  // The sample must land inside the HELD FOLLOW-THROUGH, which is what this
  // metric is about. releaseAt + 0.25 is inside it for every jumper, but a free
  // throw leaves the floor for only 0.3 s and has already touched down and begun
  // absorbing by then, so the sample was reading the landing crouch and calling
  // it the finish. The jump lands at liftAt + 2*(releaseAt - liftAt); sample
  // before that, whichever comes first.
  const landAt = 2 * seq.releaseAt - seq.liftAt;
  const settleAt = Math.min(seq.releaseAt + 0.25, landAt - STEP);
  const settle = trace[Math.min(trace.length - 1, Math.max(0, Math.round(settleAt / STEP)))];
  const cross = (key: "hip" | "wrist") => {
    const goal = settle[key];
    for (const s of trace) if (Math.abs(s[key] - goal) < Math.abs(goal) * 0.1 + 0.02) return s.t;
    return NaN;
  };
  const legT = cross("hip");
  const wristT = cross("wrist");

  console.log(`  ${verb}`);
  console.log(`    release ${seq.releaseAt.toFixed(2)}s  apex ${apexT.toFixed(2)}s  err ${apexErr.toFixed(3)}s`);
  console.log(`    max jerk ${maxJerk.toFixed(3)} rad on ${maxJerkBone} @ ${maxJerkAt.toFixed(2)}s`);
  console.log(`    legs extend ${isNaN(legT) ? "-" : legT.toFixed(2)}s  wrist ${isNaN(wristT) ? "-" : wristT.toFixed(2)}s`);

  if (apexErr > STEP * 1.5) fail(`${verb}: jump apex ${apexT.toFixed(3)} misses release ${seq.releaseAt}`);
  // A flat limit across every bone is wrong for a shot. The wrist snap is the
  // fastest joint in the body by design - a gooseneck turns through most of a
  // right angle in about a tenth of a second - while the same speed at a hip or
  // a shoulder is a glitch. The limits below are per-bone for that reason, and
  // all of them remain far under the 1.000 rad discontinuity this check was
  // written to catch.
  const jerkLimit = /Hand$/.test(maxJerkBone) ? 0.30
    : /ForeArm$/.test(maxJerkBone) ? 0.22
    : 0.14;
  if (maxJerk > jerkLimit) {
    fail(`${verb}: joint pop, jerk ${maxJerk.toFixed(3)} rad on ${maxJerkBone} ` +
         `@ ${maxJerkAt.toFixed(2)}s (limit ${jerkLimit})`);
  }
  if (groundedFault) fail(`${verb}: rig went below the floor on ${groundedFault} frames`);

  // ---- airborne travel -----------------------------------------------------
  const want = seq.travel;
  if (want) {
    console.log(`    travels ${peakBack >= 0 ? "back" : "in"} ` +
      `${Math.abs(peakBack).toFixed(2)} ft (wants ${Math.abs(want.back).toFixed(2)})`);

    if (travelWhileGrounded) {
      fail(`${verb}: moved ${travelWhileGrounded} frames with the feet still down ` +
           `(that is a foot slide)`);
    }
    if (Math.abs(want.back) > 0.01) {
      if (Math.sign(peakBack) !== Math.sign(want.back)) {
        fail(`${verb}: travelled the wrong way (${peakBack.toFixed(2)} vs ${want.back})`);
      }
      if (Math.abs(peakBack) < Math.abs(want.back) * 0.7) {
        fail(`${verb}: only reached ${Math.abs(peakBack).toFixed(2)} ft of ` +
             `${Math.abs(want.back).toFixed(2)} ft of travel`);
      }
    }
    // and he must re-set to the shot spot rather than staying displaced
    let settled = 0;
    for (let k = 0; k < 200; k++) { ctrl.update(t + k * STEP, STEP); settled = k; }
    if (Math.abs(ctrl.travel.x) > 0.02 || Math.abs(ctrl.travel.z) > 0.02) {
      fail(`${verb}: never returned to the shot spot ` +
           `(${ctrl.travel.z.toFixed(2)}, ${ctrl.travel.x.toFixed(2)} after ${settled} frames)`);
    }
  }
  if (JUMPERS.has(verb) && !isNaN(legT) && !isNaN(wristT) && wristT < legT - 1e-9) {
    fail(`${verb}: wrist led the legs (${wristT.toFixed(2)} < ${legT.toFixed(2)})`);
  }
}

console.log(failures ? `\n${failures} FAILURES` : "\nall shot sequences OK");
process.exit(failures ? 1 : 0);
