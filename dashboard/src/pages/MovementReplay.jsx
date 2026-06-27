import { useEffect, useMemo, useState } from "react";
import { TrackingReplay } from "../components/TrackingReplay";
import { getMovePath, getMovementPlayers } from "../api";

/**
 * Movement Replay — the approach into a shot, played back in the format
 * tracking data is normally viewed in.
 *
 * Every path here is retrieved, not generated. With a player selected, the
 * backend returns that player's OWN tracked approaches from the 2015-16 SportVU
 * corpus, drawn from the contest tier the chosen situation falls in. The panel
 * reports which tier answered and how many real approaches back it, so a thin
 * signature is visible rather than implied.
 */
const SITUATIONS = [
  { id: "smothered", label: "Smothered at the rim", courtX: -39.0, courtZ: 1.0,
    shotType: "driving_layup", defenderDist: 1.5,
    watch: "Short and hard. The drive is decided before the catch." },
  { id: "contested", label: "Contested pull-up", courtX: -30.0, courtZ: 8.0,
    shotType: "pullup", defenderDist: 3.5,
    watch: "A gather against pressure, so the path bends late to make room." },
  { id: "open_corner", label: "Open corner three", courtX: -38.5, courtZ: -22.0,
    shotType: "catch_shoot", defenderDist: 7.0,
    watch: "Relocation rather than a drive: low speed, feet set on arrival." },
  { id: "closeout", label: "Closeout above the break", courtX: -18.0, courtZ: 6.0,
    shotType: "catch_shoot", defenderDist: 5.0,
    watch: "Arrives moving and has to stop while the defender is still running." },
  { id: "late_iso", label: "Late-clock isolation", courtX: -27.0, courtZ: -10.0,
    shotType: "stepback", defenderDist: 2.5,
    watch: "The longest path of the set: time spent creating, not attacking." },
  { id: "transition", label: "Transition to the rim", courtX: -37.0, courtZ: 0.0,
    shotType: "driving_layup", defenderDist: 9.0,
    watch: "The fastest approach, with nobody in front of him." },
];

