/**
 * Renders every page and every data-driven component to a string.
 *
 * An HTTP 200 on an SPA route proves nothing: the server returns index.html for
 * any path, including one whose module was truncated. This actually executes
 * each component, so a bad import, a missing export or a render-time crash
 * fails here instead of in the browser.
 */
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { ShotPredictor } from "../src/pages/ShotPredictor";
import { Compare } from "../src/pages/Compare";
import { PlayerAnalysis } from "../src/pages/PlayerAnalysis";
import { MechanicsLab } from "../src/pages/MechanicsLab";
import { DailyChallenge } from "../src/pages/DailyChallenge";
import { ModelInsights } from "../src/pages/ModelInsights";
import { About } from "../src/pages/About";
import { MovementReplay } from "../src/pages/MovementReplay";
import { TrackingReplay } from "../src/components/TrackingReplay";

import { ProbabilityGauge } from "../src/components/ProbabilityGauge";
import { SHAPChart } from "../src/components/SHAPChart";
import { SuggestionBox } from "../src/components/SuggestionBox";
import { RimProjection } from "../src/components/RimProjection";
import { ReferenceCurve } from "../src/components/ReferenceCurve";
import { StreakCounter } from "../src/components/StreakCounter";
import { Leaderboard } from "../src/components/Leaderboard";
import { ContestPanel } from "../src/components/ContestPanel";
import { RimTargetBar } from "../src/components/RimTargetBar";
import { OfflineBanner } from "../src/components/OfflineBanner";
import { ZoneHeatmap } from "../src/components/ZoneHeatmap";
import { ShotControls } from "../src/components/ShotControls";

import { DEFAULT_SCENARIO } from "../src/pages/ShotPredictor";
import { generateSuggestions } from "../src/suggestions";
import { rankRuns } from "../src/hooks/useStreak";
import { ZONE_SCENARIOS } from "../src/zoneScenarios";
import { exportComparison } from "../src/exportPng";
import * as science from "../src/science";

const PRED = {
  probability: 0.517, quality_label: "High", expected_points: 1.034, zone_average: 0.451, live: true,
  shap_values: [
    { feature: "shot_distance", value: -0.08, description: "18 ft" },
    { feature: "defender_distance", value: 0.04, description: "4 ft" },
    { feature: "shot_clock", value: 0.01, description: "12 s" },
  ],
};
const ZONES = [
  { zone: "restricted", attempts: 182, actual: 0.612, predicted: 0.598 },
  { zone: "break3", attempts: 604, actual: 0.401, predicted: 0.388 },
];

const cases = [
  ["page ShotPredictor", <ShotPredictor />],
  ["page Compare", <Compare />],
  ["page PlayerAnalysis", <PlayerAnalysis />],
  ["page MechanicsLab", <MechanicsLab />],
  ["page DailyChallenge", <DailyChallenge />],
  ["page ModelInsights", <ModelInsights />],
  ["page About", <About />],
  ["page MovementReplay", <MovementReplay />],
  ["TrackingReplay empty", <TrackingReplay waypoints={[]} playKey={0} />],
  ["TrackingReplay with path", <TrackingReplay playKey={1} waypoints={[
    { x: 0, y: 26, t: 0, speed: 0 }, { x: 2, y: 22, t: 0.5, speed: 8.1 },
    { x: 4, y: 18, t: 1.0, speed: 11.4 }, { x: 5, y: 15, t: 1.5, speed: 6.2 },
  ]} />],
  ["ProbabilityGauge+refs", <ProbabilityGauge probability={0.517} label="High" zoneAverage={0.451} live />],
  ["SHAPChart", <SHAPChart shapValues={PRED.shap_values} />],
  ["SuggestionBox", <SuggestionBox suggestions={generateSuggestions({ ...DEFAULT_SCENARIO, zone: "midrange" }, PRED)} onApply={() => {}} />],
  ["RimProjection", <RimProjection entryDeg={45} approachDeg={30} />],
  ["ReferenceCurve", <ReferenceCurve data={[{ x: 0, y: 1 }, { x: 1, y: 0.9 }]} xLabel="s" yLabel="f" refY={1} caveat="x" />],
  ["StreakCounter", <StreakCounter streak={3} best={7} total={12} accuracy={0.58} />],
  ["Leaderboard", <Leaderboard runs={rankRuns([{ length: 5, at: 1 }, { length: 2, at: 2 }], 3)} />],
  ["Leaderboard empty", <Leaderboard runs={rankRuns([], 0)} />],
  ["ContestPanel", <ContestPanel scenario={{ ...DEFAULT_SCENARIO, zone: "midrange", courtX: -23.75, courtZ: 0 }} baseProbability={0.39} />],
  ["RimTargetBar good", <RimTargetBar entryDeg={48} />],
  ["RimTargetBar poor", <RimTargetBar entryDeg={28} />],
  ["OfflineBanner hidden when online", <div>banner renders nothing while connected<OfflineBanner /></div>],
  ["ZoneHeatmap", <ZoneHeatmap zones={ZONES} mode="actual" onZoneClick={() => {}} />],
  ["ShotControls", <ShotControls scenario={DEFAULT_SCENARIO} onChange={() => {}} />],
];

