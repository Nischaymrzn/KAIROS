import { create } from "zustand";
import type { Prediction, ShotScenario, Vec2 } from "@/lib/types";
import { defaultScenario, predict } from "@/lib/dummyPredictor";
import { predictApi, predictBatch, predictMove } from "@/lib/api";
import type { CourtPoint, MoveWaypoint } from "@/lib/api";
import { PLAYERS } from "@/lib/dummyData";
import { basketX } from "@/lib/courtDimensions";

export type PlaceMode = "shooter" | "defender";
export type ApiStatus = "loading" | "ok" | "error";
export type PredictionSource = "model" | "dummy";

export interface HeatCell {
  x: number;
  z: number;
  p: number;
}

const BASKET_X = basketX(-1); // -41.75

/** Defender distance (ft) = nearest placed defender; large value if none. */
const OPEN = 12;
function nearestDefenderDistance(shooter: Vec2, defenders: Vec2[]): number {
  if (defenders.length === 0) return OPEN;
  return Math.min(
    ...defenders.map((d) => Math.hypot(d.x - shooter.x, d.z - shooter.z)),
  );
}

/** Half-court sample grid (2 ft) within scoring range of the home basket. */
function courtGrid(): Vec2[] {
  const pts: Vec2[] = [];
  for (let x = -46; x <= -3; x += 2) {
    for (let z = -23; z <= 23; z += 2) {
      if (Math.hypot(x - BASKET_X, z) <= 30) pts.push({ x, z });
    }
  }
  return pts;
}
const GRID = courtGrid();

interface AppState {
  scenario: ShotScenario;
  defenders: Vec2[];
  placeMode: PlaceMode;
  prediction: Prediction;
  defenderDistance: number;
  apiStatus: ApiStatus;
  predictionSource: PredictionSource;

  explorerOn: boolean;
  explorerCells: HeatCell[];
  explorerBusy: boolean;

  moveOn: boolean;
  movePath: MoveWaypoint[];
  moveConfidence: number;

  setPosition: (p: Vec2) => void;
  patchScenario: (patch: Partial<ShotScenario>) => void;
  addDefender: (p: Vec2) => void;
  removeDefender: (i: number) => void;
  clearDefenders: () => void;
  setPlaceMode: (m: PlaceMode) => void;
  toggleExplorer: () => void;
  toggleMove: () => void;
}

/** Instant dummy prediction (also the offline fallback) + defender distance. */
function recompute(scenario: ShotScenario, defenders: Vec2[]) {
  const dd = nearestDefenderDistance(scenario.position, defenders);
  return { prediction: predict(scenario, dd), defenderDistance: dd };
}

const initial = defaultScenario();

export const useAppStore = create<AppState>((set, get) => ({
  scenario: initial,
  defenders: [],
  placeMode: "shooter",
  apiStatus: "loading",
  predictionSource: "dummy",
  explorerOn: false,
  explorerCells: [],
  explorerBusy: false,
  moveOn: false,
  movePath: [],
  moveConfidence: 0,
  ...recompute(initial, []),

  setPosition: (p) => {
    const scenario = { ...get().scenario, position: p };
    set({ scenario, ...recompute(scenario, get().defenders) });
    scheduleApi();
    if (get().moveOn) refreshMove();
  },
  patchScenario: (patch) => {
    const scenario = { ...get().scenario, ...patch };
    set({ scenario, ...recompute(scenario, get().defenders) });
    scheduleApi();
    if (get().explorerOn) refreshExplorer();
    if (get().moveOn) refreshMove();
  },
  addDefender: (p) => {
    const defenders = [...get().defenders, p];
    set({ defenders, ...recompute(get().scenario, defenders) });
    scheduleApi();
  },
  removeDefender: (i) => {
    const defenders = get().defenders.filter((_, idx) => idx !== i);
    set({ defenders, ...recompute(get().scenario, defenders) });
    scheduleApi();
  },
  clearDefenders: () => {
    set({ defenders: [], ...recompute(get().scenario, []) });
    scheduleApi();
  },
  setPlaceMode: (m) => set({ placeMode: m }),

  toggleExplorer: () => {
    const explorerOn = !get().explorerOn;
    set({ explorerOn });
    if (explorerOn) refreshExplorer();
    else set({ explorerCells: [] });
  },
  toggleMove: () => {
    const moveOn = !get().moveOn;
    set({ moveOn });
    if (moveOn) refreshMove();
    else set({ movePath: [], moveConfidence: 0 });
  },
}));

// --- real-model prediction (latest-wins, dummy stays as instant fallback) ---
let inflight: AbortController | null = null;
let seq = 0;

function scheduleApi() {
  const my = ++seq;
  inflight?.abort();
  inflight = new AbortController();
  const { scenario, defenderDistance } = useAppStore.getState();
  useAppStore.setState({ apiStatus: "loading" });
  predictApi(scenario, defenderDistance, inflight.signal)
    .then((prediction) => {
      if (my === seq)
        useAppStore.setState({ prediction, apiStatus: "ok", predictionSource: "model" });
    })
    .catch((e: Error) => {
      // AbortError = superseded by a newer request; ignore. Otherwise keep the
      // dummy prediction already in state and flag the API as offline.
      if (my === seq && e.name !== "AbortError")
        useAppStore.setState({ apiStatus: "error", predictionSource: "dummy" });
    });
}

// --- Shot Explorer heat grid (depends on shot type + shooter) --------------
let exInflight: AbortController | null = null;
let exSeq = 0;

function refreshExplorer() {
  const my = ++exSeq;
  exInflight?.abort();
  exInflight = new AbortController();
  const { scenario } = useAppStore.getState();
  const player = PLAYERS.find((p) => p.id === scenario.playerId) ?? PLAYERS[0];
  const points: CourtPoint[] = GRID.map((g) => ({
    x: g.x, z: g.z, shotType: scenario.shotType,
    playerId: scenario.playerId, positionGroup: player.position,
  }));
  useAppStore.setState({ explorerBusy: true });
  predictBatch(points, exInflight.signal)
    .then((probs) => {
      if (my !== exSeq) return;
      const explorerCells: HeatCell[] = GRID.map((g, i) => ({ x: g.x, z: g.z, p: probs[i] }));
      useAppStore.setState({ explorerCells, explorerBusy: false });
    })
    .catch((e: Error) => {
      if (my === exSeq && e.name !== "AbortError")
        useAppStore.setState({ explorerBusy: false });
    });
}

// --- Movement path (depends on shooter spot + shot type) -------------------
let mvInflight: AbortController | null = null;
let mvSeq = 0;

function refreshMove() {
  const my = ++mvSeq;
  mvInflight?.abort();
  mvInflight = new AbortController();
  const { scenario } = useAppStore.getState();
  predictMove(scenario, mvInflight.signal)
    .then((r) => {
      if (my === mvSeq)
        useAppStore.setState({ movePath: r.path, moveConfidence: r.confidence });
    })
    .catch((e: Error) => {
      if (my === mvSeq && e.name !== "AbortError")
        useAppStore.setState({ movePath: [], moveConfidence: 0 });
    });
}

// kick off an initial real-model prediction for the default scenario
scheduleApi();
