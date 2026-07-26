/**
 * TOP BAR — a name, three modes, and a dot.
 *
 * What used to live here: a level meter, an XP bar, four running scoreboards, a
 * streak counter, and "live model · v8 · catboost · AUC 0.701". That is a
 * telemetry readout, not a header. None of it was what anyone came to look at,
 * and it framed a basketball court with a progress bar.
 *
 * The model's identity has not been thrown away — it moved to the connection
 * dot's tooltip, which is where a person goes when they want to know what is
 * serving them, and nowhere else.
 */
import { useEffect, useState } from "react";
import { getHealth, getModelInfo, discoverApiBase, invalidateApiBase, HEALTH_POLL_MS, ModelInfo } from "../api";
import { setContestLive } from "../scenario/schema";
import { useModeStore, Mode } from "./modeStore";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "court", label: "Court", hint: "Build a shot and watch it" },
  { id: "predict", label: "Predict", hint: "Guess whether it goes in" },
  { id: "coach", label: "Coach", hint: "Change anything, see how to improve it" },
  { id: "learn", label: "Learn", hint: "Every parameter, then the shot explained" },
];

export function TopBar() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const [live, setLive] = useState<boolean | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    let dead = false;
    let seen: ModelInfo | null = null;

    const adopt = (m: ModelInfo | null) => {
      if (m && typeof m.contest_sensitive === "boolean") setContestLive(m.contest_sensitive);
      return m;
    };

    const check = async () => {
      try {
        await getHealth();
        if (!seen) seen = adopt(await getModelInfo().catch(() => null));
        if (!dead) { setLive(true); setInfo(seen); }
      } catch {
        invalidateApiBase();
        const found = await discoverApiBase();
        if (dead) return;
        if (found) {
          try {
            await getHealth();
            if (!seen) seen = adopt(await getModelInfo().catch(() => null));
            if (!dead) { setLive(true); setInfo(seen); }
            return;
          } catch { /* fall through to offline */ }
        }
        if (!dead) setLive(false);
      }
    };
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => { dead = true; clearInterval(timer); };
  }, []);

  const auc = info?.test_metrics?.auc;
  const tip = live
    ? `Served by the production model` +
      (info ? ` v${info.version}${info.model ? `, ${info.model}` : ""}${auc ? `, AUC ${auc.toFixed(3)}` : ""}` : "")
    : live === false
    ? "Backend unreachable. Showing a measured heuristic. Start it with make api."
    : "Connecting…";

  return (
    <header className="topbar">
      <div className="tb-brand">
        <img className="tb-mark" src="/image.png" alt="" width={22} height={22} />
        <span className="tb-word">KAIR<em>OS</em></span>
      </div>

      <nav className="tb-modes" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`tb-mode ${mode === m.id ? "on" : ""}`}
            onClick={() => setMode(m.id)}
            title={m.hint}
            aria-pressed={mode === m.id}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <span
        className={`tb-dot ${live === null ? "wait" : live ? "live" : "off"}`}
        title={tip}
        aria-label={tip}
      />
    </header>
  );
}
