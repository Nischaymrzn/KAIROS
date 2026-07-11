/**
 * CHALLENGES — objectives that run inside the environment rather than on a
 * separate page.
 *
 * A challenge is a predicate over the live session plus a target scenario the
 * user can jump straight into. The user never leaves the court to do one, which
 * was the main structural complaint about the previous build: every capability
 * had its own route, so doing anything meant losing what was on screen.
 *
 * The daily set is drawn deterministically from the date, so two people opening
 * the app on the same day get the same three, and so a challenge does not reroll
 * when the page reloads.
 */
import { rng } from "./outcome";
import type { ShotRecord } from "./gameStore";

export interface Challenge {
  id: string;
  name: string;
  brief: string;
  /** progress in [0,1] and a human-readable state */
  progress: (session: ShotRecord[]) => { done: number; target: number };
  xp: number;
  /** optional scenario to load when the user accepts */
  setup?: { x: number; z: number; verb: string; defenderFt?: number; shotClock?: number };
}

const count = (session: ShotRecord[], pred: (r: ShotRecord) => boolean) =>
  session.filter(pred).length;

export const CHALLENGE_POOL: Challenge[] = [
  {
    id: "corner-office",
    name: "Corner Office",
    brief: "Take five attempts from a corner three. It is the most efficient shot on the floor that is not a layup.",
    progress: (s) => ({ done: count(s, (r) => r.zone === "corner3"), target: 5 }),
    xp: 120,
    setup: { x: -38, z: 23, verb: "catch_shoot" },
  },
  {
    id: "contested",
    name: "Hand In Your Face",
    brief: "Take eight attempts with a defender inside three feet, and watch what contest does to the number.",
    progress: (s) => ({ done: count(s, (r) => r.defenderFt != null && r.defenderFt < 3), target: 8 }),
    xp: 150,
    setup: { x: -26, z: 4, verb: "pullup", defenderFt: 2 },
  },
  {
    id: "late-clock",
    name: "Two On The Shot Clock",
    brief: "Take six attempts with four seconds or less. Late-clock shots are worse, and the model prices it.",
    progress: (s) => ({ done: count(s, (r) => r.shotClock <= 4), target: 6 }),
    xp: 140,
    setup: { x: -24, z: -8, verb: "stepback", shotClock: 3 },
  },
  {
    id: "beat-baseline",
    name: "Beat The Zone",
    brief: "String together twelve attempts that each beat their zone's historical rate.",
    progress: (s) => {
      let best = 0;
      let run = 0;
      for (const r of s) {
        run = r.decision > 0 ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return { done: best, target: 12 };
    },
    xp: 200,
  },
  {
    id: "rim-runner",
    name: "Rim Runner",
    brief: "Score ten attempts inside the restricted area. The model is strongest here, which is where a coach needs it least.",
    progress: (s) => ({ done: count(s, (r) => r.zone === "restricted"), target: 10 }),
    xp: 90,
    setup: { x: -39, z: 1, verb: "driving_layup" },
  },
  {
    id: "long-range",
    name: "Deep Range",
    brief: "Take seven attempts from beyond twenty-six feet and watch expected points fall away.",
    progress: (s) => ({ done: count(s, (r) => r.distance > 26), target: 7 }),
    xp: 160,
    setup: { x: -14, z: 6, verb: "pullup" },
  },
  {
    id: "variety",
    name: "Whole Bag",
    brief: "Use six different shot types in one session.",
    progress: (s) => ({ done: new Set(s.map((r) => r.verb)).size, target: 6 }),
    xp: 130,
  },
  {
    id: "volume",
    name: "Get Up Shots",
    brief: "Put up thirty attempts. Watch actual points converge on expected points as you go.",
    progress: (s) => ({ done: s.length, target: 30 }),
    xp: 110,
  },
];

/** Days since epoch, so the set turns over at local midnight. */
const dayIndex = (d = new Date()) =>
  Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);

/** Three challenges for today, stable for the whole day. */
export function dailyChallenges(date = new Date()): Challenge[] {
  const next = rng(dayIndex(date));
  const pool = [...CHALLENGE_POOL];
  const out: Challenge[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  }
  return out;
}

export const challengeComplete = (c: Challenge, s: ShotRecord[]) => {
  const p = c.progress(s);
  return p.done >= p.target;
};
