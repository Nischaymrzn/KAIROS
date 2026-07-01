/**
 * HoopIQ inference API client. Talks to the FastAPI service (backend/app.py)
 * that wraps the real production models. The dummy heuristic in
 * `dummyPredictor.ts` stays as an instant, offline fallback.
 */
import type { Prediction, ShotScenario } from "./types";
import { PLAYERS } from "./dummyData";
import { basketX } from "./courtDimensions";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const BASKET_X = basketX(-1); // -41.75

/** Backend returns Title-case quality labels; the UI uses lowercase. */
const QUALITY_MAP: Record<string, Prediction["quality"]> = {
  Excellent: "excellent",
  Good: "good",
  Average: "average",
  Poor: "poor",
  "Very Poor": "very poor",
};

/** Dashboard scenario -> the /predict/court request body. */
function toCourtBody(s: ShotScenario, defenderDistance: number) {
  const player = PLAYERS.find((p) => p.id === s.playerId) ?? PLAYERS[0];
  return {
    x: s.position.x,
    z: s.position.z,
    shotType: s.shotType,
    playerId: s.playerId,
    positionGroup: player.position,
    defenderDistance,
  };
}

/** Predict a shot via the real model. Throws on network / HTTP error so the
 * caller can fall back to the dummy predictor. */
export async function predictApi(
  s: ShotScenario,
  defenderDistance: number,
  signal?: AbortSignal,
): Promise<Prediction> {
  const res = await fetch(`${API_URL}/predict/court`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toCourtBody(s, defenderDistance)),
    signal,
  });
  if (!res.ok) throw new Error(`predict/court ${res.status}`);
  const body = await res.json();
  return {
    probability: body.probability,
    quality: QUALITY_MAP[body.quality] ?? "average",
  };
}

export interface CourtPoint {
  x: number;
  z: number;
  shotType: ShotScenario["shotType"];
  playerId: number;
  positionGroup: string;
}

/** Predict a whole grid of court points at once (Shot Explorer heat map). */
export async function predictBatch(
  points: CourtPoint[],
  signal?: AbortSignal,
): Promise<number[]> {
  const res = await fetch(`${API_URL}/predict/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
    signal,
  });
  if (!res.ok) throw new Error(`predict/batch ${res.status}`);
  const body = await res.json();
  return body.predictions.map((p: { probability: number }) => p.probability);
}

/** A predicted movement waypoint, already converted to world court coords. */
export interface MoveWaypoint {
  x: number; // world court x (feet)
  z: number; // world court z (feet)
}

/** Predict the likely approach path into a shot at the given court spot. */
export async function predictMove(
  s: ShotScenario,
  signal?: AbortSignal,
): Promise<{ moveType: string; confidence: number; path: MoveWaypoint[] }> {
  const res = await fetch(`${API_URL}/predict/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toCourtBody(s, 12)),
    signal,
  });
  if (!res.ok) throw new Error(`predict/move ${res.status}`);
  const body = await res.json();
  // waypoints come in the chart frame (x lateral, y = feet from basket);
  // map to world court coords: worldX = basketX(-1) + y, worldZ = x.
  const path: MoveWaypoint[] = body.waypoints.map(
    (w: { x: number; y: number }) => ({ x: BASKET_X + w.y, z: w.x }),
  );
  return { moveType: body.move_type, confidence: body.confidence, path };
}
