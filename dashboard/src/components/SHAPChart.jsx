import { shapWaterfall, BASE_RATE } from "../science";

/**
 * SHAP as a waterfall. Starts at the league base rate and each feature steps the
 * probability up or down, so the bars add up to the number on the gauge rather
 * than being five bars that happen to sit near it. Whatever the top five do not
 * explain is shown as "Other factors" instead of being dropped, which is what
 * keeps the arithmetic honest.
 */
export function SHAPChart({ shapValues = [], probability }) {
  if (!shapValues.length) return null;

  const { steps, total } = shapWaterfall(shapValues, probability ?? BASE_RATE);
  const lo = Math.min(BASE_RATE, ...steps.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(BASE_RATE, ...steps.map((s) => Math.max(s.from, s.to)));
  const pad = 0.04;
  const min = Math.max(0, lo - pad);
  const max = Math.min(1, hi + pad);
  const pct = (v) => ((v - min) / (max - min)) * 100;

  return (
    <div>
      <div className="flex justify-between text-[11px] text-txt-muted mb-2">
        <span>base rate {(BASE_RATE * 100).toFixed(1)}%</span>
        <span className="stat text-txt-secondary">{(total * 100).toFixed(1)}%</span>
      </div>

      <div className="space-y-1.5">
        {steps.map((s) => {
          const pos = s.value >= 0;
          const left = pct(Math.min(s.from, s.to));
          const width = Math.abs(pct(s.to) - pct(s.from));
          return (
            <div key={s.feature} className="text-xs">
              <div className="flex justify-between mb-1">
                <span className={s.isOther ? "text-txt-muted italic" : "text-txt-secondary"}>
                  {s.feature}
                </span>
                <span className={`stat ${pos ? "text-accent-teal" : "text-accent-red"}`}>
                  {pos ? "+" : ""}{(s.value * 100).toFixed(1)}
                </span>
              </div>
              <div className="relative h-2.5 rounded bg-bg-tertiary overflow-hidden">
                <div
                  className="absolute inset-y-0 w-px bg-line"
                  style={{ left: `${pct(BASE_RATE)}%` }}
                />
                <div
                  className={`absolute inset-y-0 rounded ${
                    s.isOther ? "bg-txt-muted/50" : pos ? "bg-accent-teal" : "bg-accent-red"
                  }`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.8)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-txt-muted mt-3 leading-relaxed">
        Each bar moves the probability from where the previous one left it. The dividing
        line is the league base rate.
      </p>
    </div>
  );
}
