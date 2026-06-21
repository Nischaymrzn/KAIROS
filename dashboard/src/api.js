/**
 * API layer. Every call falls back to mock data so the UI always renders.
 *
 * The backend is the existing HoopIQ FastAPI service. It speaks court
 * coordinates (feet, hoop at x = -41.75, z lateral), so `toCourt` converts the
 * dashboard's canvas-space scenario into that frame. Keeping the conversion here
 * means the rest of the app never needs to know the backend's geometry.
 */
import { MOCK_PREDICTION, MODEL_STATS, MOCK_PLAYER, MOCK_CHALLENGE, FEATURE_IMPORTANCE, ZONES } from "./mockData";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const TIMEOUT = 6000;

/**
 * Every call falls back to mock data so the UI always renders. That is useful
 * for demos and dangerous for verification: a wrong URL once left the Daily
 * Challenge showing a fixed 41.2% for weeks without anything looking broken.
 * So a fallback is now broadcast, and the shell shows a banner while any part
 * of the app is offline.
 */
const listeners = new Set();
let offline = false;

export function onConnectionChange(fn) {
  listeners.add(fn);
  fn(offline);
  return () => listeners.delete(fn);
}

function setOffline(v) {
  if (offline === v) return;
  offline = v;
  listeners.forEach((fn) => fn(offline));
}

export const isOffline = () => offline;

