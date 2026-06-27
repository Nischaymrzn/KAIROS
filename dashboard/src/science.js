/**
 * The formulas behind every derived number in the app, in one place.
 *
 * Two rules govern what lives here:
 *
 * 1. Anything shown to the user is computed, never invented.
 * 2. These curves are DESCRIPTIVE, not corrections applied to the model. The
 *    model returns its own calibrated probability; the reference curves below
 *    are drawn alongside it to explain the mechanics. Multiplying the model's
 *    output by a literature heuristic would overwrite a measured result with an
 *    assumed one, and this project measured several of these effects directly.
 *    Where its measurements disagree with the general literature, the
 *    disagreement is noted at the function rather than smoothed over.
 */

// ---------------------------------------------------------------- constants

export const BALL_DIAMETER_IN = 9.4;
export const RIM_DIAMETER_IN = 18;

/** League make rate across all shot types, the base of the SHAP waterfall. */
export const BASE_RATE = 0.462;

/** Entry angle window, degrees below horizontal. Flatter risks the front rim,
 *  steeper risks the back. */
export const ENTRY_OPTIMAL = [38, 52];

/**
 * Zone baselines. `guideFg` is the figure quoted in guide.md for 2018-19 to
 * 2022-23; `fg` is what this project actually measured over 2,524,865 shots
 * from 2014-15 to 2025-26 (reports/EDA.md). They differ most at mid-range,
 * where the guide reads 43.7% against a measured 40.6%, because the windows
 * differ and mid-range volume collapsed across those seasons. The measured
 * value is used for display; the guide value is kept so the gap is visible
 * rather than silently resolved.
 */
export const ZONE_XP = {
  restricted: { label: "Restricted Area", fg: 0.638, guideFg: 0.642, points: 2 },
  paint: { label: "Paint (non-RA)", fg: 0.423, guideFg: 0.413, points: 2 },
  midrange: { label: "Mid-Range", fg: 0.406, guideFg: 0.437, points: 2 },
  corner3: { label: "Corner Three", fg: 0.387, guideFg: 0.385, points: 3 },
  break3: { label: "Above Break 3", fg: 0.352, guideFg: 0.358, points: 3 },
};

/** xP = zone FG% × point value. The benchmark the model has to beat. */
export function expectedPoints(zoneId, fgOverride) {
  const z = ZONE_XP[zoneId] ?? ZONE_XP.midrange;
  return (fgOverride ?? z.fg) * z.points;
}

// ------------------------------------------------------------ shot features

/** Direction of travel at release, degrees. 0 is straight on, ±90 from the side. */
export function approachAngle(locX, locY) {
  return (Math.atan2(locX, Math.max(locY, 0.001)) * 180) / Math.PI;
}

/** Non-linear clock pressure. 0.042 at 24s, 0.200 at 5s, 1.000 at 1s. */
export function shotClockUrgency(shotClock) {
  return 1 / Math.max(shotClock, 0.5);
}

/** Dribbles per second of possession. High means a hurried gather. */
export function dribbleRate(dribbles, touchTime) {
  return dribbles / Math.max(touchTime, 0.1);
}

export function contestCategory(feet) {
  if (feet < 2) return { id: "heavy", label: "Heavily Contested", tone: "red" };
  if (feet < 4) return { id: "contested", label: "Contested", tone: "orange" };
  if (feet < 6) return { id: "light", label: "Lightly Contested", tone: "amber" };
  return { id: "open", label: "Open", tone: "green" };
}

/** Last five minutes and within five points. */
export function isClutch(gameClockSec, scoreMargin) {
  return gameClockSec <= 300 && Math.abs(scoreMargin) <= 5;
}

// ------------------------------------------------------------- trajectory

/**
 * Parabolic arc for the side elevation, parameterised the way guide.md
 * specifies: peak height comes from the jump angle rather than being drawn.
 *
 *   peak = distance × tan(angle) / 4
 *   y(t) = y0 + t·Δy − 4·peak·t·(1−t)
 */
export function peakHeight(distancePx, jumpAngleDeg) {
  return (distancePx * Math.tan((jumpAngleDeg * Math.PI) / 180)) / 4;
}

