/**
 * SCENE LAYERS — which 3D layers are mounted, derived from what is open.
 *
 * The previous rule was one exclusive mode per route, so the scene could show
 * the heat map or the defenders or the approach runner, never two. That is the
 * 3D half of the same isolation problem the dock fixes for the panels: the user
 * could not look at where the shot is hard AND at who is contesting it, because
 * those were different pages.
 *
 * Here the layer set is the UNION over open panels. Opening the heat map adds the
 * surface without removing the defenders. Closing it takes the surface away and
 * leaves everything else standing.
 *
 * Three layers are unconditional now, and that is a deliberate change rather than
 * an oversight:
 *   shooter          there is always someone taking the shot
 *   placedDefenders  defenders are core to the model under v8, not a defence-page
 *                    feature, so they are drawn everywhere
 *   arc              the trajectory is the shot
 *
 * WHAT A CLICK MAY DO IS A MODE QUESTION, NOT A PANEL QUESTION.
 * Drawing defenders and being allowed to place them were the same flag, and the
 * flag was on everywhere. Placement is a sticky global set from the command bar,
 * which only Court and Coach mount, so choosing "defender" in Court and then
 * switching to Predict left every court click dropping defenders into a scored
 * question, with no visible control to turn it off again. The capability now
 * follows the mode that owns the control.
 */
import { useDockStore, ModuleId } from "./dockStore";
import { useModeStore, type Mode } from "./modeStore";
import { usePlaybackStore } from "../state/playbackStore";

export interface SceneLayers {
  interact: boolean;
  marker: boolean;
  shooter: boolean;
  heat: boolean;
  /** the standing contest mannequin used by the arc lab, distinct from placed defenders */
  defender: boolean;
  placedDefenders: boolean;
  /** Whether a court click may drop or lift a defender. Distinct from
   *  `placedDefenders`, which only says whether they are drawn. */
  placeDefenders: boolean;
  arc: boolean;
  arcPersistent: boolean;
  /** a real tracked possession, all ten players, replayed in the arena */
  replay: boolean;
}

export function layersFor(open: ModuleId[], mode: Mode, replayLive = false): SceneLayers {
  const has = (id: ModuleId) => open.includes(id);
  return {
    // Predict deals the scenario and scores the call. A click that moved the
    // shooter would rewrite the question after it had been asked.
    interact: mode !== "predict",
    marker: true,
    shooter: !replayLive,
    placedDefenders: !replayLive,
    // Only the modes that show a placement toggle. Learn sets the defender count
    // from its own sliders and never asks for a click, so it is excluded too.
    placeDefenders: mode === "court" || mode === "coach",
    arc: !replayLive,
    heat: has("explore"),
    defender: has("physics"),
    arcPersistent: has("physics"),
    replay: replayLive,
  };
}

/** Reactive form for the Scene. */
export function useSceneLayers(): SceneLayers {
  const open = useDockStore((s) => s.open);
  const mode = useModeStore((s) => s.mode);
  const replayLive = usePlaybackStore((s) => s.clip !== null);
  return layersFor(open, mode, replayLive);
}

/** Imperative form for event handlers, which must not subscribe. */
export const getSceneLayers = () =>
  layersFor(
    useDockStore.getState().open,
    useModeStore.getState().mode,
    usePlaybackStore.getState().clip !== null,
  );
