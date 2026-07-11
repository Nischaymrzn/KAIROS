/**
 * PROGRESSION — levels, badges and what they unlock.
 *
 * The design intent is the one stated in the project's gamification section:
 * sustain habitual engagement rather than one-off use, and do it with mechanics
 * that reward understanding rather than time served. Every badge below is earned
 * by demonstrating something about shot quality, not by taking N shots.
 *
 * Badges are checked against the whole session, so they can be re-evaluated
 * cheaply after every attempt without tracking incremental state.
 */
import type { Attempt } from "./outcome";

// ------------------------------------------------------------------- levels

/**
 * Cumulative experience needed to reach each level. Quadratic, so early levels
 * arrive quickly and later ones take real sessions.
 *
 * Re-paced after measuring it. The original curve put the model registry at 7,140
 * XP — around 255 shots — and the defence panel at 11. That is the wrong shape
 * for this system: unlocking is meant to reveal the environment at a rate that
 * keeps someone curious, not to withhold most of the application from a user who
 * asked to have everything in one place. Every module is now reachable inside a
 * single sitting of roughly sixty shots, and contest is available from the start
 * because it is the feature the whole model version turns on.
 */
export const LEVELS = Array.from({ length: 25 }, (_, i) => 70 * i * i + 120 * i);

export function levelFor(xp: number): { level: number; into: number; span: number; next: number } {
  let level = 1;
  for (let i = 1; i < LEVELS.length; i++) if (xp >= LEVELS[i]) level = i + 1;
  const floor = LEVELS[level - 1] ?? 0;
  const ceil = LEVELS[level] ?? floor + 1;
  return { level, into: xp - floor, span: ceil - floor, next: ceil };
}

/**
 * Experience for one attempt. Weighted toward difficulty so that grinding
 * uncontested layups is the slowest possible route, which is the behaviour the
 * measure is meant to discourage.
 */
export function xpFor(a: Attempt, decision: number): number {
  const difficulty = 1 - a.probability;           // a 30% shot is worth more than a 70%
  const base = 10 + Math.round(difficulty * 40);
  const decisionBonus = Math.max(0, Math.round(decision / 4));
  const madeBonus = a.made ? 6 : 0;               // small: outcome must not dominate
  return base + decisionBonus + madeBonus;
}

// ------------------------------------------------------------------- badges

export interface Badge {
  id: string;
  name: string;
  /** what the user did to earn it */
  detail: string;
  /** the basketball or statistical idea it teaches */
  teaches: string;
  icon: string;
  earned: (s: BadgeContext) => boolean;
}

export interface BadgeContext {
  attempts: Attempt[];
  decisions: number[];
  zonesUsed: Set<string>;
  verbsUsed: Set<string>;
  bestStreak: number;
  contestedMakes: number;
}

export const BADGES: Badge[] = [
  {
    id: "first-look",
    name: "First Look",
    detail: "Took your first scored attempt.",
    teaches: "Every shot carries a probability before it is taken.",
    icon: "◉",
    earned: (s) => s.attempts.length >= 1,
  },
  {
    id: "shot-selector",
    name: "Shot Selector",
    detail: "Ten straight attempts that all beat their zone baseline.",
    teaches: "Good process is repeatable in a way that good outcomes are not.",
    icon: "▲",
    earned: (s) => {
      let run = 0;
      for (const d of s.decisions) {
        run = d > 0 ? run + 1 : 0;
        if (run >= 10) return true;
      }
      return false;
    },
  },
  {
    id: "unlucky",
    name: "Robbed",
    detail: "Missed a shot the model rated above 65 per cent.",
    teaches: "A good shot missing is the system working, not the system failing.",
    icon: "◇",
    earned: (s) => s.attempts.some((a) => !a.made && a.probability > 0.65),
  },
  {
    id: "lucky",
    name: "Bailed Out",
    detail: "Made a shot the model rated below 25 per cent.",
    teaches: "A bad shot falling does not make it a good decision.",
    icon: "◈",
    earned: (s) => s.attempts.some((a) => a.made && a.probability < 0.25),
  },
  {
    id: "cartographer",
    name: "Cartographer",
    detail: "Scored from all five zones.",
    teaches: "Difficulty is a property of the floor before it is anything else.",
    icon: "▦",
    earned: (s) => s.zonesUsed.size >= 5,
  },
  {
    id: "full-arsenal",
    name: "Full Arsenal",
    detail: "Used seven different shot types.",
    teaches: "Action type is one of the model's strongest categorical features.",
    icon: "✦",
    earned: (s) => s.verbsUsed.size >= 7,
  },
  {
    id: "under-pressure",
    name: "Under Pressure",
    detail: "Made five shots with a defender inside three feet.",
    teaches: "Contest is measurable, and v8 prices it directly.",
    icon: "⛨",
    earned: (s) => s.contestedMakes >= 5,
  },
  {
    id: "heater",
    name: "Heater",
    detail: "Eight makes in a row.",
    teaches: "Streaks appear in independent trials more often than intuition expects.",
    icon: "▮",
    earned: (s) => s.bestStreak >= 8,
  },
  {
    id: "regression",
    name: "Regression to the Mean",
    detail: "Took fifty attempts in one session.",
    teaches: "Given enough attempts, actual points converge on expected points.",
    icon: "∿",
    earned: (s) => s.attempts.length >= 50,
  },
  {
    id: "efficient",
    name: "Efficient",
    detail: "Averaged over 1.15 expected points across thirty attempts.",
    teaches: "Expected points is the currency, not field-goal percentage.",
    icon: "★",
    earned: (s) => {
      if (s.attempts.length < 30) return false;
      const xp = s.attempts.reduce((t, a) => t + a.probability * a.points, 0);
      return xp / s.attempts.length > 1.15;
    },
  },
];

/** Which modules a level unlocks, so progression opens the system up. */
export const UNLOCKS: { level: number; module: string; label: string }[] = [
  { level: 1, module: "predict", label: "Shot Lab" },
  { level: 1, module: "practice", label: "Practice" },
  // Contest is a core model feature under v8 and the single thing users most
  // expect to matter, so it is never gated.
  { level: 1, module: "defend", label: "Defence" },
  { level: 2, module: "explore", label: "Heat Map" },
  { level: 3, module: "physics", label: "Arc Lab" },
  { level: 3, module: "players", label: "Player Profiles" },
  { level: 4, module: "movement", label: "Movement" },
  { level: 4, module: "film", label: "Film Room" },
  { level: 5, module: "models", label: "Model Registry" },
];

export const unlockedAt = (level: number) =>
  new Set(UNLOCKS.filter((u) => u.level <= level).map((u) => u.module));
