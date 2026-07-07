/**
 * SHOOTER CHIP — who is shooting, choosable from ANY court surface (Court,
 * Defense, Physics, Challenge) without detouring to the Player Lab. Opens a
 * quick-pick list of the real roster; selection rebuilds the 3D body, reroutes
 * the model's player features, and updates the physics release — everywhere.
 */
import { useEffect, useRef, useState } from "react";
import { usePlayersStore } from "../state/playersStore";

export function ShooterChip() {
  const { roster, active, fetchRoster, selectPlayer } = usePlayersStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => fetchRoster(), [fetchRoster]);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = roster.filter(
    (p) => !query || (p.name ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="shooter-chip-wrap" ref={boxRef}>
      {open && (
        <div className="shooter-pop">
          <input
            className="text-input"
            placeholder="search players"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="shooter-pop-list">
            <button
              className={`roster-row ${active === null ? "active" : ""}`}
              onClick={() => { selectPlayer(null); setOpen(false); }}
            >
              <span className="roster-name">Generic player</span>
              <span className="roster-meta">league avg</span>
            </button>
            {filtered.map((p) => (
              <button
                key={p.id}
                className={`roster-row ${active?.id === p.id ? "active" : ""}`}
                onClick={() => { selectPlayer(p); setOpen(false); }}
              >
                <span className="roster-name">{p.name ?? `id ${p.id}`}</span>
                <span className="roster-meta">{p.position ?? "?"}</span>
              </button>
            ))}
            {roster.length === 0 && (
              <div className="an-stat" style={{ padding: 6 }}>Loading roster</div>
            )}
          </div>
        </div>
      )}
      <button
        className="shooter-chip"
        onClick={() => setOpen((v) => !v)}
        title="Choose who takes this shot. The real profile feeds the model, body and physics."
      >
        <span className="shooter-chip-icon">◉</span>
        {active?.name ?? "Generic player"}
        <span className="shooter-chip-caret">{open ? "▾" : "▴"}</span>
      </button>
    </div>
  );
}