export function arcPoint(t, release, basket, peak) {
  return {
    x: release.x + t * (basket.x - release.x),
    y: release.y + t * (basket.y - release.y) - 4 * peak * t * (1 - t),
  };
}

/**
 * Entry angle at the rim, degrees below horizontal. Derived from the slope of
 * the parabola at t = 1, so it responds to launch angle and distance the way
 * the physical shot does.
 */
export function entryAngle(release, basket, peak) {
  const dx = basket.x - release.x;
  const dy = basket.y - release.y + 4 * peak;
  return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
}

export function entryIsOptimal(deg) {
  return deg >= ENTRY_OPTIMAL[0] && deg <= ENTRY_OPTIMAL[1];
}

/**
 * How wide the rim looks to a ball arriving at this angle. A flat ball sees an
 * ellipse, not a circle, which is the geometric reason arc matters.
 *   effective = rim × sin(entry)
 */
export function effectiveRimWidth(entryDeg) {
  return RIM_DIAMETER_IN * Math.sin((entryDeg * Math.PI) / 180);
}

/** Clearance either side of the ball once the rim is foreshortened. */
export function rimMargin(entryDeg) {
  return (effectiveRimWidth(entryDeg) - BALL_DIAMETER_IN) / 2;
}

/**
 * Approach angle narrows the target the same way, but horizontally:
 *   minor axis = rim × cos(approach)
 * At 60° the opening is 9", narrower than the ball, so a pure side approach has
 * no geometric margin at all and the shot has to use the glass.
 */
export function approachRimWidth(approachDeg) {
  return RIM_DIAMETER_IN * Math.cos((Math.abs(approachDeg) * Math.PI) / 180);
}

export function approachMargin(approachDeg) {
  return (approachRimWidth(approachDeg) - BALL_DIAMETER_IN) / 2;
}

// --------------------------------------------------- reference curves only

/**
 * Clock penalty curve: 1 − 0.15·e^(−clock/3). Roughly flat above 10 seconds,
 * dropping to a 15% penalty at zero.
 *
 * This project measured the same effect directly on complete play-by-play and
 * found it larger: make rate runs 42.9% with 0-4s left against 67.5% with
 * 20-24s. Both are shown, the measured one labelled as such.
 */
export function clockFactor(shotClock) {
  return 1 - 0.15 * Math.exp(-shotClock / 3);
}

