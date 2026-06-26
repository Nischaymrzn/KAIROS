/**
 * Scenario Comparison — two Playgrounds, deliberately not sharing state.
 *
 * This is the one page where the shared store is the wrong tool: the whole
 * point is two scenarios that differ. Rather than fork the reducer, each side
 * runs `useLocalPlayground`, so both behave exactly like the shared one while
 * staying isolated from each other and from the rest of the app.
 *
 * "Simulate both" bumps both simKeys in the same tick, so the two animations
 * start on the same frame instead of one trailing the other.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { Playground } from "../components/Playground";
import { CourtCanvas, zoneAt } from "../components/CourtCanvas";
import { useLocalPlayground } from "../state/playgroundStore";
import { useSavedScenarios } from "../hooks/useSavedScenarios";
import { ZONES } from "../mockData";
import { exportComparison } from "../exportPng";

const ROWS = [
  { key: "distance", label: "Shot distance", unit: " ft", better: "lower" },
  { key: "defenderDist", label: "Defender distance", unit: " ft", better: "higher" },
  { key: "shotClock", label: "Shot clock", unit: " s", better: "higher" },
  { key: "dribbles", label: "Dribbles", unit: "", better: "lower" },
  { key: "touchTime", label: "Touch time", unit: " s", better: "lower" },
  { key: "jumpAngle", label: "Jump angle", unit: "°", better: "none" },
  { key: "period", label: "Period", unit: "", better: "none" },
  { key: "scoreMargin", label: "Score margin", unit: "", better: "none" },
];

function Side({ pg, label, tone, saved, onLoad, wrapRef, onPrediction }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className={`label ${tone}`}>{label}</div>
        {saved.length > 0 && (
          <select
            className="h-7 rounded-md border border-line bg-bg-raised px-2 text-xs text-txt-secondary"
            value=""
            onChange={(e) => {
              const s = saved.find((x) => String(x.id) === e.target.value);
              if (s) onLoad(s);
            }}
          >
            <option value="">Load saved…</option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}{s.probability != null ? ` — ${(s.probability * 100).toFixed(0)}%` : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <div ref={wrapRef}>
        <Playground pg={pg} mode="compact" label={label} onPrediction={onPrediction} />
      </div>
    </div>
  );
}

export function Compare() {
  const a = useLocalPlayground();
  const b = useLocalPlayground({
    scenario: { shotType: "catch_shoot", distance: 23.9, defenderDist: 6 },
  });
  const saved = useSavedScenarios();
  const wrapA = useRef(null);
  const wrapB = useRef(null);
  const [pa, setPa] = useState(null);
  const [pb, setPb] = useState(null);

  const onA = useCallback((p) => setPa(p), []);
  const onB = useCallback((p) => setPb(p), []);

  // one tick, two dispatches: React batches them so both courts start together
  const simulateBoth = useCallback(() => { a.simulate(); b.simulate(); }, [a, b]);

  const za = ZONES[zoneAt(a.shooter.x, a.shooter.y)];
  const zb = ZONES[zoneAt(b.shooter.x, b.shooter.y)];
  const xpA = pa ? pa.probability * za.points : 0;
  const xpB = pb ? pb.probability * zb.points : 0;
  const diff = pa && pb ? (pa.probability - pb.probability) * 100 : 0;
  const winner = diff >= 0 ? "A" : "B";

  const tableRows = useMemo(
    () => ROWS.map((r) => {
      const va = a.scenario[r.key], vb = b.scenario[r.key];
      let fav = "—";
      if (r.better === "lower") fav = va === vb ? "—" : va < vb ? "A" : "B";
      if (r.better === "higher") fav = va === vb ? "—" : va > vb ? "A" : "B";
      return { label: r.label, a: `${va}${r.unit}`, b: `${vb}${r.unit}`, fav };
    }),
    [a.scenario, b.scenario],
  );

  const onExport = () => exportComparison({
    canvasA: wrapA.current?.querySelector("canvas"),
    canvasB: wrapB.current?.querySelector("canvas"),
    rows: tableRows,
    summary: pa && pb
      ? `A ${(pa.probability * 100).toFixed(1)}% / ${xpA.toFixed(2)} xP  ·  B ${(pb.probability * 100).toFixed(1)}% / ${xpB.toFixed(2)} xP`
      : "",
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="h-title text-2xl">Scenario Comparison</h1>
          <p className="text-sm text-txt-secondary">
            Two setups, the same model, side by side. These two do not share state with
            each other or with the rest of the app.
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn" onClick={onExport}>Save comparison</button>
          <button className="btn btn-primary" onClick={simulateBoth}>Simulate both</button>
        </div>
      </header>

      {pa && pb && (
        <div className="card">
          <div className="grid grid-cols-1 gap-6 text-center md:grid-cols-3">
            <div>
              <div className="label">Higher probability</div>
              <div className="stat text-xl">
                Scenario {winner} by {Math.abs(diff).toFixed(1)} pts
              </div>
            </div>
            <div>
              <div className="label">Expected points</div>
              <div className="stat text-xl">
                {xpA.toFixed(2)} <span className="text-txt-muted">vs</span> {xpB.toFixed(2)}
              </div>
              <div className="text-[11px] text-txt-muted">
                {za.label} {za.points}PT · {zb.label} {zb.points}PT
              </div>
            </div>
            <div>
              <div className="label">Better shot</div>
              <div className={`stat text-xl ${xpA >= xpB ? "text-accent-teal" : "text-accent-green"}`}>
                Scenario {xpA >= xpB ? "A" : "B"}
              </div>
              <div className="text-[11px] text-txt-muted">by expected points</div>
            </div>
          </div>
          <p className="mt-4 border-t border-line pt-4 text-center text-sm text-txt-secondary">
            Scenario {xpA >= xpB ? "A" : "B"} is the better shot: {Math.max(xpA, xpB).toFixed(2)} expected
            points against {Math.min(xpA, xpB).toFixed(2)}.
            {Math.sign(diff) !== Math.sign(xpA - xpB) &&
              " The lower-probability shot wins on points because it is worth three."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Side pg={a} label="Scenario A" tone="text-accent-teal" saved={saved.items}
              onLoad={a.loadScenario} wrapRef={wrapA} onPrediction={onA} />
        <Side pg={b} label="Scenario B" tone="text-accent-green" saved={saved.items}
              onLoad={b.loadScenario} wrapRef={wrapB} onPrediction={onB} />
      </div>

      <div className="card">
        <div className="label mb-4">Feature comparison</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="pb-2 font-medium text-txt-muted">Feature</th>
                <th className="pb-2 text-right font-medium text-txt-muted">Scenario A</th>
                <th className="pb-2 text-right font-medium text-txt-muted">Scenario B</th>
                <th className="pb-2 text-right font-medium text-txt-muted">Favours</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.label} className="border-b border-line/50">
                  <td className="py-2 text-txt-secondary">{r.label}</td>
                  <td className="stat py-2 text-right">{r.a}</td>
                  <td className="stat py-2 text-right">{r.b}</td>
                  <td className={`stat py-2 text-right ${
                    r.fav === "A" ? "text-accent-teal"
                      : r.fav === "B" ? "text-accent-green" : "text-txt-muted"}`}>
                    {r.fav}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
