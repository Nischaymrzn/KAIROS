/**
 * HTTP core — one typed fetch wrapper for every API call: JSON in/out, request
 * timeout, caller-provided AbortSignal (latest-wins loops), and the backend's
 * error envelope ({ error: { type, message } }) surfaced as a typed ApiError.
 * No other file in the client calls fetch() toward the backend.
 */
import { ensureApiBase, getApiBase, REQUEST_TIMEOUT_MS } from "./config";

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, timeoutMs = REQUEST_TIMEOUT_MS } = opts;

  // merge the caller's abort signal with our timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const onOuterAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (signal?.aborted) controller.abort(signal.reason);

  try {
    // Resolve the base before the first request rather than guessing at it.
    // Memoised in config.ts, so this awaits real work once and is a resolved
    // promise thereafter.
    await ensureApiBase();

    const res = await fetch(`${getApiBase()}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let type = "http_error";
      let message = `${method} ${path} → ${res.status}`;
      try {
        const payload = (await res.json()) as { error?: { type?: string; message?: string } };
        if (payload?.error) {
          type = payload.error.type ?? type;
          message = payload.error.message ?? message;
        }
      } catch {
        /* non-JSON error body — keep the defaults */
      }
      throw new ApiError(res.status, type, message);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Was this rejection a cancellation rather than a failure?
 *
 * React StrictMode mounts every effect twice in development: mount, unmount,
 * mount. The unmount runs the cleanup, which aborts the request the first mount
 * started. A panel that treats every rejection as an error therefore shows a
 * permanent failure message for a request that was merely superseded — and does
 * it only in development, which is the worst place for a phantom bug to live.
 *
 * Debounced callers hide this by accident, because the cleanup clears the timer
 * before a request is ever made. Callers that fetch immediately do not.
 */
export function isAbort(e: unknown): boolean {
  return (
    e instanceof DOMException && e.name === "AbortError"
  ) || (typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError");
}
