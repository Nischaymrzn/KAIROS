import { BALL_DIAMETER_IN, RIM_DIAMETER_IN, effectiveRimWidth } from "../science";

/**
 * How much rim the ball actually has, drawn to scale.
 *
 * The bar is the full 18 in rim. The filled portion is what the entry angle
 * leaves — 18 x sin(entry) — and the pale block inside it is the ball at 9.4 in
 * on the same scale. The margin is what is left over, halved because it sits on
 * both sides. Seeing the ball nearly fill the opening communicates the problem
 * in a way the number alone does not.
 */
export function RimTargetBar({ entryDeg }) {
  const eff = effectiveRimWidth(entryDeg);
  const margin = (eff - BALL_DIAMETER_IN) / 2;
  const tone =
    margin > 3 ? "text-accent-green" : margin >= 1 ? "text-accent-amber" : "text-accent-red";
  const fill =
    margin > 3 ? "bg-accent-green/30" : margin >= 1 ? "bg-accent-amber/30" : "bg-accent-red/30";
  const edge =
    margin > 3 ? "border-accent-green" : margin >= 1 ? "border-accent-amber" : "border-accent-red";

  const pct = (v) => `${Math.max(0, Math.min(100, (v / RIM_DIAMETER_IN) * 100))}%`;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="label">Effective target</span>
        <span className={`stat text-lg ${tone}`}>{eff.toFixed(1)} in</span>
      </div>

      <div className="relative h-8 rounded-md border border-line bg-bg-tertiary overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${fill} border-r ${edge}`} style={{ width: pct(eff) }} />
        <div
          className="absolute inset-y-1 rounded-sm bg-txt-muted/40 border border-txt-secondary/50"
          style={{ left: 0, width: pct(BALL_DIAMETER_IN) }}
          title={`ball ${BALL_DIAMETER_IN} in`}
        />
      </div>

      <div className="flex justify-between text-[10px] text-txt-muted mt-1">
        <span>ball {BALL_DIAMETER_IN} in</span>
        <span>rim {RIM_DIAMETER_IN} in</span>
      </div>

      <div className={`text-xs mt-2 ${tone}`}>
        {margin > 0
          ? `${margin.toFixed(1)} in clearance either side`
          : "the opening is narrower than the ball at this angle"}
      </div>
    </div>
  );
}
