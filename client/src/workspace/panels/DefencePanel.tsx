/**
 * DEFENCE — place bodies on the floor and score the shot from where they stand.
 *
 * Two models read the same defenders and they read different things, which is the
 * whole point of this panel:
 *
 *   PRODUCTION (v8)  takes the NEAREST defender's distance and nothing else,
 *                    because per-shot defender distance is the only contest
 *                    measurement the public record carries.
 *   TRACKING (study) takes the real geometry from the 2015-16 SportVU season:
 *                    nearest distance, second distance, and the ANGLE off the
 *                    shot line. It is trained on one season, so it is weaker
 *                    overall (AUC 0.643) but it can see things the production
 *                    model cannot.
 *
 * Measured on the study model at a 24 ft three:
 *
 *   nearest distance  1 ft to 10 ft   0.3483 to 0.3855   3.7 points
 *   angle off line    0 deg to 90 deg 0.3235 to 0.3559   3.2 points
 *   help defenders    0 to 3          no change at all
 *
 * The angle is the interesting one and the reason placing bodies beats a slider.
 * A defender three feet away IN the shot line costs about three points more than
 * the same defender three feet away to the side, and no distance-only control can
 * express that. Help count is shown as measured null rather than quietly dropped.
 */
import { useEffect, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { useDefenseStore } from "../../state/defenseStore";
import { predictTracking, type TrackingPrediction } from "../../api";
import { contestIsLive } from "../../scenario/schema";

const ROLE_LABEL: Record<string, string> = {
  primary: "on ball",
  help: "help",
  trailing: "trailing",
};

export function DefencePanel() {
  const scenario = useScenarioStore((s) => s.scenario);
  const prediction = useScenarioStore((s) => s.prediction);
  const derived = useScenarioStore((s) => s.derived)();
  const removeDefender = useScenarioStore((s) => s.removeDefender);
  const clearDefenders = useScenarioStore((s) => s.clearDefenders);
  const setNearestOnLine = useScenarioStore((s) => s.setNearestOnLine);

  const placement = useDefenseStore((s) => s.placement);
  const setPlacement = useDefenseStore((s) => s.setPlacement);

  const [track, setTrack] = useState<TrackingPrediction | null>(null);
  const [trackErr, setTrackErr] = useState(false);

  const c = derived.contest;
  const modelP = prediction?.probability ?? null;
  const { x, z } = scenario.shot;

  // Score the placed geometry with the study model. Debounced, because dragging a
  // defender would otherwise fire a request per pixel.
  useEffect(() => {
    if (c.closest == null) {
      setTrack(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      predictTracking(
        {
          shot_distance: derived.distance,
          is_3: derived.points === 3 ? 1 : 0,
          pre_def_dist: c.closest ?? undefined,
          pre_def_dist_2: c.second ?? undefined,
          pre_def_angle: c.angle ?? undefined,
          pre_help_defenders: c.helpers,
          shot_clock: scenario.game.shotClock,
          player_id: scenario.player.playerId || undefined,
        },
        ctrl.signal,
      )
        .then((r) => { setTrack(r); setTrackErr(false); })
        .catch(() => setTrackErr(true));
    }, 260);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [c.closest, c.second, c.angle, c.helpers, derived.distance, derived.points,
      scenario.game.shotClock, scenario.player.playerId]);

  const ranked = [...scenario.defenders]
    .map((d) => ({ d, dist: Math.hypot(d.x - x, d.z - z) }))
    .sort((a, b) => a.dist - b.dist);

  return (
    <div className="pn-body">
      <div className="pn-label">Click adds</div>
      <div className="an-pills">
        <button
          className={`an-pill ${placement === "shooter" ? "active" : ""}`}
          onClick={() => setPlacement("shooter")}
        >
          Shooter
        </button>
        <button
          className={`an-pill ${placement === "defender" ? "active" : ""}`}
          onClick={() => setPlacement("defender")}
        >
          Defender
        </button>
      </div>
      <div className="pn-note">
        Up to five. Click one to remove.
      </div>

      {ranked.length === 0 ? (
        <div className="pn-empty">
          No defenders. Put one on the floor and both models below will score the
          shot from where he actually stands.
        </div>
      ) : (
        <>
          <div className="pn-label">
            On court: {ranked.length}
            <button className="pn-mini" style={{ marginLeft: 8 }} onClick={clearDefenders}>
              clear
            </button>
          </div>
          {ranked.map(({ d, dist }, i) => (
            <div key={d.id} className={`dp-row ${i === 0 ? "nearest" : ""}`}>
              <span className="dp-dot" style={{ background: i === 0 ? "#eb5757" : "#7c93ff" }} />
              <span className="dp-name">D{i + 1}</span>
              <span className="dp-dist">{dist.toFixed(1)} ft</span>
              <span className="dp-role">{ROLE_LABEL[d.role] ?? d.role}</span>
              <button className="an-x" onClick={() => removeDefender(d.id)} aria-label="Remove">
                ×
              </button>
            </div>
          ))}

          <div className="pn-grid">
            <div>
              <span>Nearest</span>
              <strong>{c.closest?.toFixed(1)} ft</strong>
            </div>
            <div>
              <span>Angle off line</span>
              <strong>{(c.angle ?? 0).toFixed(0)}°</strong>
            </div>
            <div>
              <span>Second</span>
              <strong>{c.second != null ? `${c.second.toFixed(1)} ft` : "·"}</strong>
            </div>
            <div>
              <span>Help</span>
              <strong>{c.helpers}</strong>
            </div>
          </div>
          <div className="pn-note">
            Angle runs shooter to rim. Zero is standing in the shot.
          </div>

          <div className="pn-label" style={{ marginTop: 8 }}>Two models, same defenders</div>
          <div className="dp-models">
            <div>
              <span>Production v8</span>
              <strong>{modelP != null ? `${(modelP * 100).toFixed(1)}%` : "·"}</strong>
              <em>{contestIsLive() ? "nearest distance only" : "contest blind"}</em>
            </div>
            <div className="study">
              <span>Tracking study</span>
              <strong>
                {trackErr ? "·" : track ? `${(track.probability * 100).toFixed(1)}%` : "…"}
              </strong>
              <em>distance, second, angle</em>
            </div>
          </div>

          {track && (
            <div className="pn-note">
              The study model is trained on one season, so it is weaker overall
              {typeof track.test_auc === "number" && ` (AUC ${(track.test_auc as number).toFixed(3)})`}
              {typeof track.tracking_gain_auc === "number" &&
                `, but real tracking is worth ${(track.tracking_gain_auc as number).toFixed(4)} AUC over the same model without it`}
              . Where a defender stands is something the production model cannot
              see at all.
            </div>
          )}

          <div className="pn-label" style={{ marginTop: 8 }}>Slide the nearest to</div>
          <div className="an-pills">
            {[1, 2, 3.5, 5, 8].map((ft) => (
              <button key={ft} className="an-pill" onClick={() => setNearestOnLine(ft)}>
                {ft} ft
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
