/**
 * PREDICT — the game. You call it, then you find out.
 *
 * A scenario is set up on the court. You say whether it goes in. The shot is then
 * taken, and you are shown what the model thought and what the ball did.
 *
 * The scoring is the interesting part, and it is deliberately not "were you
 * right". Guessing IN on every shot is right about half the time, which would
 * make a coin competitive with a person who understands the game. What is scored
 * is whether you were on the correct side of the MODEL: called a make on a shot
 * worth taking, or a miss on one that was not. That rewards reading the
 * situation, and it is a question a coin cannot answer better than chance.
 *
 * The outcome is still shown, and it still disagrees with the call often enough
 * to be the whole lesson: a 62 per cent shot missing does not mean you read it
 * wrong.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { ZONE_BASE, ZONE_LABEL } from "../../scenario/schema";
import type { ShotVerb } from "../../scenario/schema";
import { useGameStore } from "../../game/gameStore";
import { madeFor } from "../../game/outcome";
import { levelFor } from "../../game/progression";
import { dailyChallenges } from "../../game/challenges";
import { usePlayersStore } from "../../state/playersStore";

/**
 * Spots worth asking about — a spread of difficulty, not a random scatter.
 *
 * Clock, period and margin vary too. They used to be fixed, which meant the
 * situation rows on the card said the same thing every round and the only things
 * a reader could actually weigh were distance and the defender. A guessing game
 * has to move every input it shows, or showing them teaches the wrong lesson.
 */
const SETUPS: {
  x: number; z: number; verb: ShotVerb; def: number | null;
  clock: number; quarter: number; margin: number;
}[] = [
  { x: -39.5, z: 1.5, verb: "driving_layup", def: 2, clock: 14, quarter: 1, margin: 0 },
  { x: -38, z: 22.5, verb: "catch_shoot", def: 6, clock: 18, quarter: 2, margin: 6 },
  { x: -26, z: 8, verb: "pullup", def: 2, clock: 4, quarter: 4, margin: -2 },
  { x: -18, z: 0, verb: "catch_shoot", def: 5, clock: 11, quarter: 3, margin: 9 },
  { x: -30, z: -12, verb: "fadeaway", def: 1.5, clock: 2, quarter: 4, margin: -1 },
  { x: -22, z: 16, verb: "stepback", def: 3, clock: 7, quarter: 2, margin: 3 },
  { x: -36, z: 5, verb: "floater", def: 3, clock: 16, quarter: 1, margin: -5 },
  { x: -40.5, z: 0.5, verb: "dunk", def: 4, clock: 20, quarter: 3, margin: 12 },
  { x: -14, z: -6, verb: "pullup", def: 7, clock: 9, quarter: 2, margin: -8 },
  { x: -33, z: -18, verb: "catch_shoot", def: 2, clock: 5, quarter: 4, margin: 1 },
];

const VERB_LABEL: Record<string, string> = {
  dunk: "Dunk", driving_layup: "Driving layup", layup: "Layup",
  floater: "Floater", hook: "Hook", catch_shoot: "Catch and shoot",
  pullup: "Pull-up", stepback: "Step-back", fadeaway: "Fadeaway",
};

type Phase = "calling" | "revealed";

