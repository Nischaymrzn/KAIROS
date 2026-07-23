/**
 * COMMAND BAR — every control that changes the shot, in one strip under the court.
 *
 * The complaint this answers is that the simulation could not be driven: the user
 * could move a player and shoot, and everything else was either buried on another
 * route or absent. So the full scenario is exposed here — action, contest,
 * mechanics, shooter build — and each control is labelled with the DATA LAYER it
 * belongs to, so nothing on screen implies an influence it does not have.
 *
 * The layer colours are load-bearing rather than decorative:
 *   model    the trained model receives it and learned from it
 *   physics  changes the trajectory and the geometry, never the probability
 * A physics control that silently did nothing to the number would be the same
 * failure as the defender control under v7, only quieter.
 */
import { useState } from "react";
import { useScenarioStore } from "../scenario/scenarioStore";
import { contestIsLive } from "../scenario/schema";
import type { HandPlacement, ReleaseHeight, ShotVerb } from "../scenario/schema";
import { useGameStore } from "../game/gameStore";
import { useDefenseStore } from "../state/defenseStore";
import { VerbRow } from "./VerbRow";
import { usePlaybackStore } from "../state/playbackStore";
import { solveArc, minSpeedAngleDeg, RELEASE_MODEL } from "../physics/ballistics";

const VERBS: { id: ShotVerb; label: string; group: string }[] = [
  { id: "dunk", label: "Dunk", group: "Rim" },
  { id: "driving_layup", label: "Driving layup", group: "Rim" },
  { id: "layup", label: "Layup", group: "Rim" },
  { id: "floater", label: "Floater", group: "Close" },
  { id: "hook", label: "Hook", group: "Close" },
  { id: "catch_shoot", label: "Catch & shoot", group: "Jumper" },
  { id: "pullup", label: "Pull-up", group: "Jumper" },
  { id: "stepback", label: "Step-back", group: "Jumper" },
  { id: "fadeaway", label: "Fadeaway", group: "Jumper" },
];

const RELEASE: ReleaseHeight[] = ["Low", "Medium", "High"];
const HANDS: HandPlacement[] = ["One Hand", "Two Hand", "Finger Roll", "Hook"];

