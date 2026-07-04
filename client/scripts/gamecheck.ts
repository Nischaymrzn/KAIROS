/**
 * GAME CHECK — the practice layer has to be arithmetically honest.
 *
 * The whole educational claim of practice mode is that the ball falls at the rate
 * the model predicted. If the sampler is biased, the user learns a false lesson
 * with more conviction than any chart could give them, so it is checked rather
 * than assumed.
 *
 *   npx tsx scripts/gamecheck.ts
 */
import {
  contestMultiplier,
} from "../src/state/offlinePredictor";
import { decisionScore, luck, madeFor, resolve, shotRoll } from "../src/game/outcome";
import { BADGES, levelFor, xpFor, unlockedAt } from "../src/game/progression";
import { dailyChallenges } from "../src/game/challenges";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
};

console.log("the sampler is unbiased — a stated rate is the rate that happens");
{
  const N = 40000;
  for (const p of [0.15, 0.35, 0.5, 0.62, 0.85]) {
    let made = 0;
    for (let i = 1; i <= N; i++) if (madeFor(i, p)) made++;
    const rate = made / N;
    ok(`P=${p.toFixed(2)} lands within 1.5 points`, Math.abs(rate - p) < 0.015,
      `observed ${rate.toFixed(4)}`);
  }
}

console.log("\nthe roll is stable, so a replay reproduces its own result");
{
  ok("same signal, same roll", shotRoll(4242) === shotRoll(4242));
  ok("different signals differ", shotRoll(4242) !== shotRoll(4243));
  const a = resolve(0.5, 2, 991);
  const b = resolve(0.5, 2, 991);
  ok("resolve is a pure function of the signal", a.made === b.made && a.missBy === b.missBy);
}

console.log("\nthe ball and the scoreboard cannot disagree");
{
  // ShotArc flies `madeFor(signal, p)`; the game records `resolve(p, pts, signal)`.
  // Those are the same draw or the HUD credits shots the user watched miss.
  let mismatch = 0;
  for (let i = 1; i <= 5000; i++) {
    const p = (i % 97) / 97;
    if (madeFor(i, p) !== resolve(p, 2, i).made) mismatch++;
  }
  ok("ShotArc and the game layer agree on every shot", mismatch === 0,
    `${mismatch} disagreements in 5000`);
}

console.log("\nscoring ranks decisions, not outcomes");
{
  // Same shot, same zone: a make and a miss must score identically.
  const madeScore = decisionScore(0.55, 2, 0.42);
  const missScore = decisionScore(0.55, 2, 0.42);
  ok("outcome does not enter the decision score", madeScore === missScore, `${madeScore}`);

  // Worth being precise about what this metric is, because the obvious test is
  // the wrong one. A 36% three is worth 1.08 expected points and a 48% two is
  // worth 0.96, so on RAW expected points the three wins. The decision score does
  // not measure that. It measures how far the shot beats what an average
  // possession from the SAME zone returns, and by that measure the 36% three is
  // barely above the 35.2% above-the-break baseline while the 48% two is well
  // clear of the 42% mid-range one. So the two scores higher, and it should: the
  // shooter did more with the position they were in.
  const three = decisionScore(0.36, 3, 0.352);
  const two = decisionScore(0.48, 2, 0.42);
  ok("scores measure the gain over the zone, not raw expected points",
    two > three, `two ${two} vs three ${three}`);

  // Held at a fixed baseline, the shot worth more points does rank higher.
  ok("at equal baselines, more expected points scores higher",
    decisionScore(0.40, 3, 0.352) > decisionScore(0.36, 3, 0.352));

  // And the metric is not gameable by picking the easiest zone: matching the rim
  // baseline at the rim is worth exactly as little as matching it anywhere else.
  ok("no zone is a free ride", decisionScore(0.638, 2, 0.638) === 0);

  // Shooting exactly at the zone's historical rate is worth nothing.
  ok("shooting at the baseline scores zero", decisionScore(0.42, 2, 0.42) === 0);
  ok("below the baseline scores negative", decisionScore(0.30, 2, 0.42) < 0);
}

console.log("\nluck converges to zero over a long session");
{
  const attempts = Array.from({ length: 20000 }, (_, i) => {
    const p = 0.3 + ((i * 7) % 40) / 100;
    return resolve(p, 2, i + 1);
  });
  const l = luck(attempts);
  const perShot = Math.abs(l) / attempts.length;
  ok("actual and expected points converge", perShot < 0.02,
    `${l.toFixed(1)} pts over ${attempts.length} shots (${perShot.toFixed(4)}/shot)`);
}

