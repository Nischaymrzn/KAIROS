/**
 * PREDICTION PANEL — probability, quality label, 2PT/3PT + EXPECTED POINTS,
 * top SHAP factors, and the source badge (live model vs offline heuristic).
 *
 * Reading the number honestly: NBA shots miss MORE than they make — the league
 * hits ≈46% overall, ≈36% from three. A "39% Poor" pull-up isn't a broken
 * model, it's a real look. Expected points (probability × shot value) is the
 * lens that makes a 35% three (1.05 xPts) beat a 45% long two (0.90 xPts).
 * The 2/3-point split here uses the SAME geometry as the backend adapter.
 */
import { useShotStore } from "../state/shotStore";
import { usePlayersStore } from "../state/playersStore";
import { basketX } from "../constants/dimensions";

const QUALITY_COLOR: Record<string, string> = {
  Excellent: "#35c26e",
  Good: "#6fcf97",
  Average: "#f2c94c",
  Poor: "#f2994a",
  "Very Poor": "#eb5757",
};

/** Friendly labels for the SHAP feature names the backend returns. */
const FACTOR_LABELS: Record<string, string> = {
  shot_distance: "Shot distance",
  is_dunk: "Shot type",
  is_3pt: "3-point attempt",
  zone_fg_pct: "Zone avg FG%",
  xp: "Expected pts",
  defender_distance: "Defender dist",
  contest_category: "Contest level",
  shot_clock: "Shot clock",
  action_type: "Shot action",
  player_fg_pct: "Player FG%",
  player_3p_pct: "Player 3P%",
  player_freq: "Player frequency",
  loc_x: "Court lateral",
  loc_y: "Court depth",
};

function label(feature: string) {
  return FACTOR_LABELS[feature] ?? feature.replace(/_/g, " ");
}

const HOOP_X = basketX(-1);

/** Same 2/3-point geometry as backend/services/adapter.py. */
function shotValue(x: number, z: number): { pts: 2 | 3; dist: number } {
  const depth = x - HOOP_X;
  const dist = Math.hypot(depth, z);
  const corner = Math.abs(z) >= 22 && depth <= 14;
  const isThree = dist >= 23.75 || (corner && dist >= 22);
  return { pts: isThree ? 3 : 2, dist };
}

export function PredictionPanel() {
  const prediction = useShotStore((s) => s.prediction);
  const scenario = useShotStore((s) => s.scenario);
  const activeName = usePlayersStore((s) => s.active?.name ?? null);

  if (!prediction) {
    return (
      <div className="pred-panel">
        <div className="pred-hint">Click anywhere on the court to predict shot quality</div>
      </div>
    );
  }

  const { probability, quality, factors, source, pending } = prediction;
  const pct = Math.round(probability * 100);
  const color = QUALITY_COLOR[quality] ?? "#888";
  const arc = (pct / 100) * 251.2; // circumference of r=40 circle ≈ 251.2
  const { pts, dist } = shotValue(scenario.x, scenario.z);
  const xPts = probability * pts;

  return (
    <div className={`pred-panel ${pending ? "pending" : ""}`}>
      {/* what shot this is — the 2/3 split, unmissable */}
      <div className="pred-shot-line">
        <span className={`pt-badge ${pts === 3 ? "three" : "two"}`}>{pts}PT</span>
        <span className="pred-shot-desc">
          {scenario.shotType.replace(/_/g, " ")} · {dist.toFixed(1)} ft
        </span>
      </div>

      {/* gauge ring */}
      <div className="pred-gauge-wrap">
        <svg viewBox="0 0 100 100" className="pred-gauge">
          <circle cx="50" cy="50" r="40" className="gauge-track" />
          <circle
            cx="50" cy="50" r="40"
            className="gauge-fill"
            style={{ stroke: color, strokeDasharray: `${arc} 251.2` }}
          />
        </svg>
        <div className="pred-pct" style={{ color }}>{pct}<span>%</span></div>
      </div>

      <div className="pred-quality" style={{ color }}>{quality}</div>

      <div className="xpts-line">
        <span className="xpts-value">{xPts.toFixed(2)}</span>
        <span className="xpts-label">expected points</span>
      </div>

      {/* SHAP factors */}
      {factors.length > 0 && (
        <div className="pred-factors">
          <div className="pred-factors-title">Key factors</div>
          {factors.slice(0, 5).map((f) => (
            <div key={f.feature} className="pred-factor-row">
              <span className="pred-factor-name">{label(f.feature)}</span>
              <div className="pred-factor-bar-wrap">
                <div
                  className="pred-factor-bar"
                  style={{
                    width: `${Math.min(Math.abs(f.contribution) * 220, 100)}%`,
                    background: f.contribution >= 0 ? "#35c26e" : "#eb5757",
                  }}
                />
              </div>
              <span className={`pred-factor-val ${f.contribution >= 0 ? "pos" : "neg"}`}>
                {f.contribution >= 0 ? "+" : ""}{(f.contribution * 100).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Who is shooting, and the contest — the two facts that change the number
          and are not already on screen. The league-baseline paragraph and the
          five-band colour legend that used to sit here were reference material,
          not a readout: they said the same thing on every shot, so they became
          furniture the eye had to step over to reach the number. */}
      <div className="pred-context">
        <span>{activeName ?? "generic shooter"}</span>
        {scenario.defenderDistance != null && (
          <>
            <span>·</span>
            <span>defender {scenario.defenderDistance.toFixed(1)} ft</span>
          </>
        )}
      </div>

      {/* source badge */}
      {/* Silent when it is the model, which is the normal case. A green "live"
          pill on every prediction is a label for a thing that is always true. */}
      {source !== "live" && (
        <div className="pred-source offline" title="Backend unreachable. This is a measured heuristic, not the model.">
          offline estimate
        </div>
      )}
    </div>
  );
}