export function CommandBar() {
  const [openTray, setOpenTray] = useState<"none" | "mechanics" | "shooter">("none");
  const scenario = useScenarioStore((s) => s.scenario);
  const setShotType = useScenarioStore((s) => s.setShotType);
  const setMechanics = useScenarioStore((s) => s.setMechanics);
  const setNearestOnLine = useScenarioStore((s) => s.setNearestOnLine);
  const clearDefenders = useScenarioStore((s) => s.clearDefenders);
  const triggerShot = useScenarioStore((s) => s.triggerShot);
  const replayClip = usePlaybackStore((s) => s.clip);
  const pending = useScenarioStore((s) => s.pending);
  const derived = useScenarioStore((s) => s.derived)();
  const practiceOn = useGameStore((s) => s.practiceOn);
  const placement = useDefenseStore((s) => s.placement);
  const setPlacement = useDefenseStore((s) => s.setPlacement);

  const contest = derived.contest.closest;
  const m = scenario.mechanics;
  const defenderCount = scenario.defenders.length;

  // Release height follows the verb, so the same launch angle gives a different
  // entry angle for a step-back than for a layup. Using a fixed height would make
  // the readout wrong in exactly the cases the tray exists to explore.
  const releaseFt =
    7.4 + 2.6 * ((RELEASE_MODEL[scenario.shot.shotType] ?? RELEASE_MODEL.pullup).jumpFactor);
  const arc = solveArc(derived.distance, releaseFt, m.jumpAngle);
  const bestAngle = minSpeedAngleDeg(derived.distance, releaseFt);

  return (
    <div className="cmd">
      {openTray === "mechanics" && (
        <div className="cmd-tray">
          <div className="tray-title">
            Mechanics <span className="layer physics">physics</span>
            <span className="tray-note">
              changes the arc and the entry angle, never the probability
            </span>
          </div>
          <div className="tray-grid">
            <label>
              <span>Release angle</span>
              <input type="range" min={30} max={70} step={1} value={m.jumpAngle}
                onChange={(e) => setMechanics({ jumpAngle: Number(e.target.value) })} />
              <strong style={{ color: m.jumpAngle >= 45 && m.jumpAngle <= 55 ? "#35c26e" : undefined }}>
                {m.jumpAngle}°
              </strong>
            </label>
            <label>
              <span>Approach angle</span>
              <input type="range" min={-90} max={90} step={5} value={m.approachAngle}
                onChange={(e) => setMechanics({ approachAngle: Number(e.target.value) })} />
              <strong>{m.approachAngle > 0 ? "+" : ""}{m.approachAngle}°</strong>
            </label>
            <label className="seg-label">
              <span>Release height</span>
              <div className="seg">
                {RELEASE.map((r) => (
                  <button key={r} className={m.releaseHeight === r ? "on" : ""}
                    onClick={() => setMechanics({ releaseHeight: r })}>{r}</button>
                ))}
              </div>
            </label>
            <label className="seg-label">
              <span>Hand</span>
              <div className="seg">
                {HANDS.map((h) => (
                  <button key={h} className={m.handPlacement === h ? "on" : ""}
                    onClick={() => setMechanics({ handPlacement: h })}>{h}</button>
                ))}
              </div>
            </label>
          </div>

          {arc ? (
            <div className="tray-arc">
              <span>
                Entry <b>{arc.entryDeg.toFixed(0)}°</b>
              </span>
              <span>
                Rim margin{" "}
                <b className={arc.rimMarginIn > 0 ? "up" : "down"}>
                  {arc.rimMarginIn > 0 ? "+" : ""}{arc.rimMarginIn.toFixed(1)} in
                </b>
              </span>
              <span>
                Best arc <b>{bestAngle.toFixed(0)}°</b>
              </span>
            </div>
          ) : (
            <div className="tray-arc">
              <span className="down">That angle cannot reach the rim from here.</span>
            </div>
          )}
        </div>
      )}

      <div className="cmd-main">
        {/* ---- action ---- */}
        <div className="cmd-group grow">
          <span className="cmd-k">
            Action <span className="layer model">model</span>
          </span>
          <VerbRow activeKey={scenario.shot.shotType}>
            {VERBS.map((v) => (
              <button
                key={v.id}
                className={`verb ${scenario.shot.shotType === v.id ? "on" : ""}`}
                title={`${v.group} — ${v.label}`}
                onClick={() => setShotType(v.id)}
              >
                {v.label}
              </button>
            ))}
          </VerbRow>
        </div>

        {/* ---- what a court click does ---- */}
        <div className="cmd-group">
          <span className="cmd-k">Click adds</span>
          <VerbRow>
            <button
              className={`verb ${placement === "shooter" ? "on" : ""}`}
              onClick={() => setPlacement("shooter")}
              title="Click the floor to move the shooter"
            >
              Shooter
            </button>
            <button
              className={`verb ${placement === "defender" ? "on" : ""}`}
              onClick={() => setPlacement("defender")}
              title="Click the floor to add a defender, click one again to remove him"
            >
              Defender{defenderCount ? ` (${defenderCount})` : ""}
            </button>
          </VerbRow>
        </div>

        {/* ---- contest ---- */}
        <div className="cmd-group">
          <span className="cmd-k">
            Contest{" "}
            <span className={`layer ${contestIsLive() ? "model" : "context"}`}>
              {contestIsLive() ? "model" : "adjustment"}
            </span>
          </span>
          <VerbRow>
            {[1, 2, 3.5, 5, 8].map((ft) => (
              <button
                key={ft}
                className={`verb ${contest != null && Math.abs(contest - ft) < 0.4 ? "on" : ""}`}
                title={`Slide the nearest defender to ${ft} ft on the shot line`}
                onClick={() => setNearestOnLine(ft)}
              >
                {ft}ft
              </button>
            ))}
            <button className="verb ghost" onClick={clearDefenders} title="Clear the floor">
              open
            </button>
          </VerbRow>
        </div>

        {/* ---- trays ---- */}
        <div className="cmd-group">
          <span className="cmd-k">More</span>
          <VerbRow>
            <button
              className={`verb ${openTray === "mechanics" ? "on" : ""}`}
              onClick={() => setOpenTray(openTray === "mechanics" ? "none" : "mechanics")}
            >
              Mechanics
            </button>
          </VerbRow>
        </div>

        {/* ---- fire ---- */}
        <button
          className="fire"
          onClick={() => {
            if (replayClip) usePlaybackStore.getState().close();
            triggerShot();
          }}
          disabled={pending}
          title={practiceOn
            ? "Fire the shot — the ball resolves at the model's own rate and the attempt is scored"
            : "Fire the shot — scoring is off, nothing is recorded"}
        >
          <span className="fire-main">SHOOT</span>
          <span className="fire-sub">{practiceOn ? "scored" : "sandbox"}</span>
        </button>
      </div>
    </div>
  );
}
