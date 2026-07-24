/**
 * COMPARE — save a scenario, then hold two of them next to each other.
 *
 * The spec asks for this directly and it was the last capability with a backend
 * and no interface: `/game/shots` could store and list scenarios, and nothing in
 * the client had ever called it.
 *
 * It matters more than a bookmark list. Every other panel answers "what is this
 * shot worth", which a reader can only judge against a number they are holding in
 * their head. Two saved shots side by side turn that into a comparison they can
 * actually see, and the gap between them is the thing worth knowing: an open
 * eighteen-footer against a guarded three is a decision, not two readings.
 *
 * Saved shots persist server-side, so they survive a reload and a different
 * machine, which is what makes them usable for a coach building a case rather
 * than a scratch pad.
 */
import { useCallback, useEffect, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { saveShot, listSavedShots, isAbort, type SavedShot } from "../../api";
import { TEAM } from "../../viz/palette";

const VERB_LABEL: Record<string, string> = {
  dunk: "Dunk", driving_layup: "Driving layup", layup: "Layup",
  floater: "Floater", hook: "Hook", catch_shoot: "Catch and shoot",
  pullup: "Pull-up", stepback: "Step-back", fadeaway: "Fadeaway",
};

const distOf = (s: SavedShot) => Math.hypot(s.x + 41.75, s.z);
/** Three-point value by the same rule the scenario engine uses. */
const pointsOf = (s: SavedShot) =>
  distOf(s) >= 23.75 || (Math.abs(s.z) >= 22 && s.x + 41.75 <= 14) ? 3 : 2;

export function ComparePanel() {
  const scenario = useScenarioStore((s) => s.scenario);
  const derived = useScenarioStore((s) => s.derived)();
  const prediction = useScenarioStore((s) => s.prediction);
  const setPosition = useScenarioStore((s) => s.setPosition);
  const setShotType = useScenarioStore((s) => s.setShotType);

  const [shots, setShots] = useState<SavedShot[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback((signal?: AbortSignal) => {
    listSavedShots(undefined, signal)
      .then((r) => { setShots(r); setErr(null); })
      .catch((e) => { if (!isAbort(e)) setErr("Saved shots unavailable."); });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    const name = label.trim()
      || `${VERB_LABEL[scenario.shot.shotType] ?? scenario.shot.shotType} ${derived.distance.toFixed(0)} ft`;
    try {
      await saveShot({
        x: scenario.shot.x, z: scenario.shot.z,
        shotType: scenario.shot.shotType,
        playerId: scenario.player.playerId,
        positionGroup: scenario.player.positionGroup,
        quarter: scenario.game.quarter,
        shotClock: scenario.game.shotClock,
        scoreMargin: scenario.game.scoreMargin,
        defenderDistance: derived.contest.closest ?? undefined,
        label: name,
      });
      setLabel("");
      refresh();
    } catch (e) {
      if (!isAbort(e)) setErr("That did not save.");
    }
    setBusy(false);
  };

  const toggle = (id: number) => {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      // Two at a time. A third would make "the difference" ambiguous, which is
      // the only thing this panel exists to show.
      return [...p, id].slice(-2);
    });
  };

  const a = shots.find((s) => s.id === picked[0]) ?? null;
  const b = shots.find((s) => s.id === picked[1]) ?? null;

  const load = (s: SavedShot) => {
    setPosition(s.x, s.z);
    setShotType(s.shot_type as never);
  };

  return (
    <div className="pn-body cmp">
      {/* ---- save what is on the floor -------------------------------------- */}
      <div className="cmp-save">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`${VERB_LABEL[scenario.shot.shotType] ?? scenario.shot.shotType} ${derived.distance.toFixed(0)} ft`}
          aria-label="Name for this scenario"
        />
        <button onClick={save} disabled={busy}>Save</button>
      </div>
      <div className="pn-note">
        Saves the shot on the floor, with its contest and game state, at{" "}
        {prediction ? `${Math.round(prediction.probability * 100)}%` : "the current reading"}.
      </div>

      {err && <div className="pn-note">{err}</div>}

      {/* ---- the two being held ---------------------------------------------- */}
      {a && b && (
        <div className="cmp-versus">
          {[a, b].map((s, i) => {
            const xp = s.make_prob * pointsOf(s);
            return (
              <div key={s.id} style={{ borderLeftColor: i === 0 ? TEAM.offense : TEAM.defense }}>
                <span>{s.label}</span>
                <strong>{Math.round(s.make_prob * 100)}%</strong>
                <em>{xp.toFixed(2)} pts · {distOf(s).toFixed(0)} ft</em>
              </div>
            );
          })}
        </div>
      )}
      {a && b && (
        <div className="cmp-gap">
          {(() => {
            const xa = a.make_prob * pointsOf(a);
            const xb = b.make_prob * pointsOf(b);
            const d = xa - xb;
            if (Math.abs(d) < 0.02) {
              return <>Worth the same. Take whichever is easier to get to.</>;
            }
            const better = d > 0 ? a : b;
            return (
              <>
                <b>{better.label}</b> is worth <b>{Math.abs(d).toFixed(2)}</b> more
                points per attempt.
              </>
            );
          })()}
        </div>
      )}

      {/* ---- the shelf -------------------------------------------------------- */}
      <div className="pn-label">
        Saved {shots.length > 0 && <span className="cmp-hint">pick two</span>}
      </div>
      {shots.length === 0 && <div className="pn-note">Nothing saved yet.</div>}
      <div className="cmp-list">
        {shots.map((s) => (
          <div key={s.id} className={`cmp-row ${picked.includes(s.id) ? "on" : ""}`}>
            <button className="cmp-pick" onClick={() => toggle(s.id)}>
              <span className="cmp-name">{s.label}</span>
              <b>{Math.round(s.make_prob * 100)}%</b>
            </button>
            <button className="pn-mini" onClick={() => load(s)} title="Put this back on the court">
              load
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
