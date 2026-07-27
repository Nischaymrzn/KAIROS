/**
 * WORKSPACE — one court, three jobs.
 *
 * The scene is mounted once and never unmounts. What changes with the mode is
 * only what sits over it:
 *
 *   court    the command bar, a compact result, and analysis panels ON REQUEST
 *   predict  the calling game
 *   coach    every control, and measured advice on what to change
 *
 * The scenario is shared by all three, so a shot set up on the court is the shot
 * the coach talks about and the shot the game asks you to call.
 */
import { useEffect, useState } from "react";
import { Scene } from "../scene/Scene";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { PredictionPanel } from "../app/PredictionPanel";
import { ShooterChip } from "../app/ShooterChip";

import { TopBar } from "./TopBar";
import { ModuleRail } from "./ModuleRail";
import { CommandBar } from "./CommandBar";
import { Dock } from "./Dock";
import { useDockStore } from "./dockStore";
import { useModeStore } from "./modeStore";
import { MODULE_BY_ID } from "./modules";
import { PredictGame } from "./panels/PredictGame";
import { CoachPanel } from "./panels/CoachPanel";
import { PlayStudyPanel } from "./panels/PlayStudyPanel";
import { PlaybookPanel } from "./panels/PlaybookPanel";
import { AssistantPanel } from "./panels/AssistantPanel";
import { usePlaybackStore } from "../state/playbackStore";
import { getReplay } from "../api";
import { SideTabs } from "./SideTabs";
import { LearnPanel } from "./panels/LearnPanel";
import { bootScenario, useScenarioStore } from "../scenario/scenarioStore";
import { cameraStore } from "../scene/cameraStore";

import "../game/recorder"; // side effect: every fired shot becomes a scored attempt

export default function Workspace() {
  const focus = useDockStore((s) => s.focus);
  const mode = useModeStore((s) => s.mode);
  // Which side tab is open, so a tab that owns the court can clear it.
  const [sideTab, setSideTab] = useState("");

  useEffect(() => bootScenario(), []);

  // DEV ONLY: ?shot=<verb> fires a shot on load and ?open=<ids> forces panels
  // open. A WebGL canvas cannot be clicked from a headless screenshot run, so
  // without these the 3D is the one part of the app that can never be inspected
  // outside a human session. Stripped from production by the DEV guard.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const q = new URLSearchParams(window.location.search);
    const m = q.get("mode");
    if (m === "predict" || m === "coach" || m === "court" || m === "learn") useModeStore.getState().setMode(m);
    const open = q.get("open");
    if (open) {
      const dock = useDockStore.getState();
      for (const id of open.split(",")) dock.openModule(id.trim() as never);
    }
    // ?play=<gameId>:<eventId> drops a tracked possession onto the floor. Ten
    // rigs driven from recorded positions is the least inspectable thing in the
    // app from a headless run, and it is also the easiest to break silently.
    const play = q.get("play");
    if (play) {
      const [g, ev] = play.split(":").map(Number);
      if (Number.isFinite(g) && Number.isFinite(ev)) {
        void getReplay(g, ev)
          .then((c) => usePlaybackStore.getState().open(c))
          .catch(() => {});
      }
    }

    const verb = q.get("shot");
    if (!verb) return;
    const s = useScenarioStore.getState();
    if (q.get("x") && q.get("z")) s.setPosition(Number(q.get("x")), Number(q.get("z")));
    s.setShotType(verb as never);
    const id = setTimeout(() => useScenarioStore.getState().triggerShot(), Number(q.get("at") ?? 1200));
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const cam = MODULE_BY_ID.get(focus)?.camera;
    if (cam != null) cameraStore.set(cam);
  }, [focus]);

  return (
    <div className={`ws mode-${mode}`}>
      <ErrorBoundary>
        <Scene />
      </ErrorBoundary>

      <TopBar />

      {mode === "court" && (
        <>
          <ModuleRail />
          <Dock />
          <PredictionPanel />
          {/* who is taking the shot. His real height, wingspan and shooting
              rates feed the model, so this is a model input, not decoration. */}
          <ShooterChip />
          <CommandBar />
        </>
      )}

      {mode === "predict" && (
        <aside className="side">
          <PredictGame />
        </aside>
      )}

      {mode === "learn" && (
        <>
          <aside className="side wide">
            <SideTabs tabs={[
              { id: "learn", label: "This shot", render: () => <LearnPanel /> },
              { id: "study", label: "Play study", render: () => <PlayStudyPanel /> },
              { id: "ask", label: "Ask", render: () => <AssistantPanel /> },
            ]} onChange={setSideTab} />
          </aside>
          <ShooterChip />
        </>
      )}

      {mode === "coach" && (
        <>
          <aside className="side">
            <SideTabs tabs={[
              { id: "coach", label: "This shot", render: () => <CoachPanel /> },
              { id: "play", label: "Playbook", render: () => <PlaybookPanel /> },
              { id: "ask", label: "Ask", render: () => <AssistantPanel /> },
            ]} onChange={setSideTab} />
          </aside>
          {sideTab !== "play" && (
            <>
              <ShooterChip />
              <CommandBar />
            </>
          )}
        </>
      )}
    </div>
  );
}
