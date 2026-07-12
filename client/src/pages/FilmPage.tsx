/**
 * FILM ROOM — the animation-replay analysis surface. Every shot fired anywhere
 * in the app is logged here automatically (shooter, spot, shot type, the
 * model's verdict at the moment of release). REPLAY restores that exact
 * context — the player, the spot, the verb, even the defender distance — and
 * rolls the full animation again with the cinematic shot cam.
 */
import { useFilmStore, FilmClip } from "../state/filmStore";
import { basketX } from "../constants/dimensions";

const QUALITY_COLOR: Record<string, string> = {
  Excellent: "#35c26e", Good: "#6fcf97", Average: "#f2c94c",
  Poor: "#f2994a", "Very Poor": "#eb5757",
};

function clipTitle(c: FilmClip): string {
  const dist = Math.hypot(basketX(-1) - c.x, c.z).toFixed(0);
  return `${c.playerName ?? "Generic"} · ${c.shotType.replace(/_/g, " ")} · ${dist} ft`;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function FilmPage() {
  const { clips, replayingId, replay, remove, clear } = useFilmStore();

  return (
    <>
      <div className="side-panel left wide">
        <div className="panel-title">Film Room</div>
        <div className="panel-note">
          every shot you fire — on any page — is logged here with the model's
          verdict at release; replay restores the shooter, spot and context and
          rolls the animation again (outcome re-sampled at the same odds)
        </div>

        {clips.length === 0 && (
          <div className="an-stat" style={{ marginTop: 8 }}>
            no clips yet — go to Court, place a shot and press SHOOT
          </div>
        )}

        {clips.length > 0 && (
          <div className="an-label" style={{ marginTop: 4 }}>
            {clips.length} clip{clips.length === 1 ? "" : "s"}
            <button className="mini-btn" style={{ marginLeft: 8, padding: "2px 8px" }} onClick={clear}>
              clear all
            </button>
          </div>
        )}

        {clips.map((c) => (
          <div key={c.id} className={`clip-row ${replayingId === c.id ? "playing" : ""}`}>
            <div className="clip-main">
              <div className="clip-title">{clipTitle(c)}</div>
              <div className="clip-meta">
                {c.probability != null && (
                  <span style={{ color: QUALITY_COLOR[c.quality ?? ""] ?? "#888", fontWeight: 700 }}>
                    {Math.round(c.probability * 100)}% {c.quality}
                  </span>
                )}
                {c.defenderDistance != null && <span> · def {c.defenderDistance.toFixed(1)} ft</span>}
                {c.source === "offline" && <span> · offline est.</span>}
                <span> · {timeAgo(c.at)}</span>
              </div>
            </div>
            <button
              className="mini-btn"
              disabled={replayingId != null}
              onClick={() => replay(c)}
              title="Restore this exact context and roll the animation"
            >
              {replayingId === c.id ? "▶ rolling" : "▶ replay"}
            </button>
            <button className="mini-btn" style={{ padding: "2px 8px" }} onClick={() => remove(c.id)} title="Delete clip">
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="hint">replays run on the court with the cinematic shot cam</div>
    </>
  );
}
