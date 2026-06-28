/**
 * One scenario, shared by every page that shows a Playground.
 *
 * Before this, each page held its own `useState(DEFAULT_SCENARIO)`, so moving
 * from the Shot Predictor to Compare or the Mechanics Lab silently threw away
 * whatever the user had built. The court position, the defenders, the game
 * situation and the mechanics all live here instead, and navigation is just a
 * re-render.
 *
 * Field names follow the ones the rest of the dashboard already uses
 * (`distance`, `defenderDist`, `position`) rather than inventing new ones,
 * because ShotControls, the suggestion engine, the science helpers and the API
 * converter all read those keys. Renaming them would be a large, silent-failure
 * refactor for no user-visible gain.
 *
 * The one genuinely new shape is `defenders`: an array, so the court can carry
 * up to three. `defenderDist` stays as the derived nearest distance, because
 * that is the single value the model consumes.
 */
import { createContext, useCallback, useContext, useMemo, useReducer } from "react";

import { BASKET, PX, toFeet, zoneAt } from "../components/CourtCanvas";

export const MAX_DEFENDERS = 3;

export const INITIAL_SCENARIO = {
  position: "SG",
  shotType: "pullup",
  defenderDist: 4,
  shotClock: 12,
  period: 1,
  minsLeft: 8,
  secsLeft: 30,
  scoreMargin: 0,
  dribbles: 2,
  touchTime: 2.5,
  jumpAngle: 45,
  releaseHeight: "Medium",
  handPlacement: "Two Hand",
  approachAngle: 0,
  distance: 18,
  heightInches: 75,
  experienceYears: 5,
};

const INITIAL_SHOOTER = { x: BASKET.x + 60, y: BASKET.y + 170 };

export const INITIAL_STATE = {
  scenario: INITIAL_SCENARIO,
  shooter: INITIAL_SHOOTER,
  defenders: [{ id: 1, x: BASKET.x + 40, y: BASKET.y + 140 }],
  session: [],       // one entry per simulated shot, newest last
  simKey: 0,         // bumping this fires the trajectory animation
  nextDefenderId: 2,
};

const distanceFt = (a, b) => Number((Math.hypot(a.x - b.x, a.y - b.y) / PX).toFixed(1));

/** Nearest defender in feet; 20 when the court is empty, which reads as open. */
export function nearestDefender(shooter, defenders) {
  if (!defenders?.length) return 20;
  return Math.min(...defenders.map((d) => distanceFt(d, shooter)));
}

function withDerived(state) {
  const nearest = nearestDefender(state.shooter, state.defenders);
  const dist = Number(toFeet(state.shooter.x, state.shooter.y).dist.toFixed(1));
  return {
    ...state,
    scenario: { ...state.scenario, defenderDist: nearest, distance: dist },
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_POSITION":
      return withDerived({ ...state, shooter: action.point });

    case "SET_SCENARIO": {
      // a zone patch means "put the shooter there", not just relabel
      const { zone, ...rest } = action.patch;
      const next = { ...state, scenario: { ...state.scenario, ...rest } };
      if (zone === "corner3") {
        return withDerived({ ...next, shooter: { x: BASKET.x + 22 * PX, y: BASKET.y + 4 * PX } });
      }
      return withDerived(next);
    }

    case "ADD_DEFENDER": {
      if (state.defenders.length >= MAX_DEFENDERS) return state;
      const spot = action.point ?? {
        x: Math.min(480, state.shooter.x + 40 + state.defenders.length * 26),
        y: Math.max(20, state.shooter.y - 40),
      };
      return withDerived({
        ...state,
        defenders: [...state.defenders, { id: state.nextDefenderId, ...spot }],
        nextDefenderId: state.nextDefenderId + 1,
      });
    }

    case "MOVE_DEFENDER":
      return withDerived({
        ...state,
        defenders: state.defenders.map((d) =>
          d.id === action.id ? { ...d, x: action.point.x, y: action.point.y } : d),
      });

    case "REMOVE_DEFENDER":
      return withDerived({
        ...state,
        defenders: state.defenders.filter((d) => d.id !== action.id),
      });

    case "SIMULATE":
      return { ...state, simKey: state.simKey + 1 };

    case "RECORD_SHOT": {
      const entry = {
        n: state.session.length + 1,
        zone: zoneAt(state.shooter.x, state.shooter.y),
        shotType: state.scenario.shotType,
        distance: state.scenario.distance,
        probability: action.probability,
        made: action.made,
        scenario: state.scenario,
        shooter: state.shooter,
        defenders: state.defenders,
      };
      return { ...state, session: [...state.session, entry] };
    }

    case "CLEAR_SESSION":
      return { ...state, session: [] };

    case "LOAD_SCENARIO":
      return withDerived({
        ...state,
        scenario: { ...INITIAL_SCENARIO, ...action.payload.scenario },
        shooter: action.payload.shooter ?? state.shooter,
        defenders: action.payload.defenders
          ?? (action.payload.defender ? [{ id: 1, ...action.payload.defender }] : state.defenders),
      });

    case "RESET":
      return { ...INITIAL_STATE, session: state.session };

    default:
      return state;
  }
}

