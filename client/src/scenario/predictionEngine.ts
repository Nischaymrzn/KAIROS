/**
 * PREDICTION ENGINE — owns every call to the shot model.
 *
 * One place, so an endpoint mistake cannot be repeated across the app: /predict
 * takes snake_case and defaults every field it does not recognise, so posting a
 * camelCase body there returns a constant for every input while looking like it
 * worked. Only /predict/court is used, and only through here.
 *
 * Guarantees:
 *   - 300 ms debounce, so dragging a defender does not fire per pixel.
 *   - Latest wins. Responses are gated on a sequence number as well as abort,
 *     because an aborted request that already resolved can still land late.
 *   - A cache keyed on the exact payload, so sweeps and what-if comparisons do
 *     not re-ask the same question. Bounded, oldest evicted first.
 *   - A failure is reported as offline, never as a model result.
 */
import { predictCourt } from "../api";
import { offlinePredict } from "../state/offlinePredictor";
import { CourtPayload, Scenario, toCourtPayload } from "./schema";

export interface ShotFactor {
  feature: string;
  contribution: number;
}

export interface Prediction {
  probability: number;
  quality: string;
  factors: ShotFactor[];
  source: "live" | "offline";
}

const DEBOUNCE_MS = 300;
const CACHE_MAX = 400;

const cache = new Map<string, Prediction>();

function remember(key: string, value: Prediction) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

const keyOf = (p: CourtPayload) => JSON.stringify(p);

/**
 * One prediction, no debounce and no cancellation — for sweeps and what-if
 * probes where the caller wants every answer, not just the newest. Cached.
 */
export async function predictOnce(payload: CourtPayload, signal?: AbortSignal): Promise<Prediction> {
  const key = keyOf(payload);
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await predictCourt(payload, signal);
    const out: Prediction = {
      probability: res.probability,
      quality: res.quality,
      factors: res.factors ?? [],
      source: "live",
    };
    remember(key, out);
    return out;
  } catch (e) {
    if (signal?.aborted) throw e;
    // Never cached: an offline heuristic must not be served later as a hit that
    // looks the same as a model answer.
    return { ...offlinePredict(payload), factors: [], source: "offline" };
  }
}

export function predictScenarioOnce(s: Scenario, signal?: AbortSignal) {
  return predictOnce(toCourtPayload(s), signal);
}

/**
 * A debounced channel for the live scenario. Each channel keeps its own timer
 * and sequence, so the court's stream and a panel's stream cannot cancel each
 * other.
 */
export function createPredictionChannel(
  onState: (s: { prediction: Prediction | null; pending: boolean }) => void
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  let seq = 0;
  let last: Prediction | null = null;

  const run = async (payload: CourtPayload) => {
    const mine = ++seq;
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;

    const cached = cache.get(keyOf(payload));
    if (cached) {
      last = cached;
      onState({ prediction: cached, pending: false });
      return;
    }

    try {
      const out = await predictOnce(payload, ctrl.signal);
      if (mine !== seq) return; // superseded
      last = out;
      onState({ prediction: out, pending: false });
    } catch {
      if (mine !== seq) return;
      onState({ prediction: last, pending: false });
    }
  };

  return {
    /** Ask for a prediction; collapses bursts into one call. */
    request(s: Scenario) {
      const payload = toCourtPayload(s);
      if (timer) clearTimeout(timer);
      onState({ prediction: last, pending: true });
      timer = setTimeout(() => void run(payload), DEBOUNCE_MS);
    },
    /** Skip the debounce — for an explicit action like Apply or Simulate. */
    requestNow(s: Scenario) {
      if (timer) clearTimeout(timer);
      onState({ prediction: last, pending: true });
      void run(toCourtPayload(s));
    },
    dispose() {
      if (timer) clearTimeout(timer);
      inflight?.abort();
    },
  };
}

export const predictionCacheSize = () => cache.size;
export const clearPredictionCache = () => cache.clear();
