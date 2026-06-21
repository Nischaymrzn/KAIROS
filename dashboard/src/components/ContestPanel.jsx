import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import { getContestCurve } from "../api";
import { applyContest, contestCurvePoints, contestMultiplier } from "../science";

/**
 * The defender slider's honest companion.
 *
 * The core model cannot see the defender. Per-shot defender distance is public
 * only for 2014-15 and 2015-16, so those columns are constant across the
 * production window and were dropped; sweeping the slider moves the model's
 * output by exactly zero. Hiding that would make the most prominent control on
 * the page a decoration.
 *
 * So the effect is sourced separately from /defend, which serves the 2014-15
 * study's contest levels and reports its own provenance. The chart is drawn
 * from those levels when the backend is reachable and from the offline table
 * otherwise, and either way it is labelled as an adjustment applied after
 * prediction rather than as model output.
 */
export function ContestPanel({ scenario, baseProbability }) {
  const [curve, setCurve] = useState(null);

  useEffect(() => {
    let alive = true;
    getContestCurve(scenario).then((c) => alive && setCurve(c));
    return () => { alive = false; };
  }, [scenario.courtX, scenario.courtZ, scenario.shotType, scenario.position, scenario.shotClock, scenario.period]);

  const data = useMemo(() => {
    if (curve?.levels?.length) {
      return curve.levels.map((l) => ({ x: l.ft, p: l.p * 100, contest: l.contest }));
    }
    return contestCurvePoints(baseProbability ?? 0.46, 20, 2);
  }, [curve, baseProbability]);

  const mult = contestMultiplier(scenario.defenderDist);
  const adjusted = applyContest(baseProbability ?? 0, scenario.defenderDist);
  const fromStudy = Boolean(curve?.levels?.length);

  // where the current slider position sits on the drawn curve
  const here = useMemo(() => {
    if (!data.length) return null;
    return data.reduce((best, d) =>
      Math.abs(d.x - scenario.defenderDist) < Math.abs(best.x - scenario.defenderDist) ? d : best
    );
  }, [data, scenario.defenderDist]);

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="flex items-baseline justify-between mb-1">
        <span className="label">Estimated contest effect</span>
        {curve?.swing != null && (
          <span className="text-[11px] text-txt-muted">
            swing {(curve.swing * 100).toFixed(1)} pts
          </span>
        )}
      </div>

      <p className="text-[11px] text-txt-muted leading-relaxed mb-3">
        Defender distance is estimated from league-wide contest patterns. Per-shot tracking
        data is not publicly available beyond 2015-16.
      </p>

      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ left: -28, right: 8, top: 6, bottom: 0 }}>
          <XAxis
            dataKey="x" type="number" domain={[0, fromStudy ? 8 : 20]}
            tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false}
          />
          <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
            formatter={(v, _n, o) => [`${v.toFixed(1)}%`, o.payload.contest ?? "adjusted"]}
            labelFormatter={(l) => `${l} ft`}
          />
          <Line type="monotone" dataKey="p" stroke="#f97316" strokeWidth={2} dot={{ r: 2.5 }} />
          {here && <ReferenceDot x={here.x} y={here.p} r={4} fill="#f9fafb" stroke="none" />}
        </LineChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-line/50">
        <div>
          <div className="label">Model output</div>
          <div className="stat text-lg">{((baseProbability ?? 0) * 100).toFixed(1)}%</div>
          <div className="text-[10px] text-txt-muted">calibrated, contest-blind</div>
        </div>
        <div>
          <div className="label">After adjustment</div>
          <div className="stat text-lg text-accent-orange">{(adjusted * 100).toFixed(1)}%</div>
          <div className="text-[10px] text-txt-muted">×{mult.toFixed(2)} at {scenario.defenderDist.toFixed(1)} ft</div>
        </div>
      </div>

      <p className="text-[10px] text-txt-muted mt-3 leading-relaxed">
        Source: {curve?.source ?? "2014-15 tracking study"}
        {fromStudy ? " (live from /defend)" : " (offline table)"}. This is a contextual
        adjustment applied <em>after</em> prediction, not a core model feature. The
        calibration the model is measured on (ECE 0.0070) belongs to the unadjusted number.
      </p>
    </div>
  );
}
