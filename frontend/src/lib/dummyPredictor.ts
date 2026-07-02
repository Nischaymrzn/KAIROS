/**
 * Dummy shot-quality predictor — a transparent heuristic stand-in for the real
 * model, so the UI is interactive with placeholder data. Returns a make
 * probability + quality label. Replaced later by the FastAPI inference service.
 */
import { basketX, THREE_RADIUS } from "./courtDimensions";
import type { Prediction, ShotScenario } from "./types";
import { PLAYERS } from "./dummyData";

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Distance (ft) from a court point to the left/home basket. */
export function distanceToBasket(x: number, z: number): number {
  return Math.hypot(x - basketX(-1), z);
}

/** 3 if beyond the arc, else 2 (simplified radial test). */
export function pointValue(x: number, z: number): 2 | 3 {
  return distanceToBasket(x, z) >= THREE_RADIUS ? 3 : 2;
}

const SHOT_BASE: Record<string, number> = {
  dunk: 2.6, driving_layup: 0.9, floater: 0.1, hook: 0.0,
  catch_shoot: 0.25, pullup: -0.1, stepback: -0.25, fadeaway: -0.35,
};

/** Predict make probability. `defenderDistance` comes from placed defenders. */
export function predict(s: ShotScenario, defenderDistance: number): Prediction {
  const dist = distanceToBasket(s.position.x, s.position.z);
  const pts = pointValue(s.position.x, s.position.z);
  const player = PLAYERS.find((p) => p.id === s.playerId) ?? PLAYERS[0];

  let z = 0.55;
  z += -0.085 * dist; // farther = harder
  z += SHOT_BASE[s.shotType] ?? 0; // shot-type difficulty
  z += 0.16 * (defenderDistance - 4); // more space = better
  z += pts === 3 ? -0.35 : 0;
  z += (s.shotType === "catch_shoot" ? player.catchShootRate - 0.3 : 0) * 1.2;
  z += (s.shotType === "pullup" ? player.pullUpRate - 0.2 : 0) * 1.2;

  const probability = Math.min(0.985, Math.max(0.02, sigmoid(z)));
  return { probability, quality: qualityLabel(probability) };
}

export function qualityLabel(p: number): Prediction["quality"] {
  if (p >= 0.6) return "excellent";
  if (p >= 0.5) return "good";
  if (p >= 0.4) return "average";
  if (p >= 0.3) return "poor";
  return "very poor";
}

export const QUALITY_COLOR: Record<Prediction["quality"], string> = {
  excellent: "var(--q-excellent)",
  good: "var(--q-good)",
  average: "var(--q-average)",
  poor: "var(--q-poor)",
  "very poor": "var(--q-verypoor)",
};

/** Default starting scenario (a mid-range pull-up). */
export function defaultScenario(): ShotScenario {
  return {
    position: { x: basketX(-1) + 14, z: 6 },
    shotType: "pullup",
    playerId: 1,
  };
}
