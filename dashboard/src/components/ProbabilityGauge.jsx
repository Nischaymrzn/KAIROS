import { useEffect, useRef, useState } from "react";

const TONE = {
  Elite: "text-accent-teal", High: "text-accent-green", Average: "text-accent-amber",
  Low: "text-accent-orange", Poor: "text-accent-red",
};
const BAR = {
  Elite: "bg-accent-teal", High: "bg-accent-green", Average: "bg-accent-amber",
  Low: "bg-accent-orange", Poor: "bg-accent-red",
};

/** Counts from the previous value to the new one over 600ms. */
function useCountUp(target) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (now) => {
      const t = Math.min((now - start) / 600, 1);
      setV(a + (target - a) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

/**
 * `zoneAverage` and `baseRate` are drawn on the bar as reference marks, because
 * a probability on its own does not say whether the shot is good. 41% is a poor
 * layup and an excellent three, and the only way to tell from the gauge is to
 * see the zone line sitting next to the fill.
 */
export function ProbabilityGauge({ probability, label, live, zoneAverage, baseRate = 0.462 }) {
  const v = useCountUp(probability * 100);
  const marks = [
    zoneAverage != null && { at: zoneAverage * 100, label: "zone", tone: "bg-txt-secondary" },
    { at: baseRate * 100, label: "league", tone: "bg-txt-muted" },
  ].filter(Boolean);

  return (
    <div className="text-center">
      <div className="label mb-2">Make Probability {live === false && <span className="text-accent-amber">· mock</span>}</div>
      <div className={`stat text-6xl leading-none ${TONE[label] ?? "text-txt-primary"}`}>
        {v.toFixed(1)}<span className="text-3xl">%</span>
      </div>
      <div className={`mt-2 text-sm font-semibold ${TONE[label] ?? ""}`}>{label}</div>

      <div className="mt-4 relative h-2 rounded-full bg-bg-tertiary">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${BAR[label] ?? "bg-accent-blue"}`}
          style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
        />
        {marks.map((m) => (
          <div
            key={m.label}
            className={`absolute -top-1 -bottom-1 w-px ${m.tone}`}
            style={{ left: `${Math.max(0, Math.min(100, m.at))}%` }}
            title={`${m.label} ${m.at.toFixed(1)}%`}
          />
        ))}
      </div>

      <div className="flex justify-center gap-4 mt-2 text-[10px] text-txt-muted">
        {marks.map((m) => (
          <span key={m.label}>
            {m.label} {m.at.toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}