async function call(path, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    setOffline(false);
    return json;
  } catch (e) {
    setOffline(true);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Backend action verbs, keyed by the dashboard's shot type ids. */
const VERB = {
  driving_layup: "driving_layup", running_layup: "driving_layup", finger_roll: "driving_layup",
  putback: "layup", reverse_layup: "layup", tip_in: "layup",
  catch_shoot: "catch_shoot", pullup: "pullup", stepback: "stepback",
  midrange: "pullup", corner3: "catch_shoot", above_break3: "catch_shoot",
  fadeaway: "fadeaway", floater: "floater", runner: "floater",
  hook: "hook", bank: "driving_layup", dunk: "dunk",
};

/** Dashboard scenario -> the backend's court frame. */
function toCourt(s) {
  return {
    x: s.courtX ?? -41.75 + s.distance,
    z: s.courtZ ?? 0,
    shotType: VERB[s.shotType] ?? "pullup",
    // Without this the movement endpoint can never return a player's own tracked
    // approaches, and player-level features never reach the shot model either.
    playerId: s.playerId ?? 0,
    positionGroup: s.position === "C" ? "C" : s.position === "PF" || s.position === "SF" ? "F" : "G",
    quarter: s.period,
    // The model reads the game clock, and it moves the answer. Leaving these out
    // silently accepted the backend's 8:30 default for every scenario.
    minsLeft: s.minsLeft ?? 8,
    secsLeft: s.secsLeft ?? 30,
    defenderDistance: s.defenderDist,
    shotClock: s.shotClock,
    scoreMargin: s.scoreMargin,
  };
}

function label(p) {
  if (p >= 0.6) return "Elite";
  if (p >= 0.5) return "High";
  if (p >= 0.4) return "Average";
  if (p >= 0.3) return "Low";
  return "Poor";
}

export async function predictShot(scenario) {
  const zone = ZONES[scenario.zone] ?? ZONES.midrange;
  try {
    const r = await call("/predict/court", { method: "POST", body: toCourt(scenario) });
    const p = r.probability;
    return {
      probability: p,
      quality_label: label(p),
      zone_average: zone.rate,
      expected_points: p * zone.points,
      shap_values: (r.factors ?? []).slice(0, 5).map((f) => ({
        feature: f.feature.replace(/\b\w/g, (c) => c.toUpperCase()),
        value: f.contribution,
        direction: f.contribution >= 0 ? "positive" : "negative",
      })),
      live: true,
    };
  } catch {
    const p = MOCK_PREDICTION.probability;
    return { ...MOCK_PREDICTION, quality_label: label(p), zone_average: zone.rate, expected_points: p * zone.points, live: false };
  }
}

export async function getModelInfo() {
  try {
    const r = await call("/model-info");
    return {
      ...MODEL_STATS,
      version: r.version,
      model: r.model,
      test_auc: r.test_metrics.auc,
      test_brier: r.test_metrics.brier,
      accuracy: r.test_metrics.accuracy,
      base_rate: r.test_metrics.base_rate,
      baseline_auc: r.baseline_test.auc,
      shots_tested: r.test_metrics.n,
      live: true,
    };
  } catch {
    return { ...MODEL_STATS, live: false };
  }
}

export async function getPlayers() {
  try {
    const r = await call("/players");
    return { players: r.players ?? [], live: true };
  } catch {
    return { players: [], live: false };
  }
}

/**
 * Zones grouped by the tracking rate that actually describes them.
 *
 * The API publishes per-player FG% and frequency for drives, catch-and-shoot
 * and pull-ups — real measurements, not estimates. It does not publish per-zone
 * splits. Rather than invent them, each zone borrows the tracking family that
 * dominates it: drives at the rim, pull-ups from mid-range, catch-and-shoot from
 * three. The mapping is shown in the UI so it is not mistaken for a zone split.
 */
const ZONE_TRACKING = {
  restricted: { fg: "drive_fg_pct", rate: "drives_pg", via: "drives" },
  paint: { fg: "drive_fg_pct", rate: "paint_touches", via: "drives / paint touches" },
  midrange: { fg: "pull_up_fg_pct", rate: "pull_up_rate", via: "pull-ups" },
  corner3: { fg: "catch_shoot_fg_pct", rate: "catch_shoot_rate", via: "catch-and-shoot" },
  break3: { fg: "catch_shoot_fg_pct", rate: "catch_shoot_rate", via: "catch-and-shoot" },
};

/** Representative court spot per zone, backend frame. Mirrors ZONE_SPOT above. */
const ZONE_PREDICT_SPOT = {
  restricted: { x: -39.25, z: 0 },
  paint: { x: -34.75, z: 3 },
  midrange: { x: -30.25, z: 8 },
  corner3: { x: -38.75, z: -22 },
  break3: { x: -17.75, z: 6 },
};

/**
 * A real player profile: identity and tracking measurements from /players/{id},
 * and predicted zone quality from the model itself, one call per zone with this
 * player's position group. Nothing on this page is mock when the API is up.
 */
export async function getPlayerProfile(name) {
  try {
    const { players } = await getPlayers();
    const q = String(name).toLowerCase();
    const hit = players.find((p) => p.name?.toLowerCase().includes(q));
    if (!hit) throw new Error("not found");

    const full = await call(`/players/${hit.id}`);
    const prof = full.profile ?? hit.profile ?? {};
    const imputed = new Set(full.imputed ?? hit.imputed ?? []);
    const pos = full.position ?? hit.position ?? "G";

    const zones = await Promise.all(
      Object.entries(ZONE_TRACKING).map(async ([zone, map]) => {
        const spot = ZONE_PREDICT_SPOT[zone];
        let predicted = null;
        try {
          const r = await call("/predict/court", {
            method: "POST",
            body: {
              ...spot,
              shotType: zone === "restricted" ? "driving_layup" : zone === "midrange" ? "pullup" : "catch_shoot",
              playerId: hit.id,
              positionGroup: pos,
              quarter: 1,
              defenderDistance: 4,
              shotClock: 12,
              scoreMargin: 0,
            },
          });
          predicted = r.probability;
        } catch { /* one zone failing must not blank the page */ }

        return {
          zone,
          actual: prof[map.fg] ?? null,
          attempts: prof[map.rate] ?? null,
          predicted,
          via: map.via,
          estimated: imputed.has(map.fg),
        };
      })
    );

    return {
      id: hit.id,
      name: full.name ?? hit.name,
      position: pos,
      height_in: prof.height_in ?? null,
      weight_lb: prof.weight_lb ?? null,
      experience: prof.experience_yrs ?? null,
      wingspan_in: prof.wingspan_in ?? null,
      max_vertical_in: prof.max_vertical_in ?? null,
      avg_speed: prof.avg_speed ?? null,
      touches: prof.touches ?? null,
      drive_fg_pct: prof.drive_fg_pct ?? null,
      catch_shoot_fg_pct: prof.catch_shoot_fg_pct ?? null,
      pull_up_fg_pct: prof.pull_up_fg_pct ?? null,
      drives_pg: prof.drives_pg ?? null,
      catch_shoot_rate: prof.catch_shoot_rate ?? null,
      pull_up_rate: prof.pull_up_rate ?? null,
      paint_touches: prof.paint_touches ?? null,
      imputed: [...imputed],
      bio_source: full.bio_source ?? hit.bio_source ?? null,
      zones,
      live: true,
    };
  } catch {
    return { ...MOCK_PLAYER, live: false };
  }
}

export async function getFeatureImportance() {
  return { features: FEATURE_IMPORTANCE, live: false };
}

/** Backend zone labels -> the dashboard's zone keys. */
const ZONE_KEY = {
  "Restricted Area": "restricted",
  "In The Paint (Non-RA)": "paint",
  "Mid-Range": "midrange",
  "Left Corner 3": "corner3",
  "Right Corner 3": "corner3",
  "Above the Break 3": "break3",
};

/** A representative spot in each zone, in the backend's court frame. */
const ZONE_SPOT = {
  restricted: { x: -39.25, z: 0 },
  paint: { x: -34.75, z: 3 },
  midrange: { x: -30.25, z: 8 },
  corner3: { x: -38.75, z: -22 },
  break3: { x: -17.75, z: 6 },
};

/** Stable small integer from the day, so the challenge is identical on reload. */
function daySeed(day) {
  let h = 0;
  for (const c of String(day)) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return h;
}

/**
 * The backend's daily challenge is a prompt: a shot type, a zone and a target.
 * It carries no court position or game state, so the rest of the situation is
 * derived from the date (identical for everyone, identical on reload) and the
 * probability comes from the real model rather than the stored target, which is
 * a bar to beat rather than a prediction.
 */
export async function getDailyChallenge() {
  try {
    const r = await call("/game/challenge/daily");
    const zone = ZONE_KEY[r.zone] ?? "midrange";
    const spot = ZONE_SPOT[zone];
    const s = daySeed(r.day);

    const scenario = {
      x: spot.x,
      z: spot.z,
      shotType: VERB[r.shot_type] ?? "pullup",
      positionGroup: "G",
      quarter: (s % 4) + 1,
      defenderDistance: 2 + (s % 9) * 0.5,
      shotClock: 3 + (s % 19),
      scoreMargin: (s % 15) - 7,
    };
    const pred = await call("/predict/court", { method: "POST", body: scenario });

    return {
      id: r.day,
      day: r.day,
      description: r.description,
      target_prob: r.target_prob,
      shot_type: r.shot_type,
      zone,
      x: spot.x,
      z: spot.z,
      defender_distance: scenario.defenderDistance,
      shot_clock: scenario.shotClock,
      period: scenario.quarter,
      score_margin: scenario.scoreMargin,
      probability: pred.probability,
      live: true,
    };
  } catch {
    return { ...MOCK_CHALLENGE, live: false };
  }
}

/**
 * Contest sweep from the 2014-15 defender study, served by /defend.
 *
 * This is the honest source for the defender slider. The core model is
 * contest-blind, so sweeping /predict/court over defender distance returns a
 * flat line; /defend carries the study that actually measured the effect and
 * reports its own provenance in `source`.
 */
export async function getContestCurve(scenario) {
  try {
    const r = await call("/defend", { method: "POST", body: toCourt(scenario) });
    return {
      baseline: r.baseline?.probability ?? null,
      levels: (r.levels ?? []).map((l) => ({
        contest: l.contest,
        ft: l.defender_distance,
        p: l.probability,
        quality: l.quality,
      })),
      swing: r.contest_swing ?? null,
      shotClass: r.shot_class ?? null,
      source: r.source ?? "2014-15 tracking study",
      live: true,
    };
  } catch {
    return { baseline: null, levels: [], swing: null, source: "offline fallback curve", live: false };
  }
}

/** Every shot type from this spot, ranked by expected points (/rank). */
export async function getRankedShots(scenario) {
  try {
    const r = await call("/rank", { method: "POST", body: toCourt(scenario) });
    return { ranked: r.ranked ?? [], live: true };
  } catch {
    return { ranked: [], live: false };
  }
}

/** Court-wide probability grid for one shot type (/explore). */
export async function getExploreGrid(shotType, { maxDist = 30, step = 2 } = {}) {
  try {
    const r = await call("/explore", {
      method: "POST",
      body: { shotType: VERB[shotType] ?? "catch_shoot", positionGroup: "G", maxDist, step },
    });
    return { shotType: r.shot_type, cells: r.cells ?? [], live: true };
  } catch {
    return { shotType, cells: [], live: false };
  }
}

/** One player's full profile, including the tracking summaries (/players/{id}). */
export async function getPlayerById(id) {
  try {
    const r = await call(`/players/${id}`);
    return { ...r, live: true };
  } catch {
    return { live: false };
  }
}

/**
 * What the model predicts for this player across shot types.
 *
 * One /predict/court call per type at a representative spot for that type, with
 * the player's id and position group. Replaces the previous approach of scaling
 * league rates by the player's overall FG%, which produced a plausible ordering
 * out of arithmetic rather than out of the model.
 */
const TYPE_SPOTS = {
  driving_layup: { x: -39.25, z: 0 }, running_layup: { x: -38.75, z: 2 },
  finger_roll: { x: -39.0, z: 1 }, putback: { x: -40.0, z: 0 },
  reverse_layup: { x: -39.5, z: -1 }, tip_in: { x: -40.5, z: 0 },
  dunk: { x: -40.75, z: 0 }, floater: { x: -34.75, z: 3 },
  runner: { x: -34.0, z: 4 }, hook: { x: -35.5, z: 4 },
  bank: { x: -33.0, z: 8 }, fadeaway: { x: -29.75, z: 8 },
  pullup: { x: -30.25, z: 8 }, stepback: { x: -28.0, z: 9 },
  midrange: { x: -30.25, z: 8 }, catch_shoot: { x: -17.75, z: 6 },
  corner3: { x: -38.75, z: -22 }, above_break3: { x: -17.75, z: 6 },
};

export async function getShotTypeBreakdown(player, types) {
  const pos = player?.position ?? "G";
  const rows = await Promise.all(
    types.map(async (t) => {
      const spot = TYPE_SPOTS[t.id] ?? TYPE_SPOTS.pullup;
      try {
        const r = await call("/predict/court", {
          method: "POST",
          body: {
            ...spot, shotType: VERB[t.id] ?? "pullup", playerId: player?.id ?? 0,
            positionGroup: pos, quarter: 1, defenderDistance: 4, shotClock: 12, scoreMargin: 0,
          },
        });
        return { name: t.label, predicted: r.probability, league: t.rate, live: true };
      } catch {
        return { name: t.label, predicted: null, league: t.rate, live: false };
      }
    })
  );
  return rows.filter((r) => r.predicted != null).sort((a, b) => b.predicted - a.predicted);
}

/**
 * The approach path into a shot, from the 2015-16 SportVU corpus.
 *
 * With a playerId that has a tracked signature this returns that player's OWN
 * real approaches, retrieved from the contest tier `defenderDist` falls in;
 * otherwise the league sequence model answers and `fallback_reason` says why.
 */
export async function getMovePath(scenario) {
  try {
    const r = await call("/predict/move", { method: "POST", body: toCourt(scenario) });
    return {
      waypoints: r.waypoints ?? [],
      method: r.method ?? null,
      moveType: r.move_type ?? null,
      playerId: r.player_id ?? null,
      nSequences: r.n_sequences ?? null,
      pressure: r.pressure ?? null,
      pressureRequested: r.pressure_requested ?? null,
      fallbackReason: r.fallback_reason ?? null,
      live: true,
    };
  } catch {
    return { waypoints: [], method: null, live: false };
  }
}

/** Players with a tracked movement signature (2015-16 SportVU). */
export async function getMovementPlayers() {
  try {
    const r = await call("/movement/players");
    return { players: r.players ?? [], pressureNames: r.pressure_names ?? [], live: true };
  } catch {
    return { players: [], pressureNames: [], live: false };
  }
}
