/**
 * RECORDER — the bridge from "a shot was fired" to "an attempt was scored".
 *
 * Imported for its side effect, the same pattern the film store uses: it
 * subscribes to the scenario's `shootSignal` and records one attempt per bump.
 * Doing it here rather than in a component means scoring happens wherever the
 * user shoots from — the court, a challenge, a replay — instead of only while
 * some particular panel is mounted, which is what made the previous build's
 * gamification feel like a place you had to visit.
 *
 * The outcome is resolved from the same signal ShotArc used, so the scoreboard
 * and the ball always agree.
 */
import { useScenarioStore } from "../scenario/scenarioStore";
import { ZONE_LABEL } from "../scenario/schema";
import { useGameStore } from "./gameStore";

let lastSignal = 0;

useScenarioStore.subscribe((state) => {
  const signal = state.shootSignal;
  if (signal === lastSignal || signal === 0) return;
  lastSignal = signal;

  // A shot fired before the first prediction landed has nothing to score
  // against. Skipping is correct: inventing a probability would put a number in
  // the session record that no model produced.
  const prediction = state.prediction;
  if (!prediction) return;

  const game = useGameStore.getState();
  if (!game.practiceOn) return;

  const d = useScenarioStore.getState().derived();
  game.record({
    probability: prediction.probability,
    points: d.points,
    zone: d.zone,
    zoneRate: d.zoneRate,
    verb: state.scenario.shot.shotType,
    distance: d.distance,
    defenderFt: d.contest.closest,
    shotClock: state.scenario.game.shotClock,
    x: state.scenario.shot.x,
    z: state.scenario.shot.z,
    signal,
  });
});

/** Human label for a zone id, re-exported so the HUD does not reach into schema. */
export { ZONE_LABEL };
