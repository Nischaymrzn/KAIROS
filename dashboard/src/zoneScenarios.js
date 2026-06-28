import { BASKET, PX } from "./components/CourtCanvas";

/**
 * A representative shot for each zone, used when a zone on the heatmap is
 * opened in the predictor.
 *
 * Positions are chosen so `zoneAt` classifies them back into the same zone, and
 * the rest of the context is the typical attempt from there: layups are close
 * and contested off two dribbles, corner threes are catch-and-shoot with more
 * separation because the pass creates it.
 */
const at = (dxFt, dyFt) => ({ x: BASKET.x + dxFt * PX, y: BASKET.y + dyFt * PX });
const dist = (dxFt, dyFt) => Number(Math.hypot(dxFt, dyFt).toFixed(1));

function make(dxFt, dyFt, over) {
  return {
    shooter: at(dxFt, dyFt),
    defender: at(dxFt * 0.72, dyFt * 0.72),
    scenario: {
      position: "SG",
      period: 1,
      scoreMargin: 0,
      jumpAngle: 48,
      releaseHeight: "Medium",
      handPlacement: "Two Hand",
      approachAngle: 0,
      distance: dist(dxFt, dyFt),
      ...over,
    },
  };
}

export const ZONE_SCENARIOS = {
  restricted: make(0, 2.5, {
    shotType: "driving_layup", defenderDist: 2.5, shotClock: 10, dribbles: 3, touchTime: 3.5,
    handPlacement: "One Hand", jumpAngle: 62,
  }),
  paint: make(3, 7, {
    shotType: "floater", defenderDist: 3.5, shotClock: 9, dribbles: 3, touchTime: 3.2, jumpAngle: 58,
  }),
  midrange: make(11, 11.5, {
    shotType: "pullup", defenderDist: 4, shotClock: 8, dribbles: 2, touchTime: 2.6,
  }),
  corner3: make(22, 4, {
    shotType: "catch_shoot", defenderDist: 5.5, shotClock: 12, dribbles: 0, touchTime: 0.8, jumpAngle: 46,
  }),
  break3: make(15, 20.6, {
    shotType: "catch_shoot", defenderDist: 5, shotClock: 11, dribbles: 1, touchTime: 1.4, jumpAngle: 46,
  }),
};