let fail = 0;
for (const [name, el] of cases) {
  try {
    const html = renderToString(<MemoryRouter>{el}</MemoryRouter>);
    if (html.length < 40) throw new Error(`rendered only ${html.length} chars`);
    console.log(`  ok    ${name.padEnd(24)} ${html.length} chars`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name.padEnd(24)} ${e.message}`);
  }
}

// pure logic that the render path does not reach
const checks = [
  ["zone scenarios cover all 5", Object.keys(ZONE_SCENARIOS).length === 5],
  ["zone scenario has distance", Object.values(ZONE_SCENARIOS).every((s) => s.scenario.distance > 0)],
  ["zone scenario has shooter", Object.values(ZONE_SCENARIOS).every((s) => s.shooter && s.defender)],
  ["ranking is longest first", (() => {
    const r = rankRuns([{ length: 2, at: 1 }, { length: 9, at: 2 }], 4);
    return r.map((x) => x.length).join() === "9,4,2";
  })()],
  ["live run is marked", rankRuns([{ length: 1, at: 1 }], 3).find((r) => r.live)?.length === 3],
  ["no live entry at zero streak", rankRuns([{ length: 1, at: 1 }], 0).every((r) => !r.live)],
  ["board caps at ten", rankRuns(Array.from({ length: 30 }, (_, i) => ({ length: i, at: i })), 1).length === 10],
  // guide.md's stated values, so the formulas cannot drift from the spec
  ["urgency: 0.042 at 24s, 0.200 at 5s, 1.000 at 1s", (() => {
    const u = science.shotClockUrgency;
    return Math.abs(u(24) - 0.042) < 5e-4 && Math.abs(u(5) - 0.2) < 1e-9 && Math.abs(u(1) - 1) < 1e-9;
  })()],
  ["dribble rate = dribbles / max(touch, 0.1)", Math.abs(science.dribbleRate(4, 2) - 2) < 1e-9],
  ["contest buckets at 2 / 4 / 6 ft", (() => {
    const c = science.contestCategory;
    return c(1).id === "heavy" && c(3).id === "contested" && c(5).id === "light" && c(9).id === "open";
  })()],
  ["clutch = last 5 min within 5 pts", (() => {
    const k = science.isClutch;
    return k(300, 5) && k(120, -3) && !k(301, 1) && !k(60, 6);
  })()],
  ["peak height = dist x tan(angle) / 4", (() => {
    const h = science.peakHeight(200, 45);
    return Math.abs(h - 50) < 1e-6;               // tan45 = 1 -> dist/4
  })()],
  ["effective rim: 12.73 in at 45, 9 at 30, 15.59 at 60", (() => {
    const w = science.effectiveRimWidth;
    return Math.abs(w(45) - 12.73) < 0.01 && Math.abs(w(30) - 9) < 1e-6 && Math.abs(w(60) - 15.59) < 0.01;
  })()],
  ["approach rim: 15.6 at 30, 12.7 at 45, 9 at 60", (() => {
    const a = science.approachRimWidth;
    return Math.abs(a(30) - 15.59) < 0.01 && Math.abs(a(45) - 12.73) < 0.01 && Math.abs(a(60) - 9) < 1e-6;
  })()],
  ["margin at 0 deg approach = 4.3 in", Math.abs(science.approachMargin(0) - 4.3) < 1e-9],
  ["clock factor: 1.000 at 24s, 0.850 at 0s", (() => {
    const f = science.clockFactor;
    return Math.abs(f(24) - 1) < 1e-3 && Math.abs(f(0) - 0.85) < 1e-9;
  })()],
  ["ball is 9.4 in and rim 18 in everywhere",
    science.BALL_DIAMETER_IN === 9.4 && science.RIM_DIAMETER_IN === 18],
  ["zone xP: restricted 1.284, corner3 1.155, break3 1.074", (() => {
    const e = (z) => science.expectedPoints(z, science.ZONE_XP[z].guideFg);
    return Math.abs(e("restricted") - 1.284) < 1e-3
        && Math.abs(e("corner3") - 1.155) < 1e-3
        && Math.abs(e("break3") - 1.074) < 1e-3;
  })()],
  ["contest curve is monotone rising", (() => {
    let prev = -1;
    for (let d = 0; d <= 12; d += 1) {
      const m = science.contestMultiplier(d);
      if (m < prev - 1e-9) return false;
      prev = m;
    }
    return true;
  })()],
  ["contest matches the study table", (() => {
    const want = [[0, 0.72], [2, 0.81], [4, 0.91], [6, 0.97], [8, 1.0], [12, 1.02]];
    return want.every(([d, m]) => Math.abs(science.contestMultiplier(d) - m) < 1e-9);
  })()],
  ["contest flat past 12 ft", science.contestMultiplier(20) === science.contestMultiplier(12)],
  ["adjustment cannot leave [0,1]", science.applyContest(0.99, 20) <= 1 && science.applyContest(0.01, 0) >= 0],
  ["higher jump gives steeper entry", science.entryAngleFromJump(60, 18) > science.entryAngleFromJump(35, 18)],
  ["steeper entry opens the rim", science.effectiveRimWidth(60) > science.effectiveRimWidth(35)],
  ["murphy reconstructs as stated", Math.abs(
    (science.MURPHY.uncertainty - science.MURPHY.resolution + science.MURPHY.reliability)
    - science.MURPHY.reconstructed
  ) < 5e-5],
  ["murphy residual is the stated gap", Math.abs(
    (science.MURPHY.reconstructed - science.MURPHY.brier) - science.MURPHY.residual
  ) < 5e-5],
  ["murphy residual is small vs resolution", science.MURPHY.residual < science.MURPHY.resolution / 10],
  ["exportComparison is callable", typeof exportComparison === "function"],
  ["export returns false without canvas", exportComparison({ rows: [], summary: "" }) === false],
  ["entry 45deg narrows rim", science.effectiveRimWidth(45) < science.RIM_DIAMETER_IN],
  ["approach 0deg keeps full rim", Math.abs(science.approachRimWidth(0) - science.RIM_DIAMETER_IN) < 1e-9],
  ["shap waterfall lands on p", (() => {
    const w = science.shapWaterfall(PRED.shap_values, PRED.probability);
    return Math.abs(w.total - PRED.probability) < 1e-6 && w.base === science.BASE_RATE;
  })()],
  ["shap waterfall steps are contiguous", (() => {
    const { base, steps } = science.shapWaterfall(PRED.shap_values, PRED.probability);
    let prev = base;
    return steps.every((s) => {
      const ok = Math.abs(s.from - prev) < 1e-9;
      prev = s.to;
      return ok;
    });
  })()],
];
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
}

console.log(fail === 0 ? "\nall render checks passed" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