export function PredictGame() {
  const [phase, setPhase] = useState<Phase>("calling");
  // One objective, not three. The spec asks for daily challenges and they belong
  // here with the rest of the game, but a panel of them beside a court is the
  // wall of text this screen exists to avoid.
  const today = useMemo(() => dailyChallenges()[0], []);
  const [call, setCall] = useState<"in" | "out" | null>(null);
  const [round, setRound] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [asked, setAsked] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);

  const prediction = useScenarioStore((s) => s.prediction);
  const pending = useScenarioStore((s) => s.pending);
  const derived = useScenarioStore((s) => s.derived)();
  const scenario = useScenarioStore((s) => s.scenario);
  const shooter = usePlayersStore((s) => s.active);
  const zoneRate = ZONE_BASE[derived.zone].rate;
  const defCount = scenario.defenders.length;
  const shootSignal = useScenarioStore((s) => s.shootSignal);
  const xp = useGameStore((s) => s.xp);
  const session = useGameStore((s) => s.session);
  const lv = levelFor(xp);

  /** Load the round's scenario onto the court. */
  const deal = useCallback((n: number) => {
    const s = SETUPS[n % SETUPS.length];
    const st = useScenarioStore.getState();
    st.setShotType(s.verb);
    st.setPosition(s.x, s.z);
    if (s.def == null) st.clearDefenders();
    else st.setNearestOnLine(s.def);
    st.setGame({ shotClock: s.clock, quarter: s.quarter, scoreMargin: s.margin });
    setPhase("calling");
    setCall(null);
  }, []);

  useEffect(() => { deal(0); }, [deal]);

  const p = prediction?.probability ?? null;

  const answer = (choice: "in" | "out") => {
    if (phase !== "calling" || p == null) return;
    setCall(choice);
    setPhase("revealed");
    // right = on the correct side of the model, not "did the ball fall"
    const modelSays: "in" | "out" = p >= 0.5 ? "in" : "out";
    const right = choice === modelSays;
    setAsked((a) => a + 1);
    if (right) {
      setCorrect((c) => c + 1);
      setStreak((s) => { const n = s + 1; setBest((b) => Math.max(b, n)); return n; });
    } else {
      setStreak(0);
    }
    useScenarioStore.getState().triggerShot();
  };

  const next = () => { const n = round + 1; setRound(n); deal(n); };

  const made = phase === "revealed" && p != null ? madeFor(shootSignal, p) : null;
  const modelSays = p == null ? null : p >= 0.5 ? "in" : "out";
  const right = call != null && call === modelSays;

  return (
    <div className="pg">
      <div className="pg-head">
        <div>
          <span className="pg-k">Round</span>
          <strong>{round + 1}</strong>
        </div>
        <div>
          <span className="pg-k">Read</span>
          <strong>{asked ? Math.round((correct / asked) * 100) : 0}<em>%</em></strong>
        </div>
        <div>
          <span className="pg-k">Streak</span>
          <strong>{streak}{best > 0 && <em> / {best}</em>}</strong>
        </div>
        <div>
          <span className="pg-k">Level</span>
          <strong>{lv.level}</strong>
        </div>
      </div>
      <div className="pg-xp"><div style={{ width: `${(lv.into / lv.span) * 100}%` }} /></div>

      {today && (() => {
        const pr = today.progress(session);
        return (
          <div className="pg-daily" title={today.brief}>
            <span className="pg-daily-name">{today.name}</span>
            <span className="pg-daily-bar">
              <i style={{ width: `${Math.min(100, (pr.done / pr.target) * 100)}%` }} />
            </span>
            <span className="pg-daily-count">{Math.min(pr.done, pr.target)}/{pr.target}</span>
          </div>
        );
      })()}

      {/* Every input the model is given, because the game asks the reader to
          out-think the model and it cannot be done blind. The zone rate is the
          load-bearing one: without knowing that an average shot from here goes in
          40% of the time, "does it go in" has nothing to be judged against. */}
      <div className="pg-card">
        <div className="pg-card-row">
          <span>Action</span>
          <b>{VERB_LABEL[scenario.shot.shotType] ?? scenario.shot.shotType}</b>
        </div>
        <div className="pg-card-row">
          <span>Spot</span>
          <b>{ZONE_LABEL[derived.zone]} · {derived.distance.toFixed(0)} ft · {derived.points} pt</b>
        </div>
        <div className="pg-card-row key">
          <span>League here</span>
          <b>{Math.round(zoneRate * 100)}% · {(zoneRate * derived.points).toFixed(2)} pts</b>
        </div>
        <div className="pg-card-row">
          <span>Defender</span>
          <b>
            {derived.contest.closest != null
              ? `${derived.contest.closest.toFixed(1)} ft`
              : "open floor"}
            {defCount > 0 && <em> · {defCount} on floor</em>}
          </b>
        </div>
        {derived.contest.angle != null && (
          <div className="pg-card-row">
            <span>Angle</span>
            <b>{Math.round(derived.contest.angle)}° off the shot line</b>
          </div>
        )}
        <div className="pg-card-row">
          <span>Clock</span>
          <b>{scenario.game.shotClock}s · Q{scenario.game.quarter}</b>
        </div>
        <div className="pg-card-row">
          <span>Margin</span>
          <b>{scenario.game.scoreMargin > 0 ? "+" : ""}{scenario.game.scoreMargin}</b>
        </div>
        <div className="pg-card-row">
          <span>Shooter</span>
          <b>
            {shooter?.name ?? "Generic"}
            <em> · {shooter?.position ?? scenario.player.positionGroup}</em>
          </b>
        </div>
      </div>

      {phase === "calling" ? (
        <>
          <div className="pg-ask">Does it go in?</div>
          <div className="pg-buttons">
            <button className="pg-btn in" disabled={pending || p == null} onClick={() => answer("in")}>
              IN
            </button>
            <button className="pg-btn out" disabled={pending || p == null} onClick={() => answer("out")}>
              OUT
            </button>
          </div>
          {pending && <div className="pg-wait">reading the shot</div>}
        </>
      ) : (
        <>
          <div className={`pg-verdict ${right ? "good" : "bad"}`}>
            {right ? "Good read" : "Misread"}
          </div>
          <div className="pg-reveal">
            <div>
              <span className="pg-k">Model</span>
              <strong>{p != null ? `${Math.round(p * 100)}%` : "·"}</strong>
            </div>
            <div>
              <span className="pg-k">You said</span>
              <strong>{call === "in" ? "IN" : "OUT"}</strong>
            </div>
            <div>
              <span className="pg-k">Ball</span>
              <strong className={made ? "made" : "miss"}>{made ? "IN" : "OUT"}</strong>
            </div>
          </div>
          {made !== (modelSays === "in") && (
            <div className="pg-note">
              The ball disagreed with the odds. On a shot like this that happens {p != null
                ? Math.round((p >= 0.5 ? 1 - p : p) * 100)
                : 0} per cent of the time. It does not mean the read was wrong.
            </div>
          )}
          <button className="pg-next" onClick={next}>Next shot</button>
        </>
      )}
    </div>
  );
}