export function MovementReplay() {
  const [roster, setRoster] = useState([]);
  const [playerId, setPlayerId] = useState(0);
  const [situation, setSituation] = useState(SITUATIONS[1]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [playKey, setPlayKey] = useState(1);

  useEffect(() => {
    getMovementPlayers().then((r) => {
      setRoster(r.players);
      if (r.players.length) setPlayerId(r.players[0].player_id);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMovePath({
      courtX: situation.courtX, courtZ: situation.courtZ,
      shotType: situation.shotType, defenderDist: situation.defenderDist,
      playerId, position: "SG", period: 1, shotClock: 12, scoreMargin: 0, distance: 18,
    }).then((r) => {
      if (!alive) return;
      setResult(r);
      setLoading(false);
      setPlayKey((k) => k + 1);
    });
    return () => { alive = false; };
  }, [situation, playerId]);

  const wp = result?.waypoints ?? [];
  const stats = useMemo(() => {
    if (!wp.length) return null;
    const peak = Math.max(...wp.map((w) => w.speed));
    const dur = wp[wp.length - 1].t;
    let len = 0;
    for (let i = 1; i < wp.length; i++) len += Math.hypot(wp[i].x - wp[i - 1].x, wp[i].y - wp[i - 1].y);
    return { peak, dur, len, n: wp.length };
  }, [wp]);

  const tracked = result?.method === "player_tracked";
  const selected = roster.find((p) => p.player_id === playerId);

  return (
    <div>
      <header className="mb-6">
        <h1 className="h-title text-2xl">Movement Replay</h1>
        <p className="text-sm text-txt-secondary">
          How the shooter arrives at a shot, replayed from 2015-16 SportVU tracking.
          Each dot is a tracked position; colour is speed.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_300px] gap-6">
        <div className="card space-y-5">
          <div>
            <div className="label mb-2">Player</div>
            <select
              value={playerId}
              onChange={(e) => setPlayerId(Number(e.target.value))}
              className="w-full h-9 rounded-md bg-bg-tertiary border border-line px-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
            >
              {roster.length === 0 && <option value={0}>loading…</option>}
              {roster.map((p) => (
                <option key={p.player_id} value={p.player_id}>
                  {p.player_id} · {p.n_sequences} approaches
                </option>
              ))}
            </select>
            <p className="text-[11px] text-txt-muted mt-1.5 leading-relaxed">
              {roster.length} players have a tracked signature. Sorted by how many real
              approaches back it.
            </p>
          </div>

          <div>
            <div className="label mb-2">Situation</div>
            <div className="space-y-1">
              {SITUATIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSituation(s)}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs border transition-colors duration-150 ${
                    situation.id === s.id
                      ? "bg-accent-blue border-accent-blue text-white"
                      : "bg-bg-tertiary border-line text-txt-secondary hover:text-txt-primary"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {selected && (
            <div className="pt-4 border-t border-line">
              <div className="label mb-2">This player, across all approaches</div>
              <dl className="space-y-1.5 text-xs">
                {Object.entries(selected.stats ?? {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-txt-muted">{k.replace(/_/g, " ")}</dt>
                    <dd className="stat">{typeof v === "number" ? v.toFixed(2) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div className="card flex flex-col items-center gap-4">
          <TrackingReplay waypoints={wp} playKey={playKey} />
          <div className="flex gap-3">
            <button className="btn btn-primary" onClick={() => setPlayKey((k) => k + 1)} disabled={!wp.length}>
              Replay
            </button>
          </div>
          <p className="text-xs text-txt-muted text-center max-w-[500px] leading-relaxed">
            {situation.watch}
          </p>
        </div>

        <div className="space-y-6">
          <div className="card">
            <div className="label mb-3">This approach</div>
            {loading && <div className="text-sm text-txt-muted">Retrieving…</div>}
            {!loading && stats && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="label">Duration</div>
                    <div className="stat text-lg">{stats.dur.toFixed(1)}s</div>
                  </div>
                  <div>
                    <div className="label">Peak speed</div>
                    <div className="stat text-lg">{stats.peak.toFixed(1)} ft/s</div>
                  </div>
                  <div>
                    <div className="label">Path length</div>
                    <div className="stat text-lg">{stats.len.toFixed(0)} ft</div>
                  </div>
                  <div>
                    <div className="label">Tracked points</div>
                    <div className="stat text-lg">{stats.n}</div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-line">
                  <div className="label mb-1">Where this came from</div>
                  <p className="text-xs text-txt-secondary leading-relaxed">
                    {tracked ? (
                      <>
                        <span className="text-accent-teal font-semibold">Real tracked movement.</span>{" "}
                        {result.nSequences} approaches by player {result.playerId} in the 2015-16
                        corpus, retrieved from the <strong>{result.pressure}</strong> contest tier
                        {result.pressureRequested && result.pressureRequested !== result.pressure && (
                          <> (asked for {result.pressureRequested}; he has none tracked in that band)</>
                        )}
                        . Nothing here is generated.
                      </>
                    ) : (
                      <>
                        <span className="text-accent-amber font-semibold">League template.</span>{" "}
                        {result?.fallbackReason
                          ? `${result.fallbackReason}.`
                          : "No per-player signature, so the sequence model answered."}
                      </>
                    )}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="label mb-1">What is not shown</div>
            <p className="text-xs text-txt-muted leading-relaxed">
              Only the shooter is tracked through time in this corpus. The other nine players
              exist in it as a single frame at the instant of release, so a full ten-player
              replay cannot be reconstructed from the extracted data. Drawing nine more dots
              interpolated from one frame would look like tracking data without being it, so
              they are left out.
            </p>
            <p className="text-xs text-txt-muted leading-relaxed mt-3">
              Defender context is the distance to the nearest defender at each frame. Which
              defender that was, and where he stood, is not retained.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
