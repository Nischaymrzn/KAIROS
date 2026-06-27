/**
 * Shot Predictor — the Playground, and nothing else.
 *
 * This page used to own the scenario, the shooter, the defender and the
 * prediction wiring, and every other page reimplemented its own copy. All of
 * that now lives in the shared store and the Playground component, so what
 * remains here is a heading and one element. Training Ground is where the
 * deeper analysis sits; this page is the plain instrument.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Playground } from "../components/Playground";
import { usePlayground, INITIAL_SCENARIO } from "../state/playgroundStore";

// re-exported because the zone heatmap and saved scenarios still import it
export const DEFAULT_SCENARIO = INITIAL_SCENARIO;

export function ShotPredictor() {
  const pg = usePlayground();
  const { state } = useLocation();
  const navigate = useNavigate();

  // arriving from a heatmap zone or a saved scenario; cleared from history once
  // applied so a refresh does not silently re-apply it
  useEffect(() => {
    if (!state?.load) return;
    pg.loadScenario(state.load);
    navigate(".", { replace: true, state: null });
  }, [state, navigate, pg]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="h-title text-2xl">Shot Predictor</h1>
        <p className="text-sm text-txt-secondary">
          Click the court to place the shooter. Drag a red dot to move a defender.
          {state?.from && <span className="text-accent-teal"> Loaded from {state.from}.</span>}
        </p>
      </header>

      <Playground />
    </div>
  );
}
