/**
 * GAME PLAN — what real players did in this situation, and how it turned out.
 *
 * This replaced a replay viewer. Watching one possession is entertaining and
 * teaches nothing; the same corpus aggregated tells you how to play, which is
 * what a tool built on tracking data should be for.
 *
 * Every number here is an OBSERVED make rate from 19,022 tracked 2015-16
 * releases, not a model output. The grid sits beside the model's prediction so
 * the two can be compared on the same shot, which is the honest way to show a
 * model: against the thing it is predicting.
 *
 * THE FINDING THE GRID EXISTS TO SHOW
 * Contest is worth about seven points at the rim and about fifteen on a three. A
 * hand in the face barely changes a layup, which is taken into contact by design,
 * and is close to decisive from range.
 *
 * Conditioning on distance is what makes that visible at all. Pooled across every
 * distance the contest effect nearly vanishes, because tightly guarded shots are
 * mostly layups and open shots are mostly threes, and the two biases cancel. That
 * cancellation is a good demonstration of why a raw split can say nothing while
 * the same data conditioned properly says a great deal.
 */
import { useEffect, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { getGamePlan, type GamePlan } from "../../api";

/** One hue, light to dark, so magnitude reads without a second colour. */
function shade(rate: number): string {
  const lo = 0.2;
  const hi = 0.56;
  const f = Math.min(Math.max((rate - lo) / (hi - lo), 0), 1);
  const r = Math.round(38 + 24 * f);
  const g = Math.round(52 + 120 * f);
  const b = Math.round(72 + 40 * f);
  return `rgb(${r},${g},${b})`;
}

export function GamePlanPanel() {
  const derived = useScenarioStore((s) => s.derived)();
  const prediction = useScenarioStore((s) => s.prediction);
  const [plan, setPlan] = useState<GamePlan | null>(null);
  const [err, setErr] = useState(false);

  const dist = derived.distance;
  const def = derived.contest.closest;

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      getGamePlan(dist, def, ctrl.signal)
        .then((p) => { setPlan(p); setErr(false); })
        .catch(() => setErr(true));
    }, 280);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [dist, def]);

  if (err) {
    return (
      <div className="pn-body">
        <div className="pn-note">Tracked outcomes unavailable.</div>
      </div>
    );
  }
  if (!plan) return <div className="pn-body"><div className="pn-note">reading the corpus</div></div>;

  const modelP = prediction?.probability ?? null;
  const obs = plan.observed;

  return (
    <div className="pn-body">
      {/* ---- this shot, model against reality ---- */}
      <div className="gp-head">
        <span className="gp-where">{plan.bandLabel}</span>
        <span className="gp-contest">{plan.contestLabel}</span>
      </div>

      <div className="gp-versus">
        <div>
          <span>Model says</span>
          <strong>{modelP != null ? `${(modelP * 100).toFixed(1)}%` : "·"}</strong>
        </div>
        <div className="real">
          <span>Real players made</span>
          <strong>{obs ? `${(obs.makeRate * 100).toFixed(1)}%` : "·"}</strong>
          <em>{obs ? `${obs.n.toLocaleString()} tracked shots` : "no data here"}</em>
        </div>
      </div>

      {/* ---- the lesson ---- */}
      {plan.contestValuePts != null && plan.rimContestValuePts != null && (
        <div className="gp-insight">
          Getting open is worth <b>{plan.contestValuePts} pts</b> here, against{" "}
          <b>{plan.rimContestValuePts}</b> at the rim.
        </div>
      )}

      {/* ---- the grid ---- */}
      <div className="pn-label">Observed make rate</div>
      <div className="gp-grid">
        <div className="gp-cell gp-corner" />
        {plan.bands.contest.map((c) => (
          <div key={c.key} className="gp-cell gp-colhead">{c.label}</div>
        ))}

        {plan.bands.distance.map((d) => (
          <>
            <div key={`h-${d.key}`} className="gp-cell gp-rowhead">{d.label}</div>
            {plan.bands.contest.map((c) => {
              const cell = plan.grid[d.key]?.[c.key];
              const here = d.key === plan.band && c.key === plan.contest;
              return (
                <div
                  key={`${d.key}-${c.key}`}
                  className={`gp-cell gp-val ${here ? "here" : ""}`}
                  style={{ background: cell ? shade(cell.makeRate) : "transparent" }}
                  title={cell ? `${cell.n.toLocaleString()} tracked shots` : "no tracked shots"}
                >
                  {cell ? `${(cell.makeRate * 100).toFixed(0)}%` : "·"}
                </div>
              );
            })}
          </>
        ))}
      </div>

      <div className="pn-note">
        {plan.totalPlays.toLocaleString()} tracked 2015-16 releases. Outcomes, not
        predictions.
      </div>
    </div>
  );
}
