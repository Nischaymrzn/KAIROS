/**
 * MODE — the three things a person actually comes here to do.
 *
 * The previous shell put every capability into one dock, which meant the right
 * side of the screen carried a stack of panels, a level meter, a model version
 * string and four scoreboards at all times. Everything was available and nothing
 * was legible.
 *
 * These are separate jobs and they deserve separate screens:
 *
 *   court    build a shot and watch it. The simulation.
 *   predict  guess whether a shot goes in, and find out. The game.
 *   coach    change anything, and be told how to make the shot better.
 *   learn    every parameter at once, with the shot explained afterwards.
 *
 * Analysis panels live in COURT only, closed until asked for. Levels, XP and
 * streaks live in PREDICT only — a progression meter above a physics sandbox was
 * decoration, and it was the first thing the eye landed on.
 */
import { create } from "zustand";

export type Mode = "court" | "predict" | "coach" | "learn";

const KEY = "hoopiq.mode.v2";

interface ModeState {
  mode: Mode;
  setMode(m: Mode): void;
}

export const useModeStore = create<ModeState>((set) => ({
  mode: ((): Mode => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "predict" || v === "coach" || v === "learn" ? v : "court";
    } catch {
      return "court";
    }
  })(),
  setMode(mode) {
    try { localStorage.setItem(KEY, mode); } catch { /* not important enough to fail */ }
    set({ mode });
  },
}));
