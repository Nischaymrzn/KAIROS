/**
 * SCENARIO STORE — one scenario, one prediction, everything else derived.
 *
 * Any change to the scenario re-derives distance, zone, contest geometry and
 * expected points, and asks the prediction engine for a new probability on the
 * shared debounced channel. Nothing else in the app is allowed to hold its own
 * copy of the situation; pages read from here.
 */
import { create } from "zustand";
import {
  DEFAULT_SCENARIO, DefenderRole, DefenderSpot, Scenario, ShotVerb,
  contest, expectedPoints, pointValue, shotDistance, zoneOf, ZONE_BASE, ZoneId,
} from "./schema";
import { clearPredictionCache, createPredictionChannel, Prediction } from "./predictionEngine";
import { onApiBaseChange } from "../api";

const MAX_DEFENDERS = 5;
/** clicking within this of a placed defender removes him rather than adding */
const REMOVE_RADIUS_FT = 2.5;

let nextId = 1;
const makeDefender = (x: number, z: number, role: DefenderRole): DefenderSpot => ({
  id: `d${nextId++}`, x, z, role,
});

export interface Derived {
  distance: number;
  zone: ZoneId;
  points: number;
  zoneRate: number;
  contest: ReturnType<typeof contest>;
  expectedPoints: number | null;
  /** model probability minus the zone's historical rate, in points */
  vsZone: number | null;
}

interface ScenarioState {
  scenario: Scenario;
  prediction: Prediction | null;
  pending: boolean;
  /** bumped when the user fires a shot, so 3D layers animate */
  shootSignal: number;

  derived(): Derived;

  setPosition(x: number, z: number): void;
  setShotType(t: ShotVerb): void;
  setPlayer(playerId: number, positionGroup: string, name?: string): void;
  setGame(patch: Partial<Scenario["game"]>): void;
  setMechanics(patch: Partial<Scenario["mechanics"]>): void;

  addDefender(x: number, z: number, role?: DefenderRole): void;
  moveDefender(id: string, x: number, z: number): void;
  removeDefender(id: string): void;
  setDefenderRole(id: string, role: DefenderRole): void;
  clearDefenders(): void;
  /** place the nearest defender on the shooter->rim line at `dist` ft */
  setNearestOnLine(dist: number): void;

  load(s: Scenario): void;
  reset(): void;
  triggerShot(): void;
  refresh(immediate?: boolean): void;
}

export const useScenarioStore = create<ScenarioState>((set, get) => {
  const channel = createPredictionChannel(({ prediction, pending }) =>
    set({ prediction, pending })
  );

  const ask = (immediate = false) => {
    const s = get().scenario;
    immediate ? channel.requestNow(s) : channel.request(s);
  };

  /** apply a scenario patch, then re-predict */
  const patch = (fn: (s: Scenario) => Scenario, immediate = false) => {
    set((st) => ({ scenario: fn(st.scenario) }));
    ask(immediate);
  };

  return {
    scenario: DEFAULT_SCENARIO,
    prediction: null,
    pending: false,
    shootSignal: 0,

    derived() {
      const s = get().scenario;
      const p = get().prediction?.probability ?? null;
      const zone = zoneOf(s);
      return {
        distance: shotDistance(s),
        zone,
        points: pointValue(s),
        zoneRate: ZONE_BASE[zone].rate,
        contest: contest(s),
        expectedPoints: p == null ? null : expectedPoints(s, p),
        vsZone: p == null ? null : (p - ZONE_BASE[zone].rate) * 100,
      };
    },

    setPosition(x, z) {
      patch((s) => ({ ...s, shot: { ...s.shot, x, z } }));
    },
    setShotType(shotType) {
      patch((s) => ({ ...s, shot: { ...s.shot, shotType } }));
    },
    setPlayer(playerId, positionGroup, name) {
      patch((s) => ({ ...s, player: { playerId, positionGroup, name } }));
    },
    setGame(p) {
      patch((s) => ({ ...s, game: { ...s.game, ...p } }));
    },
    setMechanics(p) {
      // physics only: the model never sees these, so do not spend a request
      set((st) => ({ scenario: { ...st.scenario, mechanics: { ...st.scenario.mechanics, ...p } } }));
    },

    addDefender(x, z, role = "primary") {
      const s = get().scenario;
      const hit = s.defenders.find((d) => Math.hypot(d.x - x, d.z - z) < REMOVE_RADIUS_FT);
      if (hit) return get().removeDefender(hit.id);
      if (s.defenders.length >= MAX_DEFENDERS) return;
      const r: DefenderRole = s.defenders.length === 0 ? "primary" : role === "primary" ? "help" : role;
      patch((c) => ({ ...c, defenders: [...c.defenders, makeDefender(x, z, r)] }));
    },
    moveDefender(id, x, z) {
      patch((s) => ({ ...s, defenders: s.defenders.map((d) => (d.id === id ? { ...d, x, z } : d)) }));
    },
    removeDefender(id) {
      patch((s) => ({ ...s, defenders: s.defenders.filter((d) => d.id !== id) }));
    },
    setDefenderRole(id, role) {
      patch((s) => ({ ...s, defenders: s.defenders.map((d) => (d.id === id ? { ...d, role } : d)) }));
    },
    clearDefenders() {
      patch((s) => ({ ...s, defenders: [] }));
    },
    setNearestOnLine(dist) {
      const s = get().scenario;
      const dx = -41.75 - s.shot.x;
      const dz = 0 - s.shot.z;
      const len = Math.hypot(dx, dz) || 1;
      const x = s.shot.x + (dx / len) * dist;
      const z = s.shot.z + (dz / len) * dist;
      const c = contest(s);
      if (c.closest == null) return get().addDefender(x, z, "primary");
      const nearest = [...s.defenders]
        .sort((a, b) =>
          Math.hypot(a.x - s.shot.x, a.z - s.shot.z) - Math.hypot(b.x - s.shot.x, b.z - s.shot.z))[0];
      get().moveDefender(nearest.id, x, z);
    },

    load(next) {
      set({ scenario: next });
      ask(true);
    },
    reset() {
      set({ scenario: DEFAULT_SCENARIO });
      ask(true);
    },
    triggerShot() {
      set((s) => ({ shootSignal: s.shootSignal + 1 }));
    },
    refresh(immediate = false) {
      ask(immediate);
    },
  };
});

/** Fire the first prediction once at boot so the panel is never empty. */
let booted = false;
export function bootScenario() {
  if (booted) return;
  booted = true;
  useScenarioStore.getState().refresh(true);
}

// If the backend moves — discovered at startup, or healed after a restart on a
// different port — anything that answered from the offline heuristic while the
// base was wrong is now answerable for real. Re-ask.
//
// Without this the interface contradicts itself: the status chip goes green
// because discovery succeeded, while the headline probability is still the
// heuristic's, because nothing told the prediction to try again.
onApiBaseChange(() => {
  clearPredictionCache();
  if (booted) useScenarioStore.getState().refresh(true);
});
