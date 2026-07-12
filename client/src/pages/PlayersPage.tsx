/**
 * PLAYER LAB — real players from the frozen model's lookup (30 verified names;
 * all 1017 ids loadable by number). Selecting a player:
 *   • rebuilds the 3D body from his MEASURED height/wingspan (1 unit = 1 ft),
 *   • routes his real profile features into every prediction (playerId),
 *   • drives the physics release point from his real reach + vertical.
 * The compare table scores the SAME shot for each roster player — the model's
 * player features doing visible work.
 */
import { useEffect, useMemo, useState } from "react";
import { usePlayersStore } from "../state/playersStore";
import { useShotStore } from "../state/shotStore";
import { predictCourt, type RosterPlayer } from "../api";

const QUALITY_COLOR: Record<string, string> = {
  Excellent: "#35c26e", Good: "#6fcf97", Average: "#f2c94c",
  Poor: "#f2994a", "Very Poor": "#eb5757",
};

function fmtFtIn(inches?: number) {
  if (!inches) return "·";
  const ft = Math.floor(inches / 12);
  return `${ft}'${Math.round(inches - ft * 12)}"`;
}

interface CompareEntry {
  p: RosterPlayer;
  prob: number | null;
  quality: string;
}

export function PlayersPage() {
  const { roster, totalKnownIds, loading, error, active, fetchRoster, selectPlayer, loadById } = usePlayersStore();
  const scenario = useShotStore((s) => s.scenario);
  const [query, setQuery] = useState("");
  const [idInput, setIdInput] = useState("");
  const [idMsg, setIdMsg] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareEntry[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => fetchRoster(), [fetchRoster]);

  const filtered = useMemo(
    () =>
      roster.filter(
        (p) =>
          !query ||
          (p.name ?? String(p.id)).toLowerCase().includes(query.toLowerCase())
      ),
    [roster, query]
  );

  const loadId = async () => {
    const id = parseInt(idInput, 10);
    if (Number.isNaN(id)) return;
    setIdMsg("loading…");
    const p = await loadById(id);
    if (p) {
      selectPlayer(p);
      setIdMsg(`loaded id ${id}${p.name ? ` (${p.name})` : " (unnamed profile)"}`);
    } else {
      setIdMsg(`id ${id} is not in the model's lookup`);
    }
  };

  const runCompare = async () => {
    setComparing(true);
    const subjects = filtered.slice(0, 8);
    const rows: CompareEntry[] = [];
    for (const p of subjects) {
      try {
        const r = await predictCourt({
          x: scenario.x, z: scenario.z, shotType: scenario.shotType,
          playerId: p.id, positionGroup: p.position ?? "G",
          defenderDistance: scenario.defenderDistance,
        });
        rows.push({ p, prob: r.probability, quality: r.quality });
      } catch {
        rows.push({ p, prob: null, quality: "·" });
      }
    }
    rows.sort((a, b) => (b.prob ?? -1) - (a.prob ?? -1));
    setCompare(rows);
    setComparing(false);
  };

  const prof = active?.profile;

  return (
    <>
      <div className="side-panel left wide">
        <div className="panel-title">Player Lab</div>
        <input
          className="text-input"
          placeholder={`search ${roster.length} named players…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <div className="an-loading">Loading roster…</div>}
        {error && <div className="an-stat">roster unavailable — backend offline</div>}
        <div className="roster-list">
          <button
            className={`roster-row ${active === null ? "active" : ""}`}
            onClick={() => selectPlayer(null)}
          >
            <span className="roster-name">Generic player</span>
            <span className="roster-meta">league-average profile</span>
          </button>
          {filtered.map((p) => (
            <button
              key={p.id}
              className={`roster-row ${active?.id === p.id ? "active" : ""}`}
              onClick={() => selectPlayer(p)}
            >
              <span className="roster-name">{p.name ?? `id ${p.id}`}</span>
              <span className="roster-meta">
                {p.position ?? "?"} · {p.bio_source === "league_imputed" ? "≈" : ""}{fmtFtIn(p.profile.height_in)}
              </span>
            </button>
          ))}
        </div>

        <div className="an-label" style={{ marginTop: 8 }}>
          Any of the {totalKnownIds} ids the model knows
        </div>
        <div className="id-row">
          <input
            className="text-input"
            placeholder="NBA player id…"
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadId()}
          />
          <button className="mini-btn" onClick={loadId}>load</button>
        </div>
        {idMsg && <div className="panel-note">{idMsg}</div>}
      </div>

      <div className="side-panel right wide">
        {active && prof ? (
          <>
            <div className="panel-title">{active.name ?? `id ${active.id}`}</div>
            <div className="profile-grid">
              <div><span>Height</span><strong>{fmtFtIn(prof.height_in)}</strong></div>
              <div><span>Wingspan</span><strong>{fmtFtIn(prof.wingspan_in)}</strong></div>
              <div><span>Reach</span><strong>{fmtFtIn(prof.standing_reach_in)}</strong></div>
              <div><span>Vertical</span><strong>{prof.max_vertical_in ? `${prof.max_vertical_in}"` : "·"}</strong></div>
              <div><span>Weight</span><strong>{prof.weight_lb ? `${Math.round(prof.weight_lb)} lb` : "·"}</strong></div>
              <div><span>Exp</span><strong>{prof.experience_yrs != null ? `${prof.experience_yrs} yrs` : "·"}</strong></div>
              <div><span>Avg speed</span><strong>{prof.avg_speed ? `${prof.avg_speed.toFixed(1)} mph` : "·"}</strong></div>
              <div><span>Drives/g</span><strong>{prof.drives_pg?.toFixed(1) ?? "·"}</strong></div>
              <div><span>C&S FG%</span><strong>{prof.catch_shoot_fg_pct != null ? `${(prof.catch_shoot_fg_pct * 100).toFixed(1)}%` : "·"}</strong></div>
              <div><span>Pull-up FG%</span><strong>{prof.pull_up_fg_pct != null ? `${(prof.pull_up_fg_pct * 100).toFixed(1)}%` : "·"}</strong></div>
            </div>
            {active.bio_source === "league_imputed" ? (
              <div className="panel-note">
                measurables are league-median placeholders (his bio wasn't in the
                profile source) — his shot-history features are genuinely his, so
                predictions are still player-specific
              </div>
            ) : active.imputed.length > 0 ? (
              <div className="panel-note">
                imputed (league median): {active.imputed.join(", ")}
              </div>
            ) : null}
            <div className="panel-note">
              his measured height/wingspan build the 3D body; his profile features
              feed every prediction while he's active
            </div>
          </>
        ) : (
          <>
            <div className="panel-title">Generic player</div>
            <div className="an-stat">
              Predictions use the dataset-average profile. Pick a player to see his
              real measurements drive the body, the physics and the model.
            </div>
          </>
        )}

        <div className="divider" />
        <div className="an-label">
          Same shot, every player — {scenario.shotType.replace(/_/g, " ")} at ({scenario.x.toFixed(0)}, {scenario.z.toFixed(0)})
        </div>
        <button className="mini-btn" onClick={runCompare} disabled={comparing}>
          {comparing ? "scoring…" : "compare first 8 listed"}
        </button>
        {compare.map((c) => (
          <div key={c.p.id} className="rank-row">
            <div className="rank-info">
              <span className="rank-type">{c.p.name ?? `id ${c.p.id}`}</span>
              <div className="rank-bar-wrap">
                <div className="rank-bar" style={{
                  width: `${Math.round((c.prob ?? 0) * 100)}%`,
                  background: QUALITY_COLOR[c.quality] ?? "#555",
                }} />
              </div>
            </div>
            <span className="rank-pct" style={{ color: QUALITY_COLOR[c.quality] ?? "#888" }}>
              {c.prob != null ? `${Math.round(c.prob * 100)}%` : "·"}
            </span>
          </div>
        ))}
      </div>

      <div className="hint">selected player's real measurements are standing on the court</div>
    </>
  );
}
