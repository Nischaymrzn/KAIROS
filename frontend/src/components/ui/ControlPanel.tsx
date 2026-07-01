import { useAppStore } from "@/store/useAppStore";
import { PLAYERS, SHOT_TYPES } from "@/lib/dummyData";

export function ControlPanel() {
  const scenario = useAppStore((s) => s.scenario);
  const patch = useAppStore((s) => s.patchScenario);
  const placeMode = useAppStore((s) => s.placeMode);
  const setPlaceMode = useAppStore((s) => s.setPlaceMode);
  const defenders = useAppStore((s) => s.defenders);
  const clearDefenders = useAppStore((s) => s.clearDefenders);
  const defenderDistance = useAppStore((s) => s.defenderDistance);
  const explorerOn = useAppStore((s) => s.explorerOn);
  const explorerBusy = useAppStore((s) => s.explorerBusy);
  const toggleExplorer = useAppStore((s) => s.toggleExplorer);
  const moveOn = useAppStore((s) => s.moveOn);
  const moveConfidence = useAppStore((s) => s.moveConfidence);
  const toggleMove = useAppStore((s) => s.toggleMove);

  return (
    <div className="panel card fade-up">
      <h3><span className="dot" /> Shot Setup</h3>

      <div className="field">
        <label>Shooter</label>
        <select className="sel" value={scenario.playerId}
          onChange={(e) => patch({ playerId: Number(e.target.value) })}>
          {PLAYERS.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.jersey} {p.name} · {p.position} · {Math.floor(p.heightIn / 12)}'{p.heightIn % 12}"
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Shot Type</label>
        <div className="seg wrap">
          {SHOT_TYPES.map((t) => (
            <button key={t.id} className={scenario.shotType === t.id ? "active" : ""}
              onClick={() => patch({ shotType: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Placing on court</label>
        <div className="seg">
          <button className={placeMode === "shooter" ? "active" : ""}
            onClick={() => setPlaceMode("shooter")}>● Shooter</button>
          <button className={placeMode === "defender" ? "active" : ""}
            onClick={() => setPlaceMode("defender")}>● Defender</button>
        </div>
      </div>

      <div className="field">
        <label>
          Defenders <b>{defenders.length}</b>
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>
            {defenders.length === 0
              ? "Wide open"
              : `Closest ${defenderDistance.toFixed(1)} ft`}
          </span>
          <button className="btn" style={{ padding: "6px 11px", fontSize: 12 }}
            disabled={defenders.length === 0} onClick={clearDefenders}>
            Clear
          </button>
        </div>
      </div>

      <div className="field">
        <label>Model analysis</label>
        <div className="seg">
          <button className={explorerOn ? "active" : ""} onClick={toggleExplorer}>
            🔥 Shot Explorer{explorerBusy ? " …" : ""}
          </button>
          <button className={moveOn ? "active" : ""} onClick={toggleMove}>
            ➰ Move Path
          </button>
        </div>
        {explorerOn && (
          <span style={{ fontSize: 11, color: "var(--text-2)", marginTop: 6, display: "block" }}>
            Make-probability heat map for this shot type.
            <span style={{ color: "#ef4444" }}> ■</span> low
            <span style={{ color: "#f59e0b" }}> ■</span> mid
            <span style={{ color: "#22c55e" }}> ■</span> high
          </span>
        )}
        {moveOn && (
          <span style={{ fontSize: 11, color: "var(--text-2)", marginTop: 6, display: "block" }}>
            Predicted approach into the shot · confidence {(moveConfidence * 100).toFixed(0)}%
          </span>
        )}
      </div>

      <p className="hint">
        💡 Click the court to place the {placeMode === "shooter" ? "shooter" : "defender"}.
        Switch above to place the other.
      </p>
    </div>
  );
}
