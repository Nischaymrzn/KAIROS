/**
 * ENDPOINTS — one typed function per backend route. This file (with types.ts) is
 * the complete client-side knowledge of the API: swap or retrain a model behind
 * the backend and nothing outside `src/api/` changes.
 *
 * Movement waypoints come back in the model's chart frame; `waypointToWorld`
 * converts to court feet (lesson carried from the previous frontend:
 * worldX = basketX(-1) + w.y, worldZ = w.x).
 */
import { apiFetch } from "./http";
import { basketX } from "../constants/dimensions";
import type {
  Health,
  ModelInfo,
  CourtScenario,
  Prediction,
  BatchResponse,
  ExploreRequest,
  ExploreResponse,
  RankResponse,
  Delivery,
  DefendResponse,
  MoveResponse,
  ChartWaypoint,
  RosterResponse,
  RosterPlayer,
  RegistryResponse,
  TrackingScenario,
  TrackingPrediction,
  GameSession,
  DailyChallenge,
  AttemptResult,
  SavedShot,
  ReplayList,
  ReplayDetail,
  GamePlan,
} from "./types";

export const getHealth = (signal?: AbortSignal) =>
  apiFetch<Health>("/health", { signal, timeoutMs: 3000 });

export const getModelInfo = (signal?: AbortSignal) =>
  apiFetch<ModelInfo>("/model-info", { signal });

export const predictCourt = (scenario: CourtScenario, signal?: AbortSignal) =>
  apiFetch<Prediction>("/predict/court", { method: "POST", body: scenario, signal });

export const predictBatch = (points: CourtScenario[], signal?: AbortSignal) =>
  apiFetch<BatchResponse>("/predict/batch", { method: "POST", body: { points }, signal });

export const explore = (req: ExploreRequest, signal?: AbortSignal) =>
  apiFetch<ExploreResponse>("/explore", { method: "POST", body: req, signal });

export const rankShots = (scenario: CourtScenario, signal?: AbortSignal) =>
  apiFetch<RankResponse>("/rank", { method: "POST", body: scenario, signal });

export const defend = (scenario: CourtScenario, signal?: AbortSignal) =>
  apiFetch<DefendResponse>("/defend", { method: "POST", body: scenario, signal });

export const predictMove = (scenario: CourtScenario, signal?: AbortSignal) =>
  apiFetch<MoveResponse>("/predict/move", { method: "POST", body: scenario, signal });

/** Chart-frame waypoint → court feet [x, z]. */
export function waypointToWorld(w: ChartWaypoint): [number, number] {
  return [basketX(-1) + w.y, w.x];
}

// ---- players -------------------------------------------------------------------
export const getPlayers = (signal?: AbortSignal) =>
  apiFetch<RosterResponse>("/players", { signal });

export const getPlayerById = (id: number, signal?: AbortSignal) =>
  apiFetch<RosterPlayer>(`/players/${id}`, { signal });

// ---- model registry --------------------------------------------------------------
export const getModels = (signal?: AbortSignal) =>
  apiFetch<RegistryResponse>("/models", { signal });

// ---- tracking study model ----------------------------------------------------------
export const predictTracking = (s: TrackingScenario, signal?: AbortSignal) =>
  apiFetch<TrackingPrediction>("/predict/tracking", { method: "POST", body: s, signal });

// ---- game / challenge -----------------------------------------------------------------
export const createGameSession = (name: string, signal?: AbortSignal) =>
  apiFetch<GameSession>("/game/session", { method: "POST", body: { name }, signal });

export const getGameSession = (id: number, signal?: AbortSignal) =>
  apiFetch<GameSession>(`/game/session/${id}`, { signal });

export const getDailyChallenge = (signal?: AbortSignal) =>
  apiFetch<DailyChallenge>("/game/challenge/daily", { signal });

export const submitAttempt = (
  body: CourtScenario & { sessionId: number; challengeId?: number },
  signal?: AbortSignal,
) => apiFetch<AttemptResult>("/game/attempt", { method: "POST", body, signal });

export const getLeaderboard = (signal?: AbortSignal) =>
  apiFetch<GameSession[]>("/game/leaderboard", { signal });

export const saveShot = (
  body: CourtScenario & { label: string; sessionId?: number },
  signal?: AbortSignal,
) => apiFetch<SavedShot>("/game/shots", { method: "POST", body, signal });

export const listSavedShots = (sessionId?: number, signal?: AbortSignal) =>
  apiFetch<SavedShot[]>(`/game/shots${sessionId ? `?sessionId=${sessionId}` : ""}`, { signal });

// ---- real tracked replays -------------------------------------------------
export const listReplays = (limit = 40, signal?: AbortSignal) =>
  apiFetch<ReplayList>(`/replay/plays?limit=${limit}`, { signal });

export const getReplay = (gameId: number, eventId: number, signal?: AbortSignal) =>
  apiFetch<ReplayDetail>(`/replay/play/${gameId}/${eventId}`, { signal });

// ---- game plan ------------------------------------------------------------
export const getGamePlan = (distance: number, defender: number | null, signal?: AbortSignal) =>
  apiFetch<GamePlan>(
    `/scenario/plan?distance=${distance.toFixed(1)}` +
      (defender != null ? `&defender=${defender.toFixed(1)}` : ""),
    { signal },
  );

// ---- delivery -------------------------------------------------------------
// The plan says how good the shot is; this says how it should be taken.
export const getDelivery = (distance: number, signal?: AbortSignal) =>
  apiFetch<Delivery>(`/scenario/delivery?distance=${distance.toFixed(1)}`, { signal });
