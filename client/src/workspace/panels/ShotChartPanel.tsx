/**
 * SHOT CHART — the model's make probability over the whole half court, top-down.
 *
 * The heat map already existed as coloured squares lying on the 3D floor. That is
 * a nice effect and a poor chart: in perspective the far cells are a third the
 * size of the near ones, the court lines that give a cell its meaning are seen
 * edge-on, and there is no legend, so a colour cannot be turned back into a
 * number. A coach cannot read it, which is what the request was about.
 *
 * Same data, drawn flat. Every cell is the same size, the court markings sit
 * under it at true proportion, and a legend maps colour back to a percentage.
 *
 * The ramp is the shared sequential scale: one hue, light to dark. The floor
 * overlay used blue → yellow → red, a rainbow, which has no perceptual order —
 * two cells could not be ranked without going back to a legend that did not
 * exist. Both surfaces now read from the same ramp, so a cell in the arena and a
 * cell here mean the same thing.
 */
import { useEffect } from "react";
import { useAnalyticsStore } from "../../state/analyticsStore";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { TacticalBoard, fx, fz, flen } from "../../viz/TacticalBoard";
import { MAKE_RATE, rateColor, INK } from "../../viz/palette";

/** Cell size in feet. Matches the `step: 3` the store requests, with a hair of
 *  overlap so the grid reads as a surface rather than as dots. */
const CELL = 3.2;

/** Domain of the ramp. Fixed rather than per-request, so the colour of a spot
 *  does not change meaning when the shot type does. */
const LO = 0.2;
const HI = 0.62;

export function ShotChartPanel() {
  const cells = useAnalyticsStore((s) => s.heatCells);
  const loading = useAnalyticsStore((s) => s.heatLoading);
  const fetchHeat = useAnalyticsStore((s) => s.fetchHeat);
  const scenario = useScenarioStore((s) => s.scenario);
  const derived = useScenarioStore((s) => s.derived)();
  const setPosition = useScenarioStore((s) => s.setPosition);

  const verb = scenario.shot.shotType;
  const pos = scenario.player.positionGroup;

  useEffect(() => { fetchHeat(verb, pos); }, [verb, pos, fetchHeat]);

  const best = cells.length
    ? cells.reduce((a, c) => (c.probability > a.probability ? c : a))
    : null;

  return (
    <div className="pn-body">
      <div className="pn-label">
        Make probability, {verb.replace(/_/g, " ")} <span className="cx-src">model</span>
      </div>

      {loading && <div className="pn-note">scoring the floor</div>}

      <TacticalBoard
        label={`Model make probability across the half court for a ${verb.replace(/_/g, " ")}`}
        under={cells.map((c, i) => (
          <rect
            key={i}
            x={fx(c.x) - flen(CELL) / 2}
            y={fz(c.z) - flen(CELL) / 2}
            width={flen(CELL)} height={flen(CELL)}
            fill={rateColor(c.probability, LO, HI)}
            opacity={0.95}
          >
            <title>{`${Math.round(c.probability * 100)}% from ${Math.hypot(c.x + 41.75, c.z).toFixed(0)} ft`}</title>
          </rect>
        ))}
      >
        {/* where the shooter is standing now */}
        <circle
          cx={fx(scenario.shot.x)} cy={fz(scenario.shot.z)} r={flen(1.6)}
          fill="none" stroke={INK.primary} strokeWidth={2.5}
        />
        {/* and the best spot the model found for this action */}
        {best && (
          <circle
            cx={fx(best.x)} cy={fz(best.z)} r={flen(1.2)}
            fill="none" stroke="#35c26e" strokeWidth={2} strokeDasharray="4 3"
          />
        )}
      </TacticalBoard>

      {/* Legend. Without one a colour cannot be turned back into a number, which
          is most of why the floor overlay could not be read. */}
      <div className="sc-legend">
        <span>{Math.round(LO * 100)}%</span>
        <i style={{ background: `linear-gradient(to right, ${MAKE_RATE.join(",")})` }} />
        <span>{Math.round(HI * 100)}%</span>
      </div>

      <div className="sc-facts">
        <div>
          <span>Here</span>
          <b>{Math.round((derived.zoneRate ?? 0) * 100) || "·"}</b>
        </div>
        {best && (
          <div>
            <span>Best spot</span>
            <b>{Math.round(best.probability * 100)}%</b>
            <button
              className="pn-mini"
              onClick={() => setPosition(best.x, best.z)}
            >
              move there
            </button>
          </div>
        )}
      </div>

      <div className="pn-note">
        Scored for the current action and shooter. Change either and the floor is
        rescored.
      </div>
    </div>
  );
}
