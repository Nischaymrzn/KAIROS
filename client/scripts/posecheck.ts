/**
 * POSE CHECK — the shooting arm must never reach backwards.
 *
 * Arm bones hang down (0,-1,0) in the bind pose and the player faces +Z, so a
 * local X rotation t points the segment at (0, -cos t, -sin t). Expressed as
 * degrees forward of straight up, a release pose has to INCREASE down the chain:
 * shoulder, then elbow, then wrist, each further toward the rim.
 *
 * When it decreases, the wrist sits behind the elbow. Since the ball is parented
 * to the hand, it ends up above and behind the head and the shot reads as
 * reaching back for the ball before throwing it. That was true of all seven
 * overhead release poses at once, which is why this is a check and not a
 * one-time fix.
 *
 * Only poses with the arm actually raised are judged; idle, gather and defensive
 * stances legitimately hold the forearm folded.
 */
import { POSES, Pose } from "../src/player/animation/poses";

// A RELEASE pose has both the shoulder and the elbow carried toward the rim.
// Loading poses (rise, tuck, gather) keep the elbow folded well forward-and-down
// so the ball can sit at the set point, and there the wrist SHOULD cock back
// under it — that is correct form, not a fault, so they are not judged here.
const SHOULDER_MAX_DEG = 90;
const ELBOW_MAX_DEG = 100;
const TOLERANCE_DEG = 2;

/** Local X rotation -> degrees forward of straight up. */
const fwd = (t: number) => ((t + Math.PI) * 180) / Math.PI;

/** The wrist genuinely lays back on a reverse finish: the ball goes up on the
 *  far side of the rim. The elbow still may not fold. */
const HAND_MAY_LAY_BACK = new Set(["reverse", "rise"]);

/**
 * The SET POINT is the one place the forward-progression rule does not apply.
 * "Elbow under the ball" means exactly that the forearm is carried closer to
 * vertical than the upper arm, with the wrist cocked back beneath the ball. It
 * is correct form rather than the fault this check exists to catch, and the
 * chain going forward from there is asserted in handcheck.ts instead.
 */
const SET_POINT = new Set(["rise"]);

type Row = { pose: string; side: string; a: number; f: number; h: number | null };

const rows: Row[] = [];
for (const [name, pose] of Object.entries(POSES) as [string, Pose][]) {
  for (const side of ["Right", "Left"] as const) {
    const arm = pose[`${side}Arm` as keyof Pose] as number[] | undefined;
    const fore = pose[`${side}ForeArm` as keyof Pose] as number[] | undefined;
    const hand = pose[`${side}Hand` as keyof Pose] as number[] | undefined;
    if (!arm || !fore) continue;
    const a = fwd(arm[0]);
    const f = fwd(arm[0] + fore[0]);
    if (a > SHOULDER_MAX_DEG || f > ELBOW_MAX_DEG) continue; // still loading
    rows.push({ pose: name, side, a, f, h: hand ? fwd(arm[0] + fore[0] + hand[0]) : null });
  }
}

let failures = 0;
console.log("pose          side   shoulder    elbow     wrist");
for (const r of rows) {
  const elbowBack = !SET_POINT.has(r.pose) && r.f < r.a - TOLERANCE_DEG;
  const wristBack = r.h !== null && r.h < r.f - TOLERANCE_DEG && !HAND_MAY_LAY_BACK.has(r.pose);
  const bad = elbowBack || wristBack;
  if (bad) failures++;
  console.log(
    `  ${r.pose.padEnd(12)}${r.side.padEnd(6)}${r.a.toFixed(1).padStart(8)}${r.f
      .toFixed(1)
      .padStart(9)}${(r.h === null ? "-" : r.h.toFixed(1)).padStart(10)}` +
      (bad ? `   FAIL ${elbowBack ? "elbow folds back" : "wrist folds back"}` : "")
  );
}

console.log(
  failures === 0
    ? `\n${rows.length} release poses checked, none reach backwards`
    : `\n${failures} FAILURES`
);
process.exit(failures === 0 ? 0 : 1);
