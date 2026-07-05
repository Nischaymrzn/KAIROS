/**
 * RENDER CHECK — do the workspace panels actually mount?
 *
 * TypeScript proves the shapes line up. It does not prove that a component
 * renders: a bad hook order, a selector that returns a new object every call and
 * loops, a null dereference on first paint — all of those typecheck and then
 * throw on screen. This renders every panel to a string in Node and fails on any
 * of it.
 *
 * The 3D scene is deliberately out of scope; it needs a WebGL context. What is
 * covered is the entire 2D interface, which is where the panels live.
 *
 * WHAT THIS CHECK CANNOT TELL YOU
 * zustand v5 hands React `getInitialState()` as the server snapshot
 * (node_modules/zustand/react.js, line 11), so under `renderToString` every
 * store selector returns the state as it was at store construction no matter
 * what has been written since. Panels therefore always render their empty
 * branch here. That is an artefact of server rendering, not a bug: the app mounts
 * with `createRoot`, which reads `getState()` and sees live data.
 *
 * So this file proves the panels MOUNT — no bad hook order, no null dereference
 * on first paint, no selector that loops. It does not prove they display the
 * right numbers. The section at the bottom asserts that directly against the
 * store, without React, because it is the part that actually matters and the
 * rendering harness cannot reach it.
 *
 *   npx tsx scripts/rendercheck.tsx
 */
import React from "react";
import { renderToString } from "react-dom/server";

// localStorage is read at store-construction time for the saved career and the
// saved dock layout. Node has none, so give it one before anything imports.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { PredictGame } = await import("../src/workspace/panels/PredictGame");
const { CoachPanel } = await import("../src/workspace/panels/CoachPanel");
const { LearnPanel } = await import("../src/workspace/panels/LearnPanel");
const { GamePlanPanel } = await import("../src/workspace/panels/GamePlanPanel");
const { PlayStudyPanel } = await import("../src/workspace/panels/PlayStudyPanel");
const { PlaybookPanel } = await import("../src/workspace/panels/PlaybookPanel");
const { AssistantPanel } = await import("../src/workspace/panels/AssistantPanel");
const { ShotChartPanel } = await import("../src/workspace/panels/ShotChartPanel");
const { ComparePanel } = await import("../src/workspace/panels/ComparePanel");
const { ArcLabPanel } = await import("../src/workspace/panels/ArcLabPanel");
const { SideTabs } = await import("../src/workspace/SideTabs");
const { TopBar } = await import("../src/workspace/TopBar");
const { Dock } = await import("../src/workspace/Dock");
const { ModuleRail } = await import("../src/workspace/ModuleRail");
const { CommandBar } = await import("../src/workspace/CommandBar");
const { useGameStore } = await import("../src/game/gameStore");
const { useScenarioStore } = await import("../src/scenario/scenarioStore");
const { MODULES } = await import("../src/workspace/modules");

