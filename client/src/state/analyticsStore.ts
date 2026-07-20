/**
 * ANALYTICS STORE — server-driven data for the three analysis surfaces.
 * Kept separate from the shot store so prediction updates never force
 * heat-map re-renders and vice versa.
 *
 * Each surface is fetched on demand (triggered by the panel opening or the
 * scenario changing) with the same latest-wins + offline-tolerant pattern.
 */
import { create } from "zustand";
import { explore, rankShots, defend, type HeatCell, type RankedShot, type ContestLevel, type CourtScenario } from "../api";

export interface AnalyticsState {
  // heat explorer
  heatCells: HeatCell[];
  heatLoading: boolean;
  heatShotType: string;

  // shot rank
  ranked: RankedShot[];
  rankLoading: boolean;

  // defend
  defendLevels: ContestLevel[];
  defendSwing: number | null;
  defendLoading: boolean;

  fetchHeat(shotType: string, positionGroup?: string): void;
  fetchRank(scenario: CourtScenario): void;
  fetchDefend(scenario: CourtScenario): void;
}

let heatCtrl: AbortController | null = null;
let rankCtrl: AbortController | null = null;
let defendCtrl: AbortController | null = null;
let rankDebounce: ReturnType<typeof setTimeout> | null = null;
let defendDebounce: ReturnType<typeof setTimeout> | null = null;

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  heatCells: [],
  heatLoading: false,
  heatShotType: "catch_shoot",

  ranked: [],
  rankLoading: false,

  defendLevels: [],
  defendSwing: null,
  defendLoading: false,

  fetchHeat(shotType, positionGroup = "G") {
    heatCtrl?.abort();
    heatCtrl = new AbortController();
    set({ heatLoading: true, heatShotType: shotType });
    explore({ shotType, positionGroup, step: 3, maxDist: 30 }, heatCtrl.signal)
      .then((r) => set({ heatCells: r.cells, heatLoading: false }))
      .catch((e) => { if (!heatCtrl?.signal.aborted) set({ heatLoading: false }); void e; });
  },

  fetchRank(scenario) {
    // debounce: rank calls predict 9 times — don't fire on every drag pixel
    if (rankDebounce) clearTimeout(rankDebounce);
    rankDebounce = setTimeout(() => {
      rankCtrl?.abort();
      rankCtrl = new AbortController();
      set({ rankLoading: true });
      rankShots(scenario, rankCtrl.signal)
        .then((r) => set({ ranked: r.ranked, rankLoading: false }))
        .catch((e) => { if (!rankCtrl?.signal.aborted) set({ rankLoading: false }); void e; });
    }, 400);
  },

  fetchDefend(scenario) {
    if (defendDebounce) clearTimeout(defendDebounce);
    defendDebounce = setTimeout(() => {
      defendCtrl?.abort();
      defendCtrl = new AbortController();
      set({ defendLoading: true });
      defend(scenario, defendCtrl.signal)
        .then((r) => set({ defendLevels: r.levels, defendSwing: r.contest_swing ?? null, defendLoading: false }))
        .catch((e) => { if (!defendCtrl?.signal.aborted) set({ defendLoading: false }); void e; });
    }, 300);
  },
}));
