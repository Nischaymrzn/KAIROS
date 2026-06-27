import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { FeatureImportanceChart } from "../components/FeatureImportanceChart";
import { ReferenceCurve } from "../components/ReferenceCurve";
import { clockFactor, defenderFactor, pressureFactor, MURPHY } from "../science";
import { getModelInfo, getFeatureImportance, predictShot } from "../api";

/**
 * What-if curves. Each point is a real call to the model with one feature moved
 * and everything else held, so the shape is the model's, not a drawn illustration.
 */
const SWEEPS = [
  { id: "distance", label: "Shot distance", unit: "ft", from: 3, to: 30, step: 3, param: "distance" },
  { id: "defenderDist", label: "Defender distance", unit: "ft", from: 0, to: 12, step: 2, param: "defenderDist" },
  { id: "shotClock", label: "Shot clock", unit: "s", from: 1, to: 23, step: 3, param: "shotClock" },
];

/**
 * The literature curve for the variable being swept, drawn beside the model's
 * own sweep. Showing them together is the point: where they disagree, the
 * disagreement is the finding, and this project measured two of the three
 * directly.
 */
const REFERENCE = {
  shotClock: {
    title: "Literature: shot-clock penalty",
    build: () => Array.from({ length: 25 }, (_, s) => ({ x: s, y: clockFactor(s) })),
    caveat: "Flat above 10 s, 15% penalty at zero. Measured on complete play-by-play the real effect is LARGER: 42.9% with 0-4 s left against 67.5% with 20-24 s.",
  },
  defenderDist: {
    title: "Literature: defender separation",
    build: () => Array.from({ length: 21 }, (_, f) => ({ x: f, y: defenderFactor(f) })),
    caveat: "Steepest inside 4 ft, flat past 8. The model sweep beside it is FLAT because the core model is contest-blind — per-shot defender distance is public only for 2014-15 and 2015-16.",
  },
};

function Stat({ label, value, sub }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="stat text-2xl mt-1">{value}</div>
      {sub && <div className="text-[11px] text-txt-muted mt-1">{sub}</div>}
    </div>
  );
}