let fail = 0;
const ok = (name: string, fn: () => string) => {
  try {
    const html = fn();
    if (!html.length) throw new Error("rendered nothing");
    console.log(`  ok    ${name}   ${html.length} chars`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}   ${(e as Error).message}`);
  }
};

console.log("workspace panels mount");
ok("TopBar", () => renderToString(<TopBar />));
ok("PredictGame", () => renderToString(<PredictGame />));
ok("CoachPanel", () => renderToString(<CoachPanel />));
ok("LearnPanel", () => renderToString(<LearnPanel />));
ok("GamePlanPanel", () => renderToString(<GamePlanPanel />));
ok("PlayStudyPanel", () => renderToString(<PlayStudyPanel />));
ok("PlaybookPanel", () => renderToString(<PlaybookPanel />));
ok("AssistantPanel", () => renderToString(<AssistantPanel />));
ok("ShotChartPanel", () => renderToString(<ShotChartPanel />));
ok("ComparePanel", () => renderToString(<ComparePanel />));
ok("ArcLabPanel", () => renderToString(<ArcLabPanel />));
ok("SideTabs", () => renderToString(
  <SideTabs tabs={[{ id: "a", label: "A", render: () => <CoachPanel /> }]} />));
ok("ModuleRail", () => renderToString(<ModuleRail />));
ok("CommandBar", () => renderToString(<CommandBar />));
ok("Dock (default layout)", () => renderToString(<Dock />));

console.log("\npanels mount again with a populated session");
{
  const s = useScenarioStore.getState();
  const g = useGameStore.getState();
  // a realistic spread: different zones, verbs, contests and outcomes
  const spread = [
    { p: 0.71, pts: 2, zone: "restricted", rate: 0.638, verb: "driving_layup", d: 22, def: 1.4 },
    { p: 0.36, pts: 3, zone: "break3", rate: 0.352, verb: "catch_shoot", d: 26, def: 6.1 },
    { p: 0.44, pts: 2, zone: "midrange", rate: 0.406, verb: "pullup", d: 18, def: 2.7 },
    { p: 0.39, pts: 3, zone: "corner3", rate: 0.387, verb: "catch_shoot", d: 22, def: 4.0 },
    { p: 0.52, pts: 2, zone: "paint", rate: 0.423, verb: "floater", d: 9, def: 3.3 },
  ];
  spread.forEach((r, i) =>
    g.record({
      probability: r.p, points: r.pts, zone: r.zone, zoneRate: r.rate,
      verb: r.verb, distance: r.d, defenderFt: r.def, shotClock: 12 - i,
      x: -26 + i, z: i * 2, signal: i + 1,
    }),
  );
  console.log(`  seeded ${useGameStore.getState().session.length} attempts, ` +
    `${useGameStore.getState().session.filter((x) => x.made).length} made`);

  s.addDefender(-24, 3);
  ok("PredictGame (with a session)", () => renderToString(<PredictGame />));
  ok("CoachPanel (with a scenario)", () => renderToString(<CoachPanel />));
  ok("LearnPanel (with a scenario)", () => renderToString(<LearnPanel />));
  ok("CommandBar (defender placed)", () => renderToString(<CommandBar />));
}

console.log("\nevery registered module renders its own panel");
for (const m of MODULES) {
  ok(m.id, () => renderToString(<>{m.render()}</>));
}

// ---------------------------------------------------------------------------
// The numbers the panels put on screen, asserted against the store directly.
// This is the half the rendering harness cannot see, for the reason in the
// header comment.
console.log("\nthe values those panels display are correct");
{
  const assert = (name: string, cond: boolean, detail = "") => {
    if (!cond) fail++;
    console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  };

  const g = useGameStore.getState();
  const s = g.sessionStats();
  const session = g.session;

  assert("session holds every recorded attempt", s.attempts === session.length,
    `${s.attempts}`);
  assert("makes match the recorded outcomes",
    s.makes === session.filter((r) => r.made).length, `${s.makes} of ${s.attempts}`);
  assert("field-goal percentage is makes over attempts",
    Math.abs(s.fgPct - s.makes / s.attempts) < 1e-9, `${(s.fgPct * 100).toFixed(1)}%`);

  const expected = session.reduce((t, r) => t + r.probability * r.points, 0);
  assert("expected points sum the per-shot expectations",
    Math.abs(s.expectedPoints - expected) < 1e-9, s.expectedPoints.toFixed(3));

  const actual = session.reduce((t, r) => t + (r.made ? r.points : 0), 0);
  assert("actual points count only makes",
    s.actualPoints === actual, `${s.actualPoints}`);
  assert("luck is actual minus expected",
    Math.abs(s.luck - (actual - expected)) < 1e-9, s.luck.toFixed(3));

  assert("every attempt carries the zone it was taken from",
    session.every((r) => r.zone.length > 0));
  assert("every attempt carries a decision score",
    session.every((r) => Number.isFinite(r.decision)));
  assert("career totals moved with the session",
    g.lifetimeAttempts >= s.attempts, `${g.lifetimeAttempts} career`);
  assert("the first badge was earned", g.badges.includes("first-look"),
    g.badges.join(", ") || "none");
}

console.log(fail === 0 ? "\nall render checks passed" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
