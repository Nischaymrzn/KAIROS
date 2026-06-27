/**
 * Training Ground — the primary page.
 *
 * The Playground on top, and beneath it four panels that all derive from the
 * same scenario rather than holding state of their own. Clicking a new spot
 * updates the shot options; simulating adds to the trend and the history;
 * a fresh prediction updates the defensive advice. Nothing here needs its own
 * copy of the scenario, which is the whole point of the shared store.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Playground } from "../components/Playground";
import { MechanicsLab } from "../components/Playground/MechanicsLab";
import { usePlayground } from "../state/playgroundStore";
import { getRankedShots, getContestCurve } from "../api";
import { ZONES } from "../mockData";

const qualityColor = (p) =>
  p >= 0.55 ? "#14B8A6" : p >= 0.5 ? "#22C55E" : p >= 0.45 ? "#EAB308" : p >= 0.4 ? "#F97316" : "#EF4444";

function Panel({ title, note, children, className = "" }) {
  return (
    <section className={`card flex min-h-[210px] flex-col ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="label">{title}</div>
        {note && <div className="text-[11px] text-txt-muted">{note}</div>}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border
                    border-dashed border-border-subtle p-4 text-center text-xs text-txt-muted">
      {children}
    </div>
  );
}

function SessionTrend({ session }) {
  if (!session.length) return <Empty>Simulate a shot to start the session trend.</Empty>;
  const data = session.map((s) => ({ n: s.n, pct: Math.round(s.probability * 100) }));
  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
        <XAxis dataKey="n" tick={{ fontSize: 10, fill: "#3D5470" }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#3D5470" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: "#141B24", border: "1px solid #243347",
                          borderRadius: 6, fontSize: 12 }}
          labelFormatter={(n) => `Shot ${n}`}
          formatter={(v) => [`${v}%`, "Probability"]}
        />
        <Line type="monotone" dataKey="pct" stroke="#F97316" strokeWidth={2}
              dot={{ r: 3, fill: "#F97316" }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function BestShots({ options, onPick }) {
  if (!options) return <Empty>Click the court to rank shot options here.</Empty>;
  if (!options.length) return <Empty>No ranked options for this spot.</Empty>;
  return (
    <ul className="flex flex-col gap-2">
      {options.slice(0, 3).map((o) => (
        <li key={o.shotType ?? o.label}>
          <button
            className="flex w-full items-center gap-3 rounded-md border border-border-subtle
                       bg-bg-raised px-3 py-2 text-left transition-colors hover:bg-bg-hover"
            onClick={() => onPick(o)}
          >
            <span className="flex-1 truncate text-sm text-txt-primary">{o.label}</span>
            <span className="h-1.5 w-16 flex-none overflow-hidden rounded-full bg-bg-active">
              <span className="block h-full rounded-full"
                    style={{ width: `${Math.min(100, o.probability * 100)}%`,
                             background: qualityColor(o.probability) }} />
            </span>
            <span className="stat w-10 flex-none text-right text-sm">
              {(o.probability * 100).toFixed(0)}%
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DefendPanel({ curve, probability }) {
  if (!curve?.length) return <Empty>Simulate to see how this shot is best defended.</Empty>;
  const tightest = curve[0];
  const drop = probability != null ? (probability - tightest.probability) * 100 : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border-subtle bg-bg-raised p-3">
        <div className="text-sm text-txt-primary">
          Close to <span className="stat">{tightest.distance.toFixed(1)} ft</span>
        </div>
        {drop != null && (
          <div className="mt-1 text-xs text-txt-secondary">
            Cuts the shot by <span className="text-accent-red">{drop.toFixed(1)} points</span>,
            to {(tightest.probability * 100).toFixed(0)}%.
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {curve.slice(0, 4).map((c) => (
          <li key={c.distance} className="flex items-center gap-2 text-xs">
            <span className="w-12 flex-none text-txt-muted">{c.distance.toFixed(1)} ft</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-active">
              <span className="block h-full rounded-full"
                    style={{ width: `${Math.min(100, c.probability * 100)}%`,
                             background: qualityColor(c.probability) }} />
            </span>
            <span className="stat w-9 flex-none text-right">{(c.probability * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({ session, onLoad, onClear }) {
  if (!session.length) return <Empty>Shots you simulate appear here.</Empty>;
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {[...session].reverse().slice(0, 8).map((s) => (
          <li key={s.n}>
            <button
              className="flex w-full items-center gap-2 rounded-md border border-border-subtle
                         bg-bg-raised px-2.5 py-1.5 text-left text-xs transition-colors
                         hover:bg-bg-hover"
              onClick={() => onLoad(s)}
            >
              <span className="w-5 flex-none text-txt-muted">{s.n}</span>
              <span className="flex-1 truncate text-txt-secondary">
                {ZONES[s.zone]?.label ?? s.zone} · {s.distance.toFixed(0)} ft
              </span>
              <span className="stat" style={{ color: qualityColor(s.probability) }}>
                {(s.probability * 100).toFixed(0)}%
              </span>
              <span className={s.made ? "text-accent-green" : "text-accent-red"}>
                {s.made ? "●" : "○"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn mt-3 w-full !py-1.5 text-xs" onClick={onClear}>
        Clear session
      </button>
    </div>
  );
}

export function TrainingGround() {
  const pg = usePlayground();
  const [options, setOptions] = useState(null);
  const [curve, setCurve] = useState(null);
  const [pred, setPred] = useState(null);

  const onPrediction = useCallback((p, payload) => {
    setPred(p);
    getContestCurve(payload).then((c) => setCurve(c?.curve ?? c ?? null)).catch(() => {});
  }, []);

  // ranked options follow the position on the floor, so they refresh on a click
  // rather than only on a simulate
  const { x, y } = pg.shooter;
  useEffect(() => {
    let live = true;
    getRankedShots({ ...pg.scenario, courtX: x, courtY: y })
      .then((r) => { if (live) setOptions(r?.shots ?? r ?? null); })
      .catch(() => { if (live) setOptions(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="h-title text-2xl">Training Ground</h1>
        <p className="text-sm text-txt-secondary">
          Build a shot, simulate it, and read what the model saw. Everything below the
          court follows the scenario, and the scenario follows you between pages.
        </p>
      </header>

      <Playground onPrediction={onPrediction} />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Shot quality this session"
               note={pg.session.length ? `${pg.session.length} shots` : null}>
          <SessionTrend session={pg.session} />
        </Panel>

        <Panel title="Best shot from here" note="ranked by probability">
          <BestShots options={options} onPick={(o) =>
            o.shotType && pg.setScenario({ shotType: o.shotType })} />
        </Panel>

        <Panel title="How to defend this" note="measured contest curve">
          <DefendPanel curve={curve} probability={pred?.probability} />
        </Panel>

        <Panel title="Session history" note="click to reload">
          <History
            session={pg.session}
            onLoad={(s) => pg.loadScenario(s)}
            onClear={pg.clearSession}
          />
        </Panel>
      </div>

      <MechanicsLab />
    </div>
  );
}