const PlaygroundContext = createContext(null);

export function PlaygroundProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, withDerived);

  const actions = useMemo(() => ({
    setPosition: (point) => dispatch({ type: "SET_POSITION", point }),
    setScenario: (patch) => dispatch({ type: "SET_SCENARIO", patch }),
    addDefender: (point) => dispatch({ type: "ADD_DEFENDER", point }),
    moveDefender: (id, point) => dispatch({ type: "MOVE_DEFENDER", id, point }),
    removeDefender: (id) => dispatch({ type: "REMOVE_DEFENDER", id }),
    simulate: () => dispatch({ type: "SIMULATE" }),
    recordShot: (probability, made) => dispatch({ type: "RECORD_SHOT", probability, made }),
    clearSession: () => dispatch({ type: "CLEAR_SESSION" }),
    loadScenario: (payload) => dispatch({ type: "LOAD_SCENARIO", payload }),
    reset: () => dispatch({ type: "RESET" }),
  }), []);

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);
  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;
}

export function usePlayground() {
  const ctx = useContext(PlaygroundContext);
  if (!ctx) throw new Error("usePlayground must be used inside <PlaygroundProvider>");
  return ctx;
}

/**
 * The same reducer, but local to one component.
 *
 * Compare needs two independent scenarios side by side, which is the one place
 * the shared store is the wrong tool. Rather than fork the logic, that page
 * runs this hook twice and gets identical behaviour in isolation.
 */
export function useLocalPlayground(overrides = {}) {
  const [state, dispatch] = useReducer(
    reducer,
    { ...INITIAL_STATE, ...overrides, scenario: { ...INITIAL_SCENARIO, ...overrides.scenario } },
    withDerived,
  );
  const actions = useMemo(() => ({
    setPosition: (point) => dispatch({ type: "SET_POSITION", point }),
    setScenario: (patch) => dispatch({ type: "SET_SCENARIO", patch }),
    addDefender: (point) => dispatch({ type: "ADD_DEFENDER", point }),
    moveDefender: (id, point) => dispatch({ type: "MOVE_DEFENDER", id, point }),
    removeDefender: (id) => dispatch({ type: "REMOVE_DEFENDER", id }),
    simulate: () => dispatch({ type: "SIMULATE" }),
    recordShot: (probability, made) => dispatch({ type: "RECORD_SHOT", probability, made }),
    clearSession: () => dispatch({ type: "CLEAR_SESSION" }),
    loadScenario: (payload) => dispatch({ type: "LOAD_SCENARIO", payload }),
    reset: () => dispatch({ type: "RESET" }),
  }), []);
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

/** Canvas position -> the backend's court frame (feet, hoop at x = -41.75). */
export function courtFrame(p) {
  const { dx, dy } = toFeet(p.x, p.y);
  return { courtX: -41.75 + dy, courtZ: dx };
}

/** The full payload the prediction hook and the API converter expect. */
export function useScenarioPayload(pg) {
  const { scenario, shooter } = pg;
  return useMemo(
    () => ({ ...scenario, zone: zoneAt(shooter.x, shooter.y), ...courtFrame(shooter) }),
    [scenario, shooter],
  );
}

export const useZone = (shooter) =>
  useCallback(() => zoneAt(shooter.x, shooter.y), [shooter])();