/** Sigmoid-ish separation curve from the literature, for display only. */
const DEFENDER_TABLE = [
  [0, 0.72], [2, 0.81], [4, 0.91], [6, 0.97], [8, 1.0], [12, 1.02], [20, 1.02],
];
export function defenderFactor(feet) {
  const t = DEFENDER_TABLE;
  if (feet <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (feet <= t[i][0]) {
      const [x0, y0] = t[i - 1], [x1, y1] = t[i];
      return y0 + ((feet - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return t[t.length - 1][1];
}

/**
 * Game-state pressure multiplier from the sports-psychology literature.
 *
 * Worth reading with the project's own result next to it: score margin
 * correlates 0.0014 with whether a shot goes in, and the whole game-state
 * feature family measured −0.0001 val AUC and was dropped. Game state governs
 * shot SELECTION and volume, not whether an individual attempt falls. This
 * curve is displayed as literature context, never applied to a prediction.
 */
export function pressureFactor(margin, period) {
  const close = Math.abs(margin) <= 5;
  if (close && period >= 4) return 0.93;
  if (close) return 0.97;
  if (Math.abs(margin) > 15) return 1.02;
  return 1.0;
}

// -------------------------------------------------------- SHAP waterfall

/**
 * Turn SHAP contributions into waterfall steps starting at the base rate.
 * Whatever the listed features do not explain becomes an "Other factors" step,
 * so the bars always sum to the probability actually shown.
 */
export function shapWaterfall(shapValues, probability) {
  const shown = shapValues.slice(0, 5);
  const sum = shown.reduce((a, s) => a + s.value, 0);
  const other = probability - BASE_RATE - sum;

  let running = BASE_RATE;
  const steps = shown.map((s) => {
    const from = running;
    running += s.value;
    return { feature: s.feature, value: s.value, from, to: running };
  });

  if (Math.abs(other) > 0.001) {
    const from = running;
    running += other;
    steps.push({ feature: "Other factors", value: other, from, to: running, isOther: true });
  }
  return { base: BASE_RATE, steps, total: running };
}

// ------------------------------------------------------- contest adjustment

/**
 * Contest effect on make probability, as a multiplier on the model's output.
 *
 * This is the one place the descriptive rule at the top of this file is
 * deliberately broken, and it needs justifying. The core model is contest-blind:
 * per-shot defender distance is public only for 2014-15 and 2015-16, so those
 * columns are constant across the production window and were dropped. Sweeping
 * the defender slider therefore moves the model's output by exactly zero.
 *
 * The backend's /defend endpoint carries the 2014-15 study's contest levels and
 * is the preferred source, because it is scenario-specific and versioned with
 * the model. This table is the offline fallback only, and anything derived from
 * it is labelled as an adjustment applied after prediction, never as model
 * output. The unadjusted probability stays on screen beside it.
 *
 * A consequence worth stating: the adjusted number is no longer the calibrated
 * one. Calibration (ECE 0.0070) belongs to the raw model output.
 */
const CONTEST_CURVE = [
  [0, 0.72], [2, 0.81], [4, 0.91], [6, 0.97], [8, 1.0], [12, 1.02],
];

/** Linear interpolation across the contest table, flat outside its range. */
export function contestMultiplier(defenderFt) {
  const d = Math.max(0, defenderFt);
  if (d >= 12) return 1.02;
  for (let i = 1; i < CONTEST_CURVE.length; i++) {
    const [x0, y0] = CONTEST_CURVE[i - 1];
    const [x1, y1] = CONTEST_CURVE[i];
    if (d <= x1) return y0 + ((y1 - y0) * (d - x0)) / (x1 - x0);
  }
  return 1.02;
}

/** Clamped so an adjustment can never push a probability out of [0,1]. */
export function applyContest(probability, defenderFt) {
  return Math.max(0, Math.min(1, probability * contestMultiplier(defenderFt)));
}

/** The fallback curve as chart points, when /defend is unavailable. */
export function contestCurvePoints(baseProbability, maxFt = 20, step = 1) {
  const pts = [];
  for (let d = 0; d <= maxFt; d += step) {
    pts.push({ x: d, p: applyContest(baseProbability, d) * 100 });
  }
  return pts;
}

// ------------------------------------------------------------ shot geometry

/**
 * Entry angle at the rim, derived from the launch angle and the flight rather
 * than drawn. For a parabola whose peak sits at `peakHeight` above the chord,
 * the descent angle into the basket follows from the drop over the second half.
 */
export function entryAngleFromJump(jumpAngleDeg, distanceFt, releaseFt = 7, rimFt = 10) {
  const peak = (distanceFt * Math.tan((jumpAngleDeg * Math.PI) / 180)) / 4;
  const dropFt = peak + Math.max(0, releaseFt - rimFt) + (rimFt - releaseFt > 0 ? 0 : 0);
  const halfRun = Math.max(distanceFt / 2, 0.001);
  return (Math.atan2(Math.max(dropFt, 0.001) * 2, halfRun) * 180) / Math.PI;
}

/**
 * Murphy (1973) decomposition of the frozen v7 test-season Brier score.
 *
 * The identity UNC - RES + REL = Brier is exact only when every forecast inside
 * a bin is identical. With 20 quantile bins over real-valued forecasts it holds
 * to a discretisation residual, which is carried here rather than hidden:
 * reconstructing gives 0.2144 against a measured 0.2137. Presenting the three
 * terms as an exact sum would not survive anyone adding them up.
 *
 * The terms are the 4dp values shown on screen, so the arithmetic a reader does
 * by hand matches what is printed. At full precision the reconstruction is
 * 0.21434 and the residual 0.00068; both round to what is stored here.
 *
 * Source: reports/figures/skill_score.json, `make skill`.
 */
export const MURPHY = {
  brier: 0.2137,
  uncertainty: 0.2492,
  resolution: 0.0349,
  reliability: 0.0001,
  reconstructed: 0.2144,
  residual: 0.0007,
  bins: 20,
};
