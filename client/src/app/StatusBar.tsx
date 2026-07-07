import { useEffect, useState } from "react";
import {
  getHealth, getModelInfo, discoverApiBase, invalidateApiBase, HEALTH_POLL_MS, ModelInfo,
} from "../api";
import { setContestLive } from "../scenario/schema";

/**
 * STATUS BAR — the live link to the inference backend, shown as a small chip.
 * Polls /health; on first contact reads /model-info so the model's version and
 * held-out AUC come from the frozen bundle's manifest at runtime (the client
 * never hardcodes model facts — swap the model server-side and this updates).
 */
type Status =
  | { kind: "checking" }
  | { kind: "live"; info: ModelInfo | null }
  | { kind: "offline" };

export function StatusBar() {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    let info: ModelInfo | null = null;

    /** Adopt the served model's own answer on whether contest moves it. */
    const adopt = (m: ModelInfo | null) => {
      if (m && typeof m.contest_sensitive === "boolean") setContestLive(m.contest_sensitive);
      return m;
    };

    const check = async () => {
      try {
        await getHealth();
        if (!info) info = adopt(await getModelInfo().catch(() => null));
        if (!cancelled) setStatus({ kind: "live", info });
      } catch {
        // the base may have drifted (backend restarted on another port) —
        // re-discover among the known candidates before declaring offline.
        // Clearing the memoised resolution first, or discovery would hand back
        // the same dead base it resolved at startup.
        invalidateApiBase();
        const found = await discoverApiBase();
        if (cancelled) return;
        if (found) {
          try {
            await getHealth();
            if (!info) info = adopt(await getModelInfo().catch(() => null));
            if (!cancelled) setStatus({ kind: "live", info });
            return;
          } catch {
            /* fall through */
          }
        }
        if (!cancelled) setStatus({ kind: "offline" });
      }
    };
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (status.kind === "checking") {
    return <div className="status-chip checking">connecting</div>;
  }
  if (status.kind === "offline") {
    return (
      <div className="status-chip offline" title="Inference API unreachable. Start it with make api.">
        <span className="dot" /> model offline
      </div>
    );
  }
  const info = status.info;
  const auc = info?.test_metrics?.auc;
  return (
    <div className="status-chip live" title="Predictions served by the frozen production model">
      <span className="dot" /> live model
      {info && (
        <span className="meta">
          v{String(info.version)}
          {info.model ? ` · ${info.model}` : ""}
          {auc ? ` · AUC ${auc.toFixed(3)}` : ""}
        </span>
      )}
    </div>
  );
}
