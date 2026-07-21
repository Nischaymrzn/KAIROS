/**
 * DEFENSE STORE — compatibility facade over the scenario engine.
 *
 * Defenders now live in the scenario, so every page sees the same ones and the
 * contest geometry is derived in one place. This keeps the original shape for
 * the components that already read it; new code should use `useScenarioStore`.
 *
 * The geometry feeds two model families, and they are not equivalent:
 *   production model  nearest defender distance. Live under v8, whose window
 *                     spans the two seasons where the measurement is public, so
 *                     this reaches the payload and moves the number. It was inert
 *                     under v7 and the UI still said so long after v8 shipped.
 *   tracking study    d1, d2, angle off the shot line, helper count — real
 *                     inputs to the 2015-16 model behind /predict/tracking.
 */
import { create } from "zustand";
import { useScenarioStore } from "../scenario/scenarioStore";
import { contest } from "../scenario/schema";
import type { Scenario } from "../scenario/schema";

export interface DefenderSpot {
  x: number;
  z: number;
}

export interface ContestGeometry {
  d1: number | null;
  d2: number | null;
  angle: number | null;
  helpers: number;
  nearestIndex: number | null;
}

interface DefenseState {
  defenders: DefenderSpot[];
  placement: "shooter" | "defender";

  setPlacement(p: "shooter" | "defender"): void;
  toggleDefenderAt(x: number, z: number): void;
  removeDefender(i: number): void;
  clearDefenders(): void;
  setNearestOnLine(dist: number): void;
}

/**
 * Contest geometry around a shooter. Kept as a free function with the original
 * signature because pages call it with an arbitrary shooter, not just the
 * current one; it now delegates to the engine so there is one definition.
 */
export function contestGeometry(
  shooter: { x: number; z: number },
  defenders: DefenderSpot[],
): ContestGeometry {
  const fake = {
    shot: { x: shooter.x, z: shooter.z, shotType: "pullup" },
    defenders: defenders.map((d, i) => ({ id: String(i), x: d.x, z: d.z, role: "help" })),
  } as unknown as Scenario;
  const c = contest(fake);
  if (c.closest == null) {
    return { d1: null, d2: null, angle: null, helpers: 0, nearestIndex: null };
  }
  let nearestIndex = 0;
  let best = Infinity;
  defenders.forEach((d, i) => {
    const dist = Math.hypot(d.x - shooter.x, d.z - shooter.z);
    if (dist < best) { best = dist; nearestIndex = i; }
  });
  return { d1: c.closest, d2: c.second, angle: c.angle, helpers: c.helpers, nearestIndex };
}

const S = () => useScenarioStore.getState();
const mapDefenders = (s: Scenario): DefenderSpot[] =>
  s.defenders.map((d) => ({ x: d.x, z: d.z }));

export const useDefenseStore = create<DefenseState>((set) => ({
  defenders: mapDefenders(useScenarioStore.getState().scenario),
  // Moving the shooter is the primary action, so it is the default. This used to
  // default to "defender" and get away with it because only three of the nine
  // routes mounted defenders at all; now that they are placeable everywhere, that
  // default would mean a court click never moved the shooter.
  placement: "shooter",

  setPlacement: (placement) => set({ placement }),
  toggleDefenderAt: (x, z) => S().addDefender(x, z),
  removeDefender: (i) => {
    const d = S().scenario.defenders[i];
    if (d) S().removeDefender(d.id);
  },
  clearDefenders: () => S().clearDefenders(),
  setNearestOnLine: (dist) => S().setNearestOnLine(dist),
}));

// mirror, with a stable array identity while the defenders are unchanged
let lastKey = "";
useScenarioStore.subscribe((s) => {
  const mapped = mapDefenders(s.scenario);
  const key = JSON.stringify(mapped);
  if (key === lastKey) return;
  lastKey = key;
  useDefenseStore.setState({ defenders: mapped });
});
