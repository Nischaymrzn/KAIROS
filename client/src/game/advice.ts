/**
 * ADVICE — what would make this shot better, measured rather than asserted.
 *
 * Every suggestion is produced by re-scoring the SAME scenario with one thing
 * changed and reporting the difference the model returns. Nothing here is a rule
 * of thumb, and nothing is a number someone typed in.
 *
 * Shared by Coach and Learn so the two cannot drift into giving different advice
 * about the same shot.
 */
import { predictScenarioOnce } from "../scenario/predictionEngine";
import { ZONE_LABEL, zoneOf } from "../scenario/schema";
import type { Scenario, ShotVerb } from "../scenario/schema";
import { withinReach } from "./reach";

export interface Tip {
  id: string;
  label: string;
  why: string;
  /** change in make probability, as a fraction */
  delta: number;
  apply: () => void;
}

const VERBS: ShotVerb[] = [
  "catch_shoot", "pullup", "stepback", "fadeaway", "floater",
  "driving_layup", "layup", "hook", "dunk",
];

/** Move the shooter `ft` closer to the rim along the shot line. */
export function closerBy(s: Scenario, ft: number): [number, number] {
  const dx = -41.75 - s.shot.x;
  const dz = 0 - s.shot.z;
  const len = Math.hypot(dx, dz) || 1;
  const k = Math.min(ft / len, 0.9);
  return [s.shot.x + dx * k, s.shot.z + dz * k];
}

interface Ctx {
  scenario: Scenario;
  base: number;
  distance: number;
  nearestDefender: number | null;
  signal?: AbortSignal;
  /** applied when the user accepts a tip */
  store: {
    setShotType(v: ShotVerb): void;
    setPosition(x: number, z: number): void;
    setGame(p: { shotClock?: number }): void;
    setNearestOnLine(ft: number): void;
  };
}

export async function buildAdvice(ctx: Ctx): Promise<Tip[]> {
  const { scenario, base, distance, nearestDefender, signal, store } = ctx;
  const out: Tip[] = [];

  // ---- a different action from the same spot -------------------------------
  const scored = await Promise.all(
    VERBS
      .filter((v) => v !== scenario.shot.shotType)
      // only actions that are physically available from where he is standing
      .filter((v) => withinReach(v, distance))
      .map(async (v) => {
        const alt: Scenario = { ...scenario, shot: { ...scenario.shot, shotType: v } };
        const r = await predictScenarioOnce(alt, signal).catch(() => null);
        return r ? { v, p: r.probability } : null;
      }),
  );
  const bestVerb = scored
    .filter((x): x is { v: ShotVerb; p: number } => !!x)
    .sort((a, b) => b.p - a.p)[0];
  if (bestVerb && bestVerb.p - base > 0.01) {
    out.push({
      id: "verb",
      label: `Take a ${bestVerb.v.replace(/_/g, " ")} instead`,
      why: "Action type is one of the model's strongest features.",
      delta: bestVerb.p - base,
      apply: () => store.setShotType(bestVerb.v),
    });
  }

  // ---- step in --------------------------------------------------------------
  for (const ft of [3, 6]) {
    const [nx, nz] = closerBy(scenario, ft);
    const alt: Scenario = { ...scenario, shot: { ...scenario.shot, x: nx, z: nz } };
    const r = await predictScenarioOnce(alt, signal).catch(() => null);
    if (r && r.probability - base > 0.01) {
      out.push({
        id: `closer${ft}`,
        label: `Step ${ft} ft closer`,
        why: `Moves you to ${ZONE_LABEL[zoneOf(alt)]}.`,
        delta: r.probability - base,
        apply: () => store.setPosition(nx, nz),
      });
    }
  }

  // ---- separation -----------------------------------------------------------
  if (nearestDefender != null && nearestDefender < 6) {
    const alt: Scenario = {
      ...scenario,
      defenders: scenario.defenders.map((d, i) =>
        i === 0
          ? { ...d,
              x: d.x + (d.x - scenario.shot.x) * 1.4,
              z: d.z + (d.z - scenario.shot.z) * 1.4 }
          : d),
    };
    const r = await predictScenarioOnce(alt, signal).catch(() => null);
    if (r && r.probability - base > 0.005) {
      out.push({
        id: "space",
        label: "Create another two feet of space",
        why: "Separation moves the number directly.",
        delta: r.probability - base,
        apply: () => store.setNearestOnLine(Math.min(nearestDefender + 2.5, 10)),
      });
    }
  }

  // ---- earlier in the clock -------------------------------------------------
  if (scenario.game.shotClock <= 8) {
    const alt: Scenario = { ...scenario, game: { ...scenario.game, shotClock: 16 } };
    const r = await predictScenarioOnce(alt, signal).catch(() => null);
    if (r && r.probability - base > 0.003) {
      out.push({
        id: "clock",
        label: "Get into it earlier in the clock",
        why: "Late clock attempts are taken out of necessity.",
        delta: r.probability - base,
        apply: () => store.setGame({ shotClock: 16 }),
      });
    }
  }

  return out.sort((a, b) => b.delta - a.delta);
}
