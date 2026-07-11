/**
 * GAME STORE — the persistent player record and the live session.
 *
 * One store, read by the HUD, the practice module and the challenge module, so
 * the gamification is a property of the whole environment rather than something
 * that only exists on a page the user has to navigate to. Progress survives a
 * reload; the session resets.
 *
 * The two scores are deliberately separate and both are always visible:
 *   decision score  expected points above the zone baseline. What the game ranks.
 *   actual points   what the ball did. Shown next to it, and not ranked.
 * The gap between them is the thesis in one number, and it is on screen at all
 * times rather than argued for in a panel.
 */
import { create } from "zustand";
import { Attempt, decisionScore, luck, resolve } from "./outcome";
import { BADGES, BadgeContext, levelFor, unlockedAt, xpFor } from "./progression";

const STORAGE_KEY = "hoopiq.player.v1";

export interface ShotRecord extends Attempt {
  at: number;
  zone: string;
  verb: string;
  distance: number;
  defenderFt: number | null;
  shotClock: number;
  decision: number;
  xp: number;
  x: number;
  z: number;
}

/** What survives a reload. */
interface Persisted {
  xp: number;
  lifetimeAttempts: number;
  lifetimeMakes: number;
  badges: string[];
  bestStreak: number;
  bestDecision: number;
}

interface GameState extends Persisted {
  /** live session */
  session: ShotRecord[];
  streak: number;
  /** the most recent attempt, for the scene to animate and the HUD to flash */
  last: ShotRecord | null;
  /** practice mode makes the ball resolve; off means the court is a sandbox */
  practiceOn: boolean;

  level: number;
  levelInto: number;
  levelSpan: number;
  unlocked: Set<string>;
  /** badges earned during this session, so the HUD can announce them */
  justEarned: string[];

  record(input: {
    probability: number;
    points: number;
    zone: string;
    zoneRate: number;
    verb: string;
    distance: number;
    defenderFt: number | null;
    shotClock: number;
    x: number;
    z: number;
    /** the scenario store's shootSignal — the roll ShotArc already flew */
    signal: number;
  }): ShotRecord;

  setPractice(on: boolean): void;
  clearSession(): void;
  resetProgress(): void;
  dismissBadges(): void;

  /** derived, computed on read so nothing can go stale */
  sessionStats(): {
    attempts: number;
    makes: number;
    fgPct: number;
    expectedPoints: number;
    actualPoints: number;
    luck: number;
    decision: number;
    avgQuality: number;
  };
}

function load(): Persisted {
  const empty: Persisted = {
    xp: 0, lifetimeAttempts: 0, lifetimeMakes: 0,
    badges: [], bestStreak: 0, bestDecision: 0,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return empty;
  }
}

function save(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* private mode or quota — progress is a nicety, never block the app */
  }
}

export const useGameStore = create<GameState>((set, get) => {
  const p = load();
  const lv = levelFor(p.xp);

  return {
    ...p,
    session: [],
    streak: 0,
    last: null,
    practiceOn: true,
    level: lv.level,
    levelInto: lv.into,
    levelSpan: lv.span,
    unlocked: unlockedAt(lv.level),
    justEarned: [],

    record(input) {
      // the SAME roll ShotArc flew, so the scoreboard agrees with the ball
      const outcome = resolve(input.probability, input.points, input.signal);
      const decision = decisionScore(input.probability, input.points, input.zoneRate);
      const rec: ShotRecord = {
        ...outcome,
        at: Date.now(),
        zone: input.zone,
        verb: input.verb,
        distance: input.distance,
        defenderFt: input.defenderFt,
        shotClock: input.shotClock,
        decision,
        xp: 0,
        x: input.x,
        z: input.z,
      };
      rec.xp = xpFor(outcome, decision);

      const st = get();
      const session = [...st.session, rec];
      const streak = outcome.made ? st.streak + 1 : 0;
      const bestStreak = Math.max(st.bestStreak, streak);
      const xp = st.xp + rec.xp;
      const lvl = levelFor(xp);

      // badge re-evaluation over the whole session
      const ctx: BadgeContext = {
        attempts: session,
        decisions: session.map((r) => r.decision),
        zonesUsed: new Set(session.map((r) => r.zone)),
        verbsUsed: new Set(session.map((r) => r.verb)),
        bestStreak,
        contestedMakes: session.filter((r) => r.made && r.defenderFt != null && r.defenderFt < 3).length,
      };
      const had = new Set(st.badges);
      const fresh = BADGES.filter((b) => !had.has(b.id) && b.earned(ctx)).map((b) => b.id);
      const badges = fresh.length ? [...st.badges, ...fresh] : st.badges;

      const persisted: Persisted = {
        xp,
        lifetimeAttempts: st.lifetimeAttempts + 1,
        lifetimeMakes: st.lifetimeMakes + (outcome.made ? 1 : 0),
        badges,
        bestStreak,
        bestDecision: Math.max(st.bestDecision, decision),
      };
      save(persisted);

      set({
        ...persisted,
        session,
        streak,
        last: rec,
        level: lvl.level,
        levelInto: lvl.into,
        levelSpan: lvl.span,
        unlocked: unlockedAt(lvl.level),
        justEarned: fresh.length ? [...st.justEarned, ...fresh] : st.justEarned,
      });
      return rec;
    },

    setPractice: (practiceOn) => set({ practiceOn }),
    clearSession: () => set({ session: [], streak: 0, last: null }),
    dismissBadges: () => set({ justEarned: [] }),

    resetProgress: () => {
      const empty: Persisted = {
        xp: 0, lifetimeAttempts: 0, lifetimeMakes: 0,
        badges: [], bestStreak: 0, bestDecision: 0,
      };
      save(empty);
      const l = levelFor(0);
      set({
        ...empty, session: [], streak: 0, last: null, justEarned: [],
        level: l.level, levelInto: l.into, levelSpan: l.span, unlocked: unlockedAt(l.level),
      });
    },

    sessionStats() {
      const s = get().session;
      const attempts = s.length;
      const makes = s.filter((r) => r.made).length;
      const expected = s.reduce((t, r) => t + r.probability * r.points, 0);
      const actual = s.reduce((t, r) => t + (r.made ? r.points : 0), 0);
      return {
        attempts,
        makes,
        fgPct: attempts ? makes / attempts : 0,
        expectedPoints: expected,
        actualPoints: actual,
        luck: luck(s),
        decision: s.reduce((t, r) => t + r.decision, 0),
        avgQuality: attempts ? s.reduce((t, r) => t + r.probability, 0) / attempts : 0,
      };
    },
  };
});
