/**
 * LEARN — every parameter in the system, in one place, with the shot explained
 * afterwards.
 *
 * The other screens each answer one question. This one is for working out how the
 * thing behaves: change anything, take the shot, read why the number came out
 * where it did, and see what would have made it better.
 *
 * Controls are grouped by DATA LAYER, and the grouping is the lesson. A control
 * that looks like it feeds the model but cannot is worse than no control at all,
 * so the two groups are labelled and kept apart:
 *
 *   MODEL    the trained model receives this and learned from it
 *   PHYSICS  changes the trajectory and the geometry, never the probability
 *
 * The physics controls are not decoration. They move the arc, the entry angle and
 * how wide the rim looks from the ball, which is real basketball and worth
 * understanding. They simply are not what the probability is computed from, and
 * saying so plainly is the point of showing them separately.
 */
import { useEffect, useMemo, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { ZONE_BASE, ZONE_LABEL } from "../../scenario/schema";
import type { HandPlacement, ReleaseHeight, ShotVerb } from "../../scenario/schema";
import { useGameStore } from "../../game/gameStore";
import { madeFor } from "../../game/outcome";
import { buildAdvice, Tip } from "../../game/advice";
import { measureSensitivity, describeSwing, SensitivityResult } from "../../game/sensitivity";

const VERBS: ShotVerb[] = [
  "dunk", "driving_layup", "layup", "floater", "hook",
  "catch_shoot", "pullup", "stepback", "fadeaway",
];
const RELEASE: ReleaseHeight[] = ["Low", "Medium", "High"];
const HANDS: HandPlacement[] = ["One Hand", "Two Hand", "Finger Roll", "Hook"];
const POSITIONS = ["G", "F", "C"];

/** Plain English for the model feature names, which are not written for readers. */
const FACTOR_TEXT: Record<string, string> = {
  "dist vs era": "how far this shot is versus what the league takes now",
  "shot distance": "distance from the rim",
  "is dunk": "whether this is a dunk",
  "is layup": "whether this is a layup",
  "is 3pt": "whether this is a three",
  "drive fg pct": "how well this shooter finishes drives",
  "pull up fg pct": "how well this shooter shoots off the dribble",
  "catch shoot fg pct": "how well this shooter shoots off the catch",
  "zone fg pct": "what this zone returns league wide",
  "defender distance": "how closely he is guarded",
  "shot clock": "time left in the possession",
  "xp": "expected points from this zone",
};
const explain = (f: string) => FACTOR_TEXT[f] ?? f.replace(/_/g, " ");

export function LearnPanel() {
  const scenario = useScenarioStore((s) => s.scenario);
  const prediction = useScenarioStore((s) => s.prediction);
  const pending = useScenarioStore((s) => s.pending);
  const derived = useScenarioStore((s) => s.derived)();
  const shootSignal = useScenarioStore((s) => s.shootSignal);
  const setShotType = useScenarioStore((s) => s.setShotType);
  const setGame = useScenarioStore((s) => s.setGame);
  const setMechanics = useScenarioStore((s) => s.setMechanics);
  const setPlayer = useScenarioStore((s) => s.setPlayer);
  const setNearestOnLine = useScenarioStore((s) => s.setNearestOnLine);
  const triggerShot = useScenarioStore((s) => s.triggerShot);
  const practiceOn = useGameStore((s) => s.practiceOn);

  const [tips, setTips] = useState<Tip[]>([]);
  const [thinking, setThinking] = useState(false);
  const [taken, setTaken] = useState(0);
  const [sens, setSens] = useState<SensitivityResult | null>(null);
  // the probability before the last edit, so the page can show what the edit did
  const [prev, setPrev] = useState<number | null>(null);

  const p = prediction?.probability ?? null;
  const m = scenario.mechanics;
  const contest = derived.contest.closest;
  const zoneRate = ZONE_BASE[derived.zone].rate;

  // The shot that was actually taken, resolved from the same roll the ball flew,
  // so the sentence under the number can never disagree with what was on screen.
  const outcome = taken > 0 && p != null ? madeFor(taken, p) : null;

  useEffect(() => {
    if (shootSignal > 0) setTaken(shootSignal);
  }, [shootSignal]);

  // Advice for the current scenario, measured by re-scoring it with one thing
  // changed rather than read off a rule of thumb.
  useEffect(() => {
    if (p == null) return;
    let dead = false;
    const ctrl = new AbortController();
    setThinking(true);
    const t = setTimeout(async () => {
      const out = await buildAdvice({
        scenario,
        base: p,
        distance: derived.distance,
        nearestDefender: contest,
        signal: ctrl.signal,
        store: useScenarioStore.getState(),
      });
      if (!dead) {
        setTips(out.slice(0, 4));
        setThinking(false);
      }
    }, 340);
    return () => {
      dead = true;
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, scenario.shot.x, scenario.shot.z, scenario.shot.shotType,
      scenario.game.shotClock, contest]);

  const factors = useMemo(() => (prediction?.factors ?? []).slice(0, 5), [prediction]);

  // Measure what each control is worth ON THIS SHOT, rather than asserting it.
  useEffect(() => {
    if (p == null) return;
    let dead = false;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const r = await measureSensitivity(scenario, ctrl.signal).catch(() => null);
      if (!dead && r) setSens(r);
    }, 420);
    return () => { dead = true; clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.shot.x, scenario.shot.z, scenario.shot.shotType, p != null]);

  // remember the previous probability so an edit can show its own effect
  useEffect(() => {
    if (p == null) return;
    setPrev((old) => (old === null ? p : old));
    const id = setTimeout(() => setPrev(p), 1400);
    return () => clearTimeout(id);
  }, [p]);

  const delta = p != null && prev != null ? (p - prev) * 100 : 0;
  const defenderCount = scenario.defenders.length;

  /** Put exactly `n` defenders on the floor, spread around the shooter. */
  const setDefenderCount = (n: number) => {
    const s = useScenarioStore.getState();
    s.clearDefenders();
    if (n === 0) return;
    // the first goes on the shot line at a normal contest, the rest fan out
    s.setNearestOnLine(3.5);
    for (let i = 1; i < n; i++) {
      const a = (i / n) * Math.PI * 1.5 + 0.7;
      const r = 5 + i * 1.4;
      s.addDefender(
        scenario.shot.x + Math.cos(a) * r,
        scenario.shot.z + Math.sin(a) * r,
        "help",
      );
    }
  };

  /** Label beside a control saying what it is worth here. */
  const swingTag = (sw: Parameters<typeof describeSwing>[0]) => {
    const d = describeSwing(sw);
    if (!d.text) return null;
    return <i className={`swing ${d.level}`}>{d.text}</i>;
  };

  return (
    <div className="learn">
      <div className="ln-now">
        <div className="ln-pct">
          {p != null ? (p * 100).toFixed(1) : "·"}
          <span>%</span>
          {Math.abs(delta) >= 0.05 && (
            <em className={delta > 0 ? "up" : "down"}>
              {delta > 0 ? "+" : ""}{delta.toFixed(1)}
            </em>
          )}
        </div>
        <div className="ln-sub">
          {ZONE_LABEL[derived.zone]} {"·"} {derived.distance.toFixed(0)} ft{" "}
          {"·"} {derived.points} pt
          <br />
          <span className={p != null && p > zoneRate ? "up" : "down"}>
            {p != null
              ? `${p > zoneRate ? "+" : ""}${Math.round((p - zoneRate) * 100)} vs this zone`
              : ""}
          </span>
        </div>
        <button className="ln-shoot" onClick={triggerShot} disabled={pending}>
          SHOOT
        </button>
      </div>

      {outcome != null && (
        <div className={`ln-outcome ${outcome ? "made" : "miss"}`}>
          {outcome ? "It went in." : "It missed."}
          {p != null && (
            <span>
              The model gave it {Math.round(p * 100)} per cent, so this happens{" "}
              {Math.round((outcome ? p : 1 - p) * 100)} times in 100.
            </span>
          )}
        </div>
      )}

      {factors.length > 0 && (
        <>
          <div className="ln-head">Why the model said that</div>
          {factors.map((f) => (
            <div key={f.feature} className="ln-factor">
              <span className={`ln-sign ${f.contribution >= 0 ? "pos" : "neg"}`}>
                {f.contribution >= 0 ? "+" : ""}
                {(f.contribution * 100).toFixed(1)}
              </span>
              <span className="ln-factor-text">{explain(f.feature)}</span>
            </div>
          ))}
          <div className="ln-note">
            These are SHAP values. Each one is how far that single fact moved this
            shot away from an average shot, in points of probability.
          </div>
        </>
      )}

      <div className="ln-head">What would improve it</div>
      {thinking && <div className="ln-wait">testing changes</div>}
      {!thinking && tips.length === 0 && (
        <div className="ln-note">Nothing obvious improves this one.</div>
      )}
      {tips.map((t) => (
        <button key={t.id} className="ln-tip" onClick={t.apply}>
          <span className="ln-gain">+{Math.round(t.delta * 100)}</span>
          <span className="ln-tip-text">
            <strong>{t.label}</strong>
            <em>{t.why}</em>
          </span>
        </button>
      ))}

      <div className="ln-head">
        Model inputs <span className="layer model">changes the number</span>
      </div>

      <div className="ln-row">
        <span>Action {swingTag(sens?.action ?? null)}</span>
        <select
          value={scenario.shot.shotType}
          onChange={(e) => setShotType(e.target.value as ShotVerb)}
        >
          {VERBS.map((v) => (
            <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      <div className="ln-row">
        <span>Position</span>
        <div className="ln-seg">
          {POSITIONS.map((g) => (
            <button
              key={g}
              className={scenario.player.positionGroup === g ? "on" : ""}
              onClick={() => setPlayer(scenario.player.playerId, g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="ln-slider">
        <span>Nearest defender {swingTag(sens?.defender ?? null)}</span>
        <input
          type="range" min={1} max={12} step={0.5}
          value={contest ?? 12}
          onChange={(e) => setNearestOnLine(Number(e.target.value))}
        />
        <strong>{contest != null ? `${contest.toFixed(1)} ft` : "open"}</strong>
      </div>

      {/* How many defenders are on the floor. The model reads only the NEAREST
          one, because that is the only contest measurement the public data has,
          so extra defenders change the picture and the tracking geometry without
          changing the probability. Saying that is better than implying five
          bodies are being priced when one is. */}
      <div className="ln-row">
        <span>Defenders on court</span>
        <div className="ln-seg">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={defenderCount === n ? "on" : ""}
              onClick={() => setDefenderCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="ln-note">
        The model prices the nearest defender only. Adding more changes the
        contest geometry the tracking study uses, not the probability above.
      </div>

      <div className="ln-slider">
        <span>Shot clock {swingTag(sens?.shotClock ?? null)}</span>
        <input
          type="range" min={1} max={24} step={1}
          value={scenario.game.shotClock}
          onChange={(e) => setGame({ shotClock: Number(e.target.value) })}
        />
        <strong>{scenario.game.shotClock}s</strong>
      </div>

      <div className="ln-slider">
        <span>Period {swingTag(sens?.period ?? null)}</span>
        <input
          type="range" min={1} max={5} step={1}
          value={scenario.game.quarter}
          onChange={(e) => setGame({ quarter: Number(e.target.value) })}
        />
        <strong>{scenario.game.quarter === 5 ? "OT" : `Q${scenario.game.quarter}`}</strong>
      </div>

      <div className="ln-slider">
        <span>Score margin {swingTag(sens?.scoreMargin ?? null)}</span>
        <input
          type="range" min={-30} max={30} step={1}
          value={scenario.game.scoreMargin}
          onChange={(e) => setGame({ scoreMargin: Number(e.target.value) })}
        />
        <strong>
          {scenario.game.scoreMargin > 0 ? "+" : ""}
          {scenario.game.scoreMargin}
        </strong>
      </div>

      <div className="ln-note">
        Where he stands is a model input too, and the strongest one. Click the
        court to move him.
      </div>

      <div className="ln-head">
        Mechanics <span className="layer physics">changes the flight</span>
      </div>

      <div className="ln-slider">
        <span>Release angle</span>
        <input
          type="range" min={30} max={70} step={1}
          value={m.jumpAngle}
          onChange={(e) => setMechanics({ jumpAngle: Number(e.target.value) })}
        />
        <strong
          style={{ color: m.jumpAngle >= 45 && m.jumpAngle <= 55 ? "#35c26e" : undefined }}
        >
          {m.jumpAngle}
          {"°"}
        </strong>
      </div>

      <div className="ln-slider">
        <span>Approach angle</span>
        <input
          type="range" min={-90} max={90} step={5}
          value={m.approachAngle}
          onChange={(e) => setMechanics({ approachAngle: Number(e.target.value) })}
        />
        <strong>
          {m.approachAngle > 0 ? "+" : ""}
          {m.approachAngle}
          {"°"}
        </strong>
      </div>

      <div className="ln-row">
        <span>Release height</span>
        <div className="ln-seg">
          {RELEASE.map((r) => (
            <button
              key={r}
              className={m.releaseHeight === r ? "on" : ""}
              onClick={() => setMechanics({ releaseHeight: r })}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="ln-row">
        <span>Hand</span>
        <div className="ln-seg wrap">
          {HANDS.map((h) => (
            <button
              key={h}
              className={m.handPlacement === h ? "on" : ""}
              onClick={() => setMechanics({ handPlacement: h })}
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      <div className="ln-note">
        These change the arc, the entry angle and how wide the rim looks from the
        ball. They do not change the probability, because the model was never given
        them. A control that pretended otherwise would be lying to you.
      </div>

      {!practiceOn && (
        <div className="ln-note">Scoring is off, so shots here are not recorded.</div>
      )}
    </div>
  );
}
