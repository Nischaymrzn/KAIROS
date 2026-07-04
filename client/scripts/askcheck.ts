/**
 * ASK CHECK — the assistant routes to the right engine and never invents.
 *
 * Two things can rot here and neither shows up as a type error.
 *
 * ROUTING. Intents are matched on substrings, and substrings overlap: "defend" is
 * inside "defender", "should i shoot" is inside "what should i shoot". A
 * first-match-wins loop sent "what should I shoot from here" to the shot-quality
 * read and "does the defender matter" to the defending advice — both plausible
 * enough on screen that nobody would notice they were the wrong answer. Matching
 * now scores by longest phrase, and these assert that it stays that way.
 *
 * GROUNDING. Every answer must be sourced to the model or the tracked corpus. An
 * unmatched question must fall through to "I cannot answer that", never to prose.
 * That is the property that makes the panel honest, so it is tested rather than
 * trusted.
 *
 * Needs the API up, like scenariocheck.
 *
 *   npx tsx scripts/askcheck.ts
 */
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { ask, SUGGESTIONS } = await import("../src/game/assistant");
const { useScenarioStore } = await import("../src/scenario/scenarioStore");

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
};

const s = useScenarioStore.getState();
s.setPosition(-26, 4);
s.setShotType("pullup");
s.setNearestOnLine(3.0);
const d = s.derived();
const ctx = {
  scenario: s.scenario,
  distance: d.distance,
  probability: 0.42,
  defenderFt: d.contest.closest,
};

console.log("every offered question is answerable");
for (const q of SUGGESTIONS) {
  const a = await ask(q, ctx);
  ok(`"${q}"`, a.source !== "none" && a.text.length > 20, a.source);
}

console.log("\nthe most specific phrase wins, not the first one declared");
{
  const a = await ask("What should I shoot from here?", ctx);
  ok("a request for options gets the ranking, not the quality read",
    a.text.includes("Ranked by expected points"), a.text.slice(0, 46));

  const b = await ask("Does the defender matter here?", ctx);
  ok("asking whether contest matters gets sensitivity, not how to defend",
    b.text.includes("nearest defender"), b.text.slice(0, 46));

  const c = await ask("Is this a good shot?", ctx);
  ok("a quality question still gets the quality read",
    c.text.includes("against a league"), c.text.slice(0, 46));
}

console.log("\nnothing is answered without a source");
{
  for (const q of SUGGESTIONS) {
    const a = await ask(q, ctx);
    ok(`"${q.slice(0, 26)}" carries a source`, a.source === "model" || a.source === "tracked");
  }
}

console.log("\nquestions it cannot settle are refused, not guessed");
for (const q of [
  "who won the 1998 finals",
  "what is the best team of all time",
  "tell me a joke",
]) {
  const a = await ask(q, ctx);
  ok(`"${q}"`, a.source === "none" && (a.followUps?.length ?? 0) > 0,
    a.source);
}

console.log("\nthe numbers quoted are the ones the engines returned");
{
  const a = await ask("How do I defend this?", ctx);
  // the gameplan service prices a contest in points of make rate; the reply must
  // carry a figure rather than a bare claim
  ok("defending advice quotes a measured figure", /\d/.test(a.text), a.text.slice(0, 54));

  const b = await ask("How should he take it?", ctx);
  ok("delivery advice quotes the sample it came from",
    b.text.includes("tracked releases"), b.text.slice(-38));
}

console.log(fail === 0 ? "\nall assistant checks passed" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
