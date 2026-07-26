/**
 * SHOT LAB — the core surface: where the shooter stands, what the action is, and
 * what the model thinks of the result.
 *
 * Quick spots exist because typing coordinates is not how anyone thinks about a
 * basketball court. Each one sets the position AND the shot type that spot
 * actually produces, so "corner three" gives a catch-and-shoot rather than
 * leaving a hook shot selected from the previous experiment.
 */
import { useEffect } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { useAnalyticsStore } from "../../state/analyticsStore";
import { ZONE_LABEL } from "../../scenario/schema";
import type { ShotVerb } from "../../scenario/schema";

const QUALITY_COLOR: Record<string, string> = {
  Excellent: "#35c26e", Good: "#6fcf97", Average: "#f2c94c",
  Poor: "#f2994a", "Very Poor": "#eb5757",
};

/** Named spots every basketball conversation needs. The free-throw spot is scored
 *  as a 15 ft set shot — free throws are not field goals, so they are outside the
 *  model's vocabulary, and this is the honest nearest analogue. */
const QUICK_SPOTS: { label: string; x: number; z: number; verb: ShotVerb; title: string }[] = [
  { label: "Rim", x: -40.5, z: 0.8, verb: "dunk", title: "Restricted area" },
  { label: "Elbow", x: -28, z: 8, verb: "pullup", title: "Right elbow mid-range" },
  { label: "Free throw", x: -28, z: 0, verb: "catch_shoot", title: "FT line, scored as a set shot" },
  { label: "Corner 3", x: -39, z: 22.5, verb: "catch_shoot", title: "Right corner three, 22 ft" },
  { label: "Wing 3", x: -22, z: 16, verb: "catch_shoot", title: "Right wing three" },
  { label: "Top 3", x: -16.5, z: 0, verb: "catch_shoot", title: "Above the break, about 25 ft" },
  { label: "Deep", x: -12, z: -4, verb: "pullup", title: "Well beyond the arc" },
];

export function ShotLabPanel() {
  const scenario = useScenarioStore((s) => s.scenario);
  const setShotType = useScenarioStore((s) => s.setShotType);
  const setPosition = useScenarioStore((s) => s.setPosition);
  const setGame = useScenarioStore((s) => s.setGame);
  const derived = useScenarioStore((s) => s.derived)();
  const { ranked, rankLoading, fetchRank } = useAnalyticsStore();

  const { x, z } = scenario.shot;
  const { playerId, positionGroup } = scenario.player;

  useEffect(() => {
    fetchRank({ x, z, playerId, positionGroup });
  }, [x, z, playerId, positionGroup, fetchRank]);

  return (
    <div className="pn-body">
      <div className="sl-where">
        <span className="sl-zone">{ZONE_LABEL[derived.zone]}</span>
        <span className="sl-dist">{derived.distance.toFixed(1)} ft · {derived.points} pt</span>
      </div>

      <div className="pn-label">Go to spot</div>
      <div className="an-pills">
        {QUICK_SPOTS.map((s) => (
          <button
            key={s.label}
            className="an-pill"
            title={s.title}
            onClick={() => { setShotType(s.verb); setPosition(s.x, s.z); }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="pn-label" style={{ marginTop: 10 }}>Game situation</div>
      <div className="sl-slider">
        <span>Shot clock</span>
        <input
          type="range" min={1} max={24} step={1}
          value={scenario.game.shotClock}
          onChange={(e) => setGame({ shotClock: Number(e.target.value) })}
        />
        <strong style={{
          color: scenario.game.shotClock <= 4 ? "#eb5757"
            : scenario.game.shotClock <= 7 ? "#f2994a" : undefined,
        }}>
          {scenario.game.shotClock}s
        </strong>
      </div>
      <div className="sl-slider">
        <span>Score margin</span>
        <input
          type="range" min={-30} max={30} step={1}
          value={scenario.game.scoreMargin}
          onChange={(e) => setGame({ scoreMargin: Number(e.target.value) })}
        />
        <strong>{scenario.game.scoreMargin > 0 ? "+" : ""}{scenario.game.scoreMargin}</strong>
      </div>
      <div className="sl-slider">
        <span>Period</span>
        <input
          type="range" min={1} max={5} step={1}
          value={scenario.game.quarter}
          onChange={(e) => setGame({ quarter: Number(e.target.value) })}
        />
        <strong>{scenario.game.quarter === 5 ? "OT" : `Q${scenario.game.quarter}`}</strong>
      </div>

      <div className="pn-label" style={{ marginTop: 10 }}>Best shot from here</div>
      {rankLoading && <div className="an-loading">Ranking</div>}
      {!rankLoading && ranked.slice(0, 6).map((r, i) => (
        <button
          key={r.shot_type}
          className={`rank-row as-button ${r.shot_type === scenario.shot.shotType ? "current" : ""}`}
          title="Use this shot type"
          onClick={() => setShotType(r.shot_type as ShotVerb)}
        >
          <span className="rank-num">{i + 1}</span>
          <div className="rank-info">
            <span className="rank-type">{r.shot_type.replace(/_/g, " ")}</span>
            <div className="rank-bar-wrap">
              <div className="rank-bar" style={{
                width: `${Math.round(r.probability * 100)}%`,
                background: QUALITY_COLOR[r.quality] ?? "#888",
              }} />
            </div>
          </div>
          <div className="rank-right">
            <span className="rank-pct" style={{ color: QUALITY_COLOR[r.quality] ?? "#888" }}>
              {Math.round(r.probability * 100)}%
            </span>
            <span className="rank-xp">{r.expected_points.toFixed(2)} xPts</span>
          </div>
        </button>
      ))}
      <div className="pn-note">
        Expected points is probability times what the shot is worth. That is why a
        36 per cent three can outrank a 48 per cent two.
      </div>
    </div>
  );
}
