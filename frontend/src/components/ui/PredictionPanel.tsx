import { useAppStore } from "@/store/useAppStore";
import { QUALITY_COLOR } from "@/lib/dummyPredictor";

function Gauge({ p, color }: { p: number; color: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - p);
  return (
    <svg width="132" height="132" viewBox="0 0 132 132">
      <circle cx="66" cy="66" r={r} fill="none" stroke="var(--bg-1)" strokeWidth="11" />
      <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="11"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        transform="rotate(-90 66 66)" style={{ transition: "stroke-dashoffset 0.45s, stroke 0.45s" }} />
      <text x="66" y="62" textAnchor="middle" fontSize="34" fontWeight="800" fill="var(--text-0)">
        {Math.round(p * 100)}%
      </text>
      <text x="66" y="84" textAnchor="middle" fontSize="11" fill="var(--text-2)">
        make probability
      </text>
    </svg>
  );
}

const SOURCE_META: Record<string, { label: string; color: string }> = {
  loading: { label: "scoring…", color: "var(--text-2)" },
  model: { label: "live model", color: "var(--q-good)" },
  dummy: { label: "offline estimate", color: "var(--q-average)" },
};

export function PredictionPanel() {
  const prediction = useAppStore((s) => s.prediction);
  const apiStatus = useAppStore((s) => s.apiStatus);
  const source = useAppStore((s) => s.predictionSource);
  const color = QUALITY_COLOR[prediction.quality];

  const meta = apiStatus === "loading" ? SOURCE_META.loading : SOURCE_META[source];

  return (
    <div className="panel card fade-up" style={{ textAlign: "center" }}>
      <h3 style={{ justifyContent: "center" }}><span className="dot" /> Shot Quality</h3>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Gauge p={prediction.probability} color={color} />
      </div>
      <span className="quality-pill" style={{ background: `${color}22`, color, marginTop: 4, display: "inline-block" }}>
        {prediction.quality}
      </span>
      <div style={{ marginTop: 8, fontSize: 10.5, color: meta.color, letterSpacing: 0.3 }}>
        <span style={{ opacity: 0.6 }}>●</span> {meta.label}
      </div>
    </div>
  );
}
