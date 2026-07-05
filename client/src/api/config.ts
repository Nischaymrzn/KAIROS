/**
 * API configuration with BASE AUTO-DISCOVERY. The backend may run on :8000
 * (`make api`) or another port (:8001 when 8000 is occupied) — the client must
 * never break over port drift. Candidates are probed in order (env override
 * first); the first one whose /health answers becomes the base. The StatusBar
 * re-runs discovery whenever health checks start failing, so a backend restart
 * on a different port heals automatically within one poll cycle.
 */

// `import.meta.env` only exists under Vite. Reading it directly threw in the
// headless checks, which is a real fragility rather than a test artefact: any
// non-Vite context (a node script, SSR) would hit the same wall.
const ENV_URL = (import.meta as { env?: Record<string, string | undefined> }).env
  ?.VITE_API_URL;

const CANDIDATES: string[] = [
  ...(ENV_URL ? [ENV_URL] : []),
  "http://localhost:8000",
  "http://localhost:8001",
].filter((v, i, a) => a.indexOf(v) === i);

let apiBase: string = CANDIDATES[0];

/** The currently-resolved backend base URL (synchronous — used by every request). */
export function getApiBase(): string {
  return apiBase;
}

// ---------------------------------------------------------------- base changes
//
// Discovery used to be something only the StatusBar ran, and only AFTER a health
// check had already failed. That left a window at startup in which `apiBase` was
// still CANDIDATES[0] — an unverified guess — and any request fired inside that
// window failed against a port with nothing on it.
//
// It is not a hypothetical window. With `.env.local` pointing at :8001 and the
// backend on :8000, the boot prediction fired at :8001, failed, and fell back to
// the offline heuristic. Discovery then healed the base, so the status chip read
// "live model" while the headline probability was still the heuristic's 53%
// against the model's actual 39.1%. The interface contradicted itself and the
// wrong number was the more prominent one.
//
// Two fixes, together. `ensureApiBase()` resolves the base ONCE before the first
// request goes out, and subscribers are told whenever the base actually moves so
// work that failed against the old one can be retried.

type BaseListener = (base: string) => void;
const listeners = new Set<BaseListener>();

/** Notified when the resolved base URL changes. Returns an unsubscribe. */
export function onApiBaseChange(fn: BaseListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function setApiBase(next: string) {
  if (next === apiBase) return;
  apiBase = next;
  for (const fn of listeners) fn(next);
}

let resolving: Promise<string | null> | null = null;

/**
 * Resolve the base before the first request. Memoised, so the hundred calls a
 * busy first paint makes collapse into one discovery pass. A single candidate
 * needs no probe — there is nothing to choose between.
 */
export function ensureApiBase(): Promise<string | null> {
  if (CANDIDATES.length < 2) return Promise.resolve(apiBase);
  if (!resolving) resolving = discoverApiBase();
  return resolving;
}

/** Force the next request to re-resolve — used when health checks start failing. */
export function invalidateApiBase() {
  resolving = null;
}

/** Probe the candidates in order; first live /health wins. Returns the base or
 *  null when nothing answers (offline mode). */
export async function discoverApiBase(): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${candidate}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        setApiBase(candidate);
        return candidate;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Default per-request timeout (ms). Interactive predictions are ~10–50 ms server
 *  time; anything past this means the backend is down or wedged. */
export const REQUEST_TIMEOUT_MS = 8000;

/** How often the StatusBar re-checks backend health (ms). */
export const HEALTH_POLL_MS = 15000;