export function ModelInsights() {
  const [info, setInfo] = useState(null);
  const [features, setFeatures] = useState([]);
  const [sweep, setSweep] = useState(SWEEPS[0]);
  const [curve, setCurve] = useState([]);

  useEffect(() => {
    getModelInfo().then(setInfo);
    getFeatureImportance().then((r) => setFeatures(r.features));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const pts = [];
      for (let v = sweep.from; v <= sweep.to; v += sweep.step) {
        const base = {
          position: "SG", shotType: "pullup", defenderDist: 4, shotClock: 12,
          period: 1, scoreMargin: 0, dribbles: 1, touchTime: 2, distance: 18,
          jumpAngle: 48, zone: "midrange", courtX: -41.75 + 18, courtZ: 0,
        };
        const s = { ...base, [sweep.param]: v };
        if (sweep.param === "distance") { s.courtX = -41.75 + v; s.zone = v >= 23.75 ? "break3" : v < 4 ? "restricted" : "midrange"; }
        const r = await predictShot(s);
        pts.push({ x: v, p: r.probability * 100 });
      }
      if (alive) setCurve(pts);
    })();
    return () => { alive = false; };
  }, [sweep]);

  const summary = useMemo(() => {
    if (curve.length < 2) return null;
    const a = curve[0], b = curve[curve.length - 1];
    return `${a.p.toFixed(1)}% at ${a.x}${sweep.unit} rising to ${b.p.toFixed(1)}% at ${b.x}${sweep.unit}`;
  }, [curve, sweep]);

  const clockCurve = useMemo(
    () => Array.from({ length: 25 }, (_, s) => ({ x: s, y: clockFactor(s) })), []);
  const defCurve = useMemo(
    () => Array.from({ length: 21 }, (_, f) => ({ x: f, y: defenderFactor(f) })), []);
  const pressCurve = useMemo(
    () => Array.from({ length: 31 }, (_, i) => ({ x: i - 15, y: pressureFactor(i - 15, 4) })), []);

  if (!info) return <div className="card text-sm text-txt-muted">Loading…</div>;

  return (
    <div>
      <header className="mb-6">
        <h1 className="h-title text-2xl">Model Insights</h1>
        <p className="text-sm text-txt-secondary">
          How the model behaves, in plain terms. {info.live ? "Figures read live from the frozen bundle." : "Backend unavailable — frozen v8 figures shown."}
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <Stat label="Test AUC" value={info.test_auc.toFixed(4)} sub={`vs ${info.baseline_auc.toFixed(4)} zone baseline`} />
        <Stat label="Accuracy" value={`${(info.accuracy * 100).toFixed(1)}%`} sub={`base rate ${(info.base_rate * 100).toFixed(1)}%`} />
        <Stat label="Shots trained on" value={info.shots_trained.toLocaleString()} sub={info.seasons} />
        <Stat label="Skill score" value={info.bss.toFixed(3)} sub={`baseline ${info.baseline_bss.toFixed(3)} — over twice the skill`} />
      </div>

      <div className="card mb-6">
        <div className="label mb-2">What the numbers mean</div>
        <p className="text-sm text-txt-secondary leading-relaxed">
          A shot outcome is close to a coin flip: the league makes about {(info.base_rate * 100).toFixed(0)}% of
          attempts, so {((info.base_rate * (1 - info.base_rate)) * 100).toFixed(1)}% of the error is irreducible
          before any modelling starts. The skill score says how much of the <em>removable</em> uncertainty the
          model actually removes: {(info.bss * 100).toFixed(1)}% against the zone baseline&apos;s{" "}
          {(info.baseline_bss * 100).toFixed(1)}%. Accuracy alone is misleading here, because always guessing
          &ldquo;miss&rdquo; already scores {((1 - info.base_rate) * 100).toFixed(1)}%.
        </p>
      </div>

      <div className="card mb-6">
        <div className="label mb-1">Where the error actually goes</div>
        <p className="text-xs text-txt-muted mb-4 leading-relaxed">
          The Murphy (1973) decomposition splits the Brier score into three parts, which is
          why it is the headline here rather than AUC: AUC has no meaningful zero, so 0.70
          is uninterpretable without the ceiling beside it.
        </p>

        <div className="flex h-8 rounded-md overflow-hidden border border-line">
          <div
            className="bg-txt-muted/40 flex items-center justify-center text-[10px] text-txt-secondary"
            style={{ width: `${(MURPHY.uncertainty / (MURPHY.uncertainty + MURPHY.resolution)) * 100}%` }}
          >
            irreducible
          </div>
          <div
            className="bg-accent-teal/50 flex items-center justify-center text-[10px] text-txt-primary"
            style={{ width: `${(MURPHY.resolution / (MURPHY.uncertainty + MURPHY.resolution)) * 100}%` }}
          >
            extracted
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-5">
          <div>
            <div className="label">Uncertainty {MURPHY.uncertainty.toFixed(4)}</div>
            <p className="text-xs text-txt-secondary mt-1 leading-relaxed">
              Fixed by the {(info.base_rate * 100).toFixed(1)}% base make rate. No model of any
              kind can remove it: even dunks miss 11% of the time.
            </p>
          </div>
          <div>
            <div className="label">Resolution {MURPHY.resolution.toFixed(4)}</div>
            <p className="text-xs text-txt-secondary mt-1 leading-relaxed">
              What the model actually extracts from context — the part that is genuinely
              earned. Higher is better.
            </p>
          </div>
          <div>
            <div className="label">Reliability {MURPHY.reliability.toFixed(4)}</div>
            <p className="text-xs text-txt-secondary mt-1 leading-relaxed">
              Miscalibration, and it is essentially zero. When this model says 70%, it means
              70%. Lower is better.
            </p>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-line">
          <div className="font-mono text-xs text-txt-secondary">
            {MURPHY.uncertainty.toFixed(4)} − {MURPHY.resolution.toFixed(4)} +{" "}
            {MURPHY.reliability.toFixed(4)} = {MURPHY.reconstructed.toFixed(4)}{" "}
            <span className="text-txt-muted">
              (measured Brier {MURPHY.brier.toFixed(4)}, residual {MURPHY.residual.toFixed(4)})
            </span>
          </div>
          <p className="text-[11px] text-txt-muted mt-2 leading-relaxed">
            The decomposition is exact only when every forecast inside a bin is identical.
            Over {MURPHY.bins} quantile bins of real-valued forecasts it reconstructs to within{" "}
            {MURPHY.residual.toFixed(4)} — small against a resolution of{" "}
            {MURPHY.resolution.toFixed(4)}, but not zero, so it is shown rather than rounded away.
          </p>
        </div>
      </div>

      <div className="card mb-6">
        <div className="label mb-1">Why 0.70 is the frontier, not a shortfall</div>
        <p className="text-sm text-txt-secondary leading-relaxed">
          Of the physical quantities that decide whether a shot falls, the two that matter
          most are the least predictable before release. Entry angle has an R² of just{" "}
          <span className="stat">0.046</span> from everything knowable pre-release, and the
          ball&apos;s minimum distance to the rim only <span className="stat">0.363</span>.
          The apex height and flight time are predictable (R² 0.612 and 0.561) because they
          follow the ballistic envelope — but they are not what decides the outcome.
        </p>
        <p className="text-sm text-txt-secondary leading-relaxed mt-3">
          The residual is <em>execution</em>: millimetres of wrist angle at release, which no
          contextual feature can recover. The same methods reach{" "}
          <span className="stat">AUC 0.81</span> predicting whether a player will post an
          elite shooting <em>season</em>, because aggregating over a season averages that
          execution noise away. The gap between 0.81 and 0.70 is a property of the target,
          not of the modelling.
        </p>
        <p className="text-xs text-txt-muted leading-relaxed mt-3">
          Published single-shot work with full commercial tracking lands at 0.61–0.68 accuracy
          and roughly 0.70 AUC. A model claiming ≥0.80 on shot-make has leaked the outcome,
          which this project demonstrates deliberately as a negative control.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="label mb-3">Feature importance</div>
          <p className="text-xs text-txt-muted mb-4">Hover a bar for what it means.</p>
          <FeatureImportanceChart features={features} />
        </div>

        <div className="card">
          <div className="label mb-3">What if one thing changed</div>
          <div className="flex gap-1 mb-4">
            {SWEEPS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSweep(s)}
                className={`h-8 px-3 rounded-md text-xs border transition-colors duration-150 ${
                  sweep.id === s.id
                    ? "bg-accent-blue border-accent-blue text-white"
                    : "bg-bg-tertiary border-line text-txt-secondary hover:text-txt-primary"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={curve} margin={{ left: -18, right: 8, top: 8 }}>
              <XAxis dataKey="x" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false}
                     label={{ value: sweep.unit, position: "insideBottomRight", fill: "#6b7280", fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={info.base_rate * 100} stroke="#374151" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [`${v.toFixed(1)}%`, "probability"]}
                labelFormatter={(l) => `${l} ${sweep.unit}`}
              />
              <Line type="monotone" dataKey="p" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
          {summary && <p className="text-xs text-txt-muted mt-2">{sweep.label}: {summary}</p>}

          {REFERENCE[sweep.id] && (
            <div className="mt-5 pt-4 border-t border-line">
              <div className="text-sm text-txt-secondary mb-1">{REFERENCE[sweep.id].title}</div>
              <ReferenceCurve
                data={REFERENCE[sweep.id].build()}
                xLabel={sweep.unit} yLabel="factor" refY={1}
                caveat={REFERENCE[sweep.id].caveat}
              />
            </div>
          )}
        </div>
      </div>

      <div className="card mt-6">
        <div className="label mb-1">Reference curves from the literature</div>
        <p className="text-xs text-txt-muted mb-5 leading-relaxed">
          Documented effects from the research, drawn for context. They are never applied to a
          prediction: the model returns its own calibrated probability, and overwriting a measured
          result with an assumed one would be worse than showing neither. Where this project measured
          the same effect directly, the measurement is noted.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-txt-secondary mb-1">Shot-clock penalty</div>
            <ReferenceCurve
              data={clockCurve} xLabel="s" yLabel="factor" refY={1}
              caveat="Flat above 10 s, 15% penalty at zero. Measured on complete play-by-play the real effect is larger: 42.9% make rate with 0-4 s left against 67.5% with 20-24 s."
            />
          </div>
          <div>
            <div className="text-sm text-txt-secondary mb-1">Defender separation</div>
            <ReferenceCurve
              data={defCurve} xLabel="ft" yLabel="factor" refY={1}
              caveat="Steepest gains inside 4 ft, flat past 8. This project cannot verify it in the core model: per-shot defender distance is not public across the window, so the model is contest-blind. On 2015-16 tracking, defender ANGLE separated outcomes better than distance did."
            />
          </div>
          <div>
            <div className="text-sm text-txt-secondary mb-1">Game-state pressure</div>
            <ReferenceCurve
              data={pressCurve} xLabel="margin" yLabel="factor" refY={1}
              caveat="Clutch penalty from sports psychology. This project measured it as null: score margin correlates 0.0014 with the outcome, and the game-state family scored -0.0001 val AUC and was dropped. Game state drives shot selection, not whether one falls."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
