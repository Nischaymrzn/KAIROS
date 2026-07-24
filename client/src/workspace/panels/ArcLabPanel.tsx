/**
 * ARC LAB — will this arc physically go in?
 *
 * WHY THIS EXISTS AT ALL, which the old version never said.
 * The model scores CONTEXT: where, what action, how guarded, what the clock says.
 * It has no arc feature and never will, because the shot record does not contain
 * one. So there is a whole half of a shot the probability upstairs is blind to,
 * and it is the half a coach can actually correct in a gym: how high you put it.
 *
 * Two things decide that, and both are geometry rather than opinion:
 *
 *   FITS THE RIM. Seen from a descending ball the hoop is not an 18 inch circle,
 *   it is an ellipse 18·sin(entry angle) across. Flatten the arc and that window
 *   shrinks until a 9.5 inch ball no longer passes. At a 30 degree entry the
 *   opening is smaller than the ball — the shot cannot go in cleanly at any speed.
 *
 *   CLEARS THE HAND. The same arc has to be above the defender's reach when it
 *   passes over him. Flatter is faster and harder to time; higher clears him.
 *
 * Those two pull in OPPOSITE directions at the margins, which is the whole point
 * of the panel and was the thing the old wall of readouts never let anyone see.
 *
 * The rewrite is a presentation change only. Every number still comes from
 * `physics/ballistics`, the same module the blue arc in the scene is drawn from,
 * so the panel and the 3D can never disagree.
 */
import { useEffect, useMemo } from "react";
import { useShotStore } from "../../state/shotStore";
import { usePlayersStore } from "../../state/playersStore";
import { usePhysicsStore } from "../../state/physicsStore";
import * as D from "../../constants/dimensions";
import {
  solveArc, minSpeedAngleDeg, releaseHeight, measureFromProfile,
  contestCheck,
} from "../../physics/ballistics";

export function ArcLabPanel() {
  const scenario = useShotStore((s) => s.scenario);
  const active = usePlayersStore((s) => s.active);
  const launchDeg = usePhysicsStore((s) => s.launchDeg);
  const setLaunchDeg = usePhysicsStore((s) => s.setLaunchDeg);

  // release the override on close, so the rest of the app draws the optimal arc
  useEffect(() => () => setLaunchDeg(null), [setLaunchDeg]);

  const calc = useMemo(() => {
    const rim = { x: D.basketX(-1), z: 0 };
    const dist = Math.hypot(rim.x - scenario.x, rim.z - scenario.z);
    const m = measureFromProfile(active?.profile);
    const h0 = releaseHeight(m, scenario.shotType);
    const minDeg = minSpeedAngleDeg(dist, h0);
    const deg = launchDeg ?? minDeg + 4;
    const sol = solveArc(dist, h0, deg);
    const defDist = scenario.defenderDistance;
    const contest = sol && defDist != null
      ? contestCheck(defDist, measureFromProfile(undefined), dist, h0, sol)
      : null;
    return { dist, h0, minDeg, deg, sol, contest, m };
  }, [scenario, active, launchDeg]);

  const { dist, h0, minDeg, deg, sol, contest } = calc;
  const isDunk = scenario.shotType === "dunk";
  const atRim = dist < 1.5;

  // ---- a dunk has no arc to solve; say so instead of showing empty gauges ----
  if (isDunk || atRim) {
    const top = calc.m.standingReachFt + calc.m.maxVerticalFt;
    return (
      <div className="pn-body">
        <div className="al-verdict flat">{isDunk ? "Carried, not thrown" : "Standing at the rim"}</div>
        <div className="pn-note">
          {isDunk
            ? "A dunk is carried to the rim, so there is no arc to solve. What decides it is the jump."
            : "Step back from the rim to solve an arc."}
        </div>
        <div className="al-nums">
          <div><span>Reach and lift</span><b>{top.toFixed(2)} ft</b></div>
          <div><span>Rim</span><b>10.00 ft</b></div>
        </div>
      </div>
    );
  }

  if (!sol) {
    return (
      <div className="pn-body">
        <div className="al-verdict bad">That angle cannot reach</div>
        <div className="pn-note">
          At {deg.toFixed(0)}° the ball never gets to the rim from {dist.toFixed(0)} ft.
          Raise it.
        </div>
        <ArcSlider deg={deg} minDeg={minDeg} onChange={setLaunchDeg} onReset={() => setLaunchDeg(null)} />
      </div>
    );
  }

  const fits = sol.rimMarginIn > 0;
  const clears = !contest || !contest.blocked;
  const verdict = !fits ? "Too flat to fit"
    : !clears ? "He can reach it"
    : "Good arc";
  const tone = !fits || !clears ? "bad" : "good";

  return (
    <div className="pn-body">
      <div className={`al-verdict ${tone}`}>{verdict}</div>

      <ArcSlider deg={deg} minDeg={minDeg} onChange={setLaunchDeg} onReset={() => setLaunchDeg(null)} />

      {/* the two gates, each with the margin that decides it */}
      <div className="al-gates">
        <div className={fits ? "pass" : "fail"}>
          <i>{fits ? "✓" : "✗"}</i>
          <span>Fits the rim</span>
          <b>{sol.rimMarginIn > 0 ? "+" : ""}{sol.rimMarginIn.toFixed(1)} in</b>
        </div>
        <div className={contest ? (clears ? "pass" : "fail") : "none"}>
          <i>{contest ? (clears ? "✓" : "✗") : "–"}</i>
          <span>Clears the hand</span>
          <b>
            {contest
              ? `${contest.clearanceFt > 0 ? "+" : ""}${contest.clearanceFt.toFixed(1)} ft`
              : "no defender"}
          </b>
        </div>
      </div>

      <div className="pn-note">
        {!fits
          ? `At a ${sol.entryDeg.toFixed(0)}° entry the rim looks ${(sol.rimOpeningRatio * 100).toFixed(0)}% of a ball wide. Raise the arc.`
          : !clears
          ? `The ball is ${contest!.ballHeightAtDefender.toFixed(1)} ft up as it passes him and he reaches ${contest!.contestCeiling.toFixed(1)} ft. Raise it or step back.`
          : `Entering at ${sol.entryDeg.toFixed(0)}°, the rim looks ${(sol.rimOpeningRatio * 100).toFixed(0)}% of a ball wide.`}
      </div>

      <div className="al-nums">
        <div><span>Entry</span><b>{sol.entryDeg.toFixed(0)}°</b></div>
        <div><span>Speed</span><b>{sol.speedFps.toFixed(1)} ft/s</b></div>
        <div><span>Apex</span><b>{sol.apexFt.toFixed(1)} ft</b></div>
        <div><span>Release</span><b>{h0.toFixed(1)} ft</b></div>
      </div>

      <div className="pn-note">
        The model never sees the arc. This is the part of a shot it is blind to.
      </div>
    </div>
  );
}

function ArcSlider({
  deg, minDeg, onChange, onReset,
}: {
  deg: number; minDeg: number;
  onChange: (v: number) => void; onReset: () => void;
}) {
  const off = deg - minDeg;
  return (
    <div className="al-arc">
      <div className="al-arc-head">
        <b>{deg.toFixed(0)}°</b>
        <span>
          launch
          {Math.abs(off) >= 0.5 && (
            <em>{off > 0 ? " +" : " "}{off.toFixed(0)}° vs flattest</em>
          )}
        </span>
        <button className="pn-mini" onClick={onReset}>reset</button>
      </div>
      <input
        type="range" min={30} max={70} step={0.5} value={deg}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Launch angle"
      />
    </div>
  );
}
