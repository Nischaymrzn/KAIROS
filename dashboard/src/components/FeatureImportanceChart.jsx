import { useState } from "react";

export function FeatureImportanceChart({ features }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...features.map((f) => f.importance)) || 1;

  return (
    <div className="space-y-2">
      {features.map((f) => (
        <div
          key={f.name}
          onMouseEnter={() => setHover(f.name)}
          onMouseLeave={() => setHover(null)}
          className="cursor-default"
        >
          <div className="flex justify-between text-xs mb-1">
            <span className="text-txt-secondary">{f.name}</span>
            <span className="stat text-txt-muted">{(f.importance * 100).toFixed(0)}</span>
          </div>
          <div className="h-2 rounded bg-bg-tertiary overflow-hidden">
            <div
              className="h-full rounded bg-accent-blue transition-[width] duration-300"
              style={{ width: `${(f.importance / max) * 100}%` }}
            />
          </div>
          {hover === f.name && (
            <p className="text-[11px] text-txt-muted mt-1.5 leading-relaxed">{f.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}
