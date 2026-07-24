/**
 * ASSISTANT — ask about the shot on the floor.
 *
 * The answers come from `game/assistant.ts`, which routes each question to the
 * trained model or the tracked corpus and reports what came back. Nothing here is
 * generated prose. Every reply carries a source tag for that reason: a reader
 * should be able to tell at a glance whether they were told a prediction or an
 * observed outcome, because those are different kinds of claim.
 *
 * The suggestion chips are not decoration either. This answers a fixed set of
 * questions, so showing that set is more honest than an open prompt that implies
 * it will take anything, and faster than making someone guess the phrasing.
 */
import { useEffect, useRef, useState } from "react";
import { useScenarioStore } from "../../scenario/scenarioStore";
import { ask, SUGGESTIONS, type Answer } from "../../game/assistant";

interface Turn {
  q: string;
  a: Answer | null;
}

export function AssistantPanel() {
  const scenario = useScenarioStore((s) => s.scenario);
  const derived = useScenarioStore((s) => s.derived)();
  const prediction = useScenarioStore((s) => s.prediction);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setText("");
    setBusy(true);
    setTurns((t) => [...t, { q, a: null }]);
    const a = await ask(q, {
      scenario,
      distance: derived.distance,
      probability: prediction?.probability ?? null,
      defenderFt: derived.contest.closest,
    });
    setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, a } : turn)));
    setBusy(false);
  };

  const last = turns[turns.length - 1]?.a;
  const chips = last?.followUps ?? SUGGESTIONS;

  return (
    <div className="pn-body as">
      {turns.length === 0 && (
        <div className="as-intro">
          I answer from the trained model and the tracked 2015-16 possessions.
          Every reply carries the number it came from.
        </div>
      )}

      <div className="as-log">
        {turns.map((t, i) => (
          <div key={i}>
            <div className="as-q">{t.q}</div>
            {t.a === null ? (
              <div className="as-a wait">checking</div>
            ) : (
              t.a.text && (
                <div className="as-a">
                  {t.a.source !== "none" && (
                    <span className={`cx-src ${t.a.source}`}>{t.a.source}</span>
                  )}
                  {t.a.text}
                </div>
              )
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="as-chips">
        {chips.slice(0, 4).map((s) => (
          <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>
        ))}
      </div>

      <form
        className="as-form"
        onSubmit={(e) => { e.preventDefault(); void send(text); }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about this shot"
          aria-label="Ask about this shot"
        />
        <button type="submit" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </div>
  );
}