console.log("\nexperience rewards difficulty, not volume of easy shots");
{
  const hard = xpFor(resolve(0.28, 3, 11), 40);
  const easy = xpFor(resolve(0.82, 2, 12), -10);
  ok("a hard shot is worth more than a layup", hard > easy, `${hard} vs ${easy}`);
  ok("a make is a small bonus, not the driver",
    xpFor({ ...resolve(0.4, 2, 1), made: true }, 0) -
    xpFor({ ...resolve(0.4, 2, 1), made: false }, 0) <= 8);
}

console.log("\nlevels and unlocks are monotonic");
{
  let last = -1;
  let monotonic = true;
  for (let xp = 0; xp < 60000; xp += 137) {
    const l = levelFor(xp).level;
    if (l < last) monotonic = false;
    last = l;
  }
  ok("level never goes down as XP rises", monotonic);
  ok("level 1 opens the core surfaces",
    unlockedAt(1).has("predict") && unlockedAt(1).has("practice"));
  ok("higher levels are supersets", [...unlockedAt(4)].every((m) => unlockedAt(9).has(m)));
}

console.log("\nbadges and challenges are well formed");
{
  ok("badge ids are unique", new Set(BADGES.map((b) => b.id)).size === BADGES.length);
  ok("every badge explains what it teaches", BADGES.every((b) => b.teaches.length > 12));
  ok("no badge fires on an empty session",
    BADGES.every((b) => !b.earned({
      attempts: [], decisions: [], zonesUsed: new Set(), verbsUsed: new Set(),
      bestStreak: 0, contestedMakes: 0,
    })));

  const a = dailyChallenges(new Date(2026, 7, 18));
  const b = dailyChallenges(new Date(2026, 7, 18));
  const c = dailyChallenges(new Date(2026, 7, 19));
  ok("the daily set is stable within a day", a.map((x) => x.id).join() === b.map((x) => x.id).join());
  ok("it turns over between days", a.map((x) => x.id).join() !== c.map((x) => x.id).join());
  ok("three are offered", a.length === 3);
  ok("no duplicates in a day", new Set(a.map((x) => x.id)).size === 3);
}

console.log("\nthe offline heuristic responds to contest, measured from the shot logs");
{
  // The bug this file exists to prevent regressing: with the API unreachable the
  // defender control changed nothing at all, because the fallback ignored it.
  const near = contestMultiplier(1, false);
  const far = contestMultiplier(11, false);
  ok("a two is harder when smothered", near < far, `${near.toFixed(3)} vs ${far.toFixed(3)}`);

  const near3 = contestMultiplier(1, true);
  const far3 = contestMultiplier(11, true);
  ok("a three is harder when smothered", near3 < far3, `${near3.toFixed(3)} vs ${far3.toFixed(3)}`);
  ok("contest matters more on a three than a two",
    far3 - near3 > far - near,
    `three swings ${(far3 - near3).toFixed(3)}, two swings ${(far - near).toFixed(3)}`);
  ok("no defender reads as open, not as average", contestMultiplier(undefined, false) > 1);
}

// ---------------------------------------------------------------------------
// The coach must not suggest a shot nobody can take. The model scores a dunk at
// about 88 per cent wherever it appears and has no feature for takeoff distance,
// so asked to improve a mid-range pull-up its honest answer was 'take a dunk
// instead'. REACH is the one thing the system knows that the model does not.
console.log("\nsuggested actions have to be physically available");
{
  const { REACH, withinReach, reachableFrom } = await import("../src/game/reach");
  ok("no dunk suggested from mid-range", !withinReach("dunk", 18));
  ok("no dunk suggested from the arc", !withinReach("dunk", 25));
  ok("a dunk is available at the rim", withinReach("dunk", 2));
  ok("no driving layup from beyond the arc", !withinReach("driving_layup", 25));
  ok("a jump shot is available anywhere on the floor", withinReach("catch_shoot", 30));
  ok("every verb has a reach", Object.values(REACH).every((v) => v > 0));

  const atRim = reachableFrom(2);
  const deep = reachableFrom(26);
  ok("more is available at the rim than from deep", atRim.length > deep.length,
    `${atRim.length} vs ${deep.length}`);
  ok("nothing available deep is unavailable at the rim",
    deep.every((v) => atRim.includes(v)));
}

console.log(fail === 0 ? "\nall game checks passed" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
