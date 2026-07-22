/**
 * SHOT STORE — compatibility facade over the scenario engine.
 *
 * The scenario engine (`src/scenario/`) is the single owner of the situation.
 * This store keeps its original shape so the ~20 components that read it did not
 * all have to change at once, but it no longer holds state of its own: it
 * mirrors the scenario on every change and its setters delegate.
 *
 * Read `useScenarioStore` directly in new code. This exists so the migration
 * could be done in reviewable steps rather than one unverifiable rewrite.
 */
import { create } from "zustand";
import { useScenarioStore } from "../scenario/scenarioStore";
import type { Scenario, ShotVerb as EngineShotVerb } from "../scenario/schema";
import { contest } from "../scenario/schema";

export type ShotVerb = EngineShotVerb;

export interface ShotFactor {
  feature: string;
  contribution: number;
}

export interface PredictionState {
  probability: number;
  quality: string;
  factors: ShotFactor[];
  source: "live" | "offline";
  pending: boolean;
}

interface ShotState {
  scenario: {
    x: number;
    z: number;
    shotType: ShotVerb;
    playerId: number;
    positionGroup: string;
    /** closest placed defender, ft — undefined when none is on the floor */
    defenderDistance?: number;
  };
  prediction: PredictionState | null;
  shootSignal: number;

  setShotPosition(x: number, z: number): void;
  setShotType(shotType: ShotVerb): void;
  setShooter(playerId: number, positionGroup: string): void;
  setDefenderDistance(d: number | undefined): void;
  triggerShot(): void;
}

const S = () => useScenarioStore.getState();

function mapScenario(s: Scenario) {
  const c = contest(s);
  return {
    x: s.shot.x,
    z: s.shot.z,
    shotType: s.shot.shotType,
    playerId: s.player.playerId,
    positionGroup: s.player.positionGroup,
    defenderDistance: c.closest == null ? undefined : Math.round(c.closest * 10) / 10,
  };
}

function mapPrediction(): PredictionState | null {
  const { prediction, pending } = useScenarioStore.getState();
  if (!prediction) return null;
  return {
    probability: prediction.probability,
    quality: prediction.quality,
    factors: prediction.factors,
    source: prediction.source,
    pending,
  };
}

export const useShotStore = create<ShotState>(() => ({
  scenario: mapScenario(useScenarioStore.getState().scenario),
  prediction: mapPrediction(),
  shootSignal: useScenarioStore.getState().shootSignal,

  setShotPosition: (x, z) => S().setPosition(x, z),
  setShotType: (shotType) => S().setShotType(shotType),
  setShooter: (playerId, positionGroup) => S().setPlayer(playerId, positionGroup),
  /**
   * Legacy setter. The engine derives contest from where defenders actually
   * stand, so a bare distance is honoured by sliding the nearest defender onto
   * the shot line — which is what the number meant anyway.
   */
  setDefenderDistance: (d) => (d == null ? S().clearDefenders() : S().setNearestOnLine(d)),
  triggerShot: () => S().triggerShot(),
}));

// mirror: a new object only when something actually changed, so selectors on
// `s.scenario` and `s.prediction` keep stable identity between renders
let lastScenarioKey = "";
useScenarioStore.subscribe((s) => {
  const mapped = mapScenario(s.scenario);
  const key = JSON.stringify(mapped);
  const patch: Partial<ShotState> = { prediction: mapPrediction(), shootSignal: s.shootSignal };
  if (key !== lastScenarioKey) {
    lastScenarioKey = key;
    patch.scenario = mapped;
  }
  useShotStore.setState(patch);
});

/** Fire the initial prediction once at app start, so the panel is never empty. */
export function bootInitialPrediction() {
  void import("../scenario/scenarioStore").then((m) => m.bootScenario());
}
