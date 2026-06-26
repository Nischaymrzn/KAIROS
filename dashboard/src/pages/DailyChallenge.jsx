import { useEffect, useMemo, useState } from "react";
import { CourtCanvas, BASKET, PX } from "../components/CourtCanvas";
import { StreakCounter } from "../components/StreakCounter";
import { Leaderboard } from "../components/Leaderboard";
import { useStreak } from "../hooks/useStreak";
import { getDailyChallenge } from "../api";
import { ALL_SHOT_TYPES, ZONES } from "../mockData";

/** Court frame (feet, hoop at -41.75) back to canvas pixels. */
function toCanvas(c) {
  return { x: BASKET.x + (c.z ?? 0) * PX, y: BASKET.y + ((c.x ?? -41.75) + 41.75) * PX };
}

export function DailyChallenge() {
  const [ch, setCh] = useState(null);
  const [guess, setGuess] = useState(null);
  const [simKey, setSimKey] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const streak = useStreak();

  useEffect(() => {
    let alive = true;
    getDailyChallenge().then((c) => alive && setCh(c));
    return () => { alive = false; };
  }, []);

  const shooter = useMemo(() => (ch ? toCanvas(ch) : { x: 0, y: 0 }), [ch]);
  const defender = useMemo(
    () => (ch ? { x: shooter.x + (ch.defender_distance ?? 4) * PX * 0.7, y: shooter.y - 10 } : { x: 0, y: 0 }),
    [ch, shooter]
  );

  if (!ch) return <div className="card text-sm text-txt-muted">Loading challenge…</div>;

  const actual = ch.probability >= 0.5 ? "MAKE" : "MISS";
  const already = streak.answered(ch.id);
  const shotLabel = ALL_SHOT_TYPES.find((t) => t.id === ch.shot_type)?.label ?? ch.shot_type;

  const answer = (g) => {
    if (already || revealed) return;
    setGuess(g);
    setSimKey((k) => k + 1);
    streak.record(ch, g, actual);
    setTimeout(() => setRevealed(true), 1200);
  };

  const right = guess === actual;

  return (
    <div>
      <header className="mb-6">
        <h1 className="h-title text-2xl">Daily Challenge</h1>
        <p className="text-sm text-txt-secondary">
          {ch.description ? `${ch.description}. ` : ""}
          Read the situation and call it before the model does. {ch.live ? "" : "Offline scenario."}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 mb-6">
        <div className="card flex flex-col items-center gap-4">
          <CourtCanvas
            shooter={shooter}
            defender={defender}
            probability={ch.probability}
            jumpAngle={48}
            simulateKey={simKey}
            made={actual === "MAKE"}
          />
          {!revealed && !already && (
            <div className="flex gap-3 w-full max-w-[500px]">
              <button
                className="btn flex-1 !h-12 !text-base border-accent-green text-accent-green hover:bg-accent-green/10"
                onClick={() => answer("MAKE")}
              >
                MAKE
              </button>
              <button
                className="btn flex-1 !h-12 !text-base border-accent-red text-accent-red hover:bg-accent-red/10"
                onClick={() => answer("MISS")}
              >
                MISS
              </button>
            </div>
          )}
          {(revealed || already) && (
            <div
              className={`w-full max-w-[500px] rounded-lg border p-4 text-center ${
                already && !guess
                  ? "border-line bg-bg-tertiary"
                  : right
                  ? "border-accent-green bg-accent-green/10"
                  : "border-accent-red bg-accent-red/10"
              }`}
            >
              <div className="stat text-3xl">{(ch.probability * 100).toFixed(1)}%</div>
              <div className="text-sm text-txt-secondary mt-1">
                The model says {actual}.{" "}
                {already && !guess
                  ? "Already played today."
                  : right
                  ? "You called it."
                  : "Not this time."}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="label mb-3">The situation</div>
          <dl className="space-y-3 text-sm">
            {[
              ["Shot type", shotLabel],
              ["Zone", ZONES[ch.zone]?.label ?? "—"],
              ["Defender", `${ch.defender_distance} ft`],
              ["Shot clock", `${ch.shot_clock} s`],
              ["Period", ch.period === 5 ? "OT" : `Q${ch.period}`],
              ["Score margin", ch.score_margin > 0 ? `+${ch.score_margin}` : ch.score_margin],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-line/50 pb-2">
                <dt className="text-txt-muted">{k}</dt>
                <dd className="stat">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-txt-muted mt-4 leading-relaxed">
            The league makes about 47% of all attempts, so anything near 50% is genuinely a coin flip.
            Calling those wrong is not a bad read.
          </p>
        </div>
      </div>

      <StreakCounter streak={streak.streak} best={streak.best} total={streak.total} accuracy={streak.accuracy} />

      <div className="card mt-6">
        <div className="label mb-3">Best streaks</div>
        <Leaderboard runs={streak.leaderboard} />
      </div>

      <div className="card mt-6">
        <div className="flex justify-between items-center mb-3">
          <div className="label">Recent challenges</div>
          {streak.total > 0 && (
            <button className="btn !py-1 !px-3 text-xs" onClick={streak.reset}>Reset</button>
          )}
        </div>
        {streak.history.length === 0 ? (
          <p className="text-sm text-txt-muted">Nothing played yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {streak.history.map((h) => (
              <li key={h.id + h.at} className="flex justify-between items-center border-b border-line/50 pb-2">
                <span className="text-txt-secondary">{h.id}</span>
                <span className="text-txt-muted">you said {h.guess}</span>
                <span className="stat">{(h.probability * 100).toFixed(1)}%</span>
                <span className={h.right ? "text-accent-green" : "text-accent-red"}>
                  {h.right ? "correct" : "wrong"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
