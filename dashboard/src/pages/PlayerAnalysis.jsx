import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ZoneHeatmap } from "../components/ZoneHeatmap";
import { getPlayerProfile, getPlayers, getShotTypeBreakdown } from "../api";
import { ALL_SHOT_TYPES, ZONES } from "../mockData";
import { ZONE_SCENARIOS } from "../zoneScenarios";

/** Initials for the avatar: first letter of the first and last name parts. */
const initials = (name = "") => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};

const num = (v, d = 1) => (v == null ? "—" : v.toFixed(d));
const ft = (inches) => (inches == null ? "—" : `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`);

const MODES = [
  { id: "frequency", label: "Frequency" },
  { id: "actual", label: "Actual FG%" },
  { id: "predicted", label: "Predicted quality" },
];

export function PlayerAnalysis() {
  const [query, setQuery] = useState("Stephen Curry");
  const [name, setName] = useState("Stephen Curry");
  const [player, setPlayer] = useState(null);
  const [mode, setMode] = useState("frequency");
  const [zone, setZone] = useState(null);
  const navigate = useNavigate();
  const [roster, setRoster] = useState([]);

  useEffect(() => {
    getPlayers().then((r) => setRoster(r.players ?? []));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return roster.filter((p) => p.name?.toLowerCase().includes(q)).slice(0, 6);
  }, [query, roster]);

  useEffect(() => {
    let alive = true;
    getPlayerProfile(name).then((p) => alive && setPlayer(p));
    return () => { alive = false; };
  }, [name]);

  /** One model call per shot type, at a representative spot for that type. */
  const [byType, setByType] = useState([]);
  useEffect(() => {
    if (!player) return;
    let alive = true;
    getShotTypeBreakdown(player, ALL_SHOT_TYPES).then((r) => alive && setByType(r));
    return () => { alive = false; };
  }, [player]);

  if (!player) return <div className="card text-sm text-txt-muted">Loading player…</div>;

  const best = byType.slice(0, 3);
  const worstZones = [...player.zones]
    .filter((z) => z.actual != null)
    .sort((a, b) => a.actual - b.actual)
    .slice(0, 2);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h-title text-2xl">Player Analysis</h1>
          <p className="text-sm text-txt-secondary">
            {player.live ? "Profile from the live roster." : "Live roster unavailable — showing sample profile."}
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); setName(query); }}
        >
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={roster.length ? `Search ${roster.length} players…` : "Loading roster…"}
              className="bg-bg-tertiary border border-line rounded-md h-9 px-3 text-sm w-64
                         focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
            />
            {matches.length > 0 && query !== name && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-line bg-bg-secondary shadow-lg overflow-hidden">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-txt-secondary hover:bg-bg-tertiary hover:text-txt-primary"
                      onClick={() => { setQuery(p.name); setName(p.name); }}
                    >
                      {p.name} <span className="text-txt-muted text-xs">{p.position}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="btn btn-primary" type="submit">Load</button>
        </form>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)_320px] gap-6">
        <div className="card">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-11 h-11 rounded-full bg-bg-tertiary border border-line
                         flex items-center justify-center text-sm font-semibold text-txt-secondary shrink-0"
              aria-hidden="true"
            >
              {initials(player.name)}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold truncate">{player.name}</div>
              <div className="text-sm text-txt-secondary">{player.position}</div>
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="sr-only">{player.name}</div>
            {player.live === false && <span className="text-[10px] text-accent-amber">mock</span>}
          </div>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div>
              <div className="label">Height</div>
              <div className="stat">{ft(player.height_in)}</div>
            </div>
            <div>
              <div className="label">Weight</div>
              <div className="stat">{num(player.weight_lb, 0)}</div>
            </div>
            <div>
              <div className="label">Exp</div>
              <div className="stat">{player.experience != null ? `${player.experience}y` : "—"}</div>
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-line">
            <div className="label mb-3">Shooting by tracking family</div>
            <dl className="space-y-2 text-sm">
              {[
                ["Drives", player.drive_fg_pct, player.drives_pg, "per game"],
                ["Catch &amp; shoot", player.catch_shoot_fg_pct, player.catch_shoot_rate, "per game"],
                ["Pull-ups", player.pull_up_fg_pct, player.pull_up_rate, "per game"],
              ].map(([k, fg, rate, unit]) => (
                <div key={k} className="flex items-baseline justify-between border-b border-line/50 pb-1.5">
                  <dt className="text-txt-muted">{k}</dt>
                  <dd className="text-right">
                    <span className="stat">{fg != null ? `${(fg * 100).toFixed(1)}%` : "—"}</span>
                    <span className="text-[10px] text-txt-muted ml-2">
                      {rate != null ? `${rate.toFixed(1)} ${unit}` : ""}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-[10px] text-txt-muted mt-3 leading-relaxed">
              NBA tracking summaries, per player. These are real measurements, not per-zone
              splits — the heatmap maps each zone onto the family that dominates it.
            </p>
          </div>

          {player.imputed?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-line">
              <div className="label mb-1">Estimated fields</div>
              <div className="flex flex-wrap gap-1.5">
                {player.imputed.map((f) => (
                  <span key={f} className="text-[10px] px-2 py-0.5 rounded-full bg-bg-tertiary border border-line text-txt-muted">
                    {f.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-txt-muted mt-2">
                Not measured for this player; filled from league averages
                {player.bio_source ? ` (${player.bio_source.replace(/_/g, " ")})` : ""}.
              </p>
            </div>
          )}
        </div>

        <div className="card flex flex-col items-center gap-4">
          <div className="flex gap-1 self-start">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`h-8 px-3 rounded-md text-xs border transition-colors duration-150 ${
                  mode === m.id
                    ? "bg-accent-blue border-accent-blue text-white"
                    : "bg-bg-tertiary border-line text-txt-secondary hover:text-txt-primary"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <ZoneHeatmap zones={player.zones} mode={mode} onZoneClick={setZone} />
          {zone && (
            <button
              className="btn mt-3 w-full"
              onClick={() =>
                navigate("/", { state: { load: ZONE_SCENARIOS[zone], from: `${player.name}, ${ZONES[zone].label}` } })
              }
            >
              Open this zone in the predictor
            </button>
          )}
          {zone && (
            <div className="text-xs text-txt-secondary">
              {ZONES[zone].label}: {player.zones.find((z) => z.zone === zone)?.attempts ?? 0} attempts ·
              {" "}{((player.zones.find((z) => z.zone === zone)?.actual ?? 0) * 100).toFixed(1)}% actual
            </div>
          )}
        </div>

        <div className="card">
          <div className="label mb-3">Predicted rate by shot type</div>
          <ResponsiveContainer width="100%" height={430}>
            <BarChart data={byType} layout="vertical" margin={{ left: 8, right: 12 }}>
              <XAxis type="number" domain={[0, 1]} hide />
              <YAxis type="category" dataKey="name" width={104} tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                formatter={(v, n) => [`${(v * 100).toFixed(1)}%`, n === "predicted" ? "Predicted" : "League"]}
              />
              <Bar dataKey="predicted" radius={[0, 4, 4, 0]}>
                {byType.map((d, i) => (
                  <Cell key={d.name} fill={i === 0 ? "#22c55e" : i === byType.length - 1 ? "#ef4444" : "#3b82f6"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card mt-6">
        <div className="label mb-3">Based on this profile and the model</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-txt-primary font-medium mb-2">Recommended shots</div>
            <ul className="space-y-1 text-txt-secondary">
              {best.map((b) => (
                <li key={b.name}>{b.name} — {(b.predicted * 100).toFixed(1)}%</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-txt-primary font-medium mb-2">Zones to avoid</div>
            <ul className="space-y-1 text-txt-secondary">
              {worstZones.map((z) => (
                <li key={z.zone}>{ZONES[z.zone].label} — {(z.actual * 100).toFixed(1)}% on {z.attempts} attempts</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-txt-primary font-medium mb-2">Suggested approach</div>
            <p className="text-txt-secondary leading-relaxed">
              {(player.catch_shoot_fg_pct ?? 0) > 0.37
                ? "Spot-up heavy. The three-point rate justifies volume from the arc, and corner attempts convert best of all."
                : (player.drive_fg_pct ?? 0) > 0.55
                ? "Drive-heavy. Rim finishing is the strength; extra range attempts cost efficiency."
                : "Balanced. No single zone dominates, so shot selection matters more than volume."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
