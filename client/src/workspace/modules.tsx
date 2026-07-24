/**
 * MODULE REGISTRY — every capability the environment offers, as a dockable panel.
 *
 * The heavier analytical surfaces (explorer, players, physics, movement, models,
 * defence) are the EXISTING page components, rendered inside the dock rather than
 * rewritten. Their logic, their store subscriptions and their API calls are
 * untouched; only their framing changes, and it changes in CSS
 * (`.dock-embed` in arena.css) rather than by editing nine files and hoping
 * nothing regressed. What was a route is now a panel, and several can be open at
 * once — which is the whole point, since the previous build forced the user to
 * destroy one view in order to look at another.
 *
 * The overlays a page used to draw for itself — the prediction readout, the shot
 * type bar, the shoot button — are drawn ONCE by the Arena, so opening three
 * panels does not produce three shoot buttons.
 */
import { ReactNode } from "react";
import { ModuleId } from "./dockStore";

import { PlayersPage } from "../pages/PlayersPage";
import { ModelsPage } from "../pages/ModelsPage";
import { FilmPage } from "../pages/FilmPage";

import { DefencePanel } from "./panels/DefencePanel";
import { ShotLabPanel } from "./panels/ShotLabPanel";
import { GamePlanPanel } from "./panels/GamePlanPanel";
import { PlayStudyPanel } from "./panels/PlayStudyPanel";
import { ShotChartPanel } from "./panels/ShotChartPanel";
import { ComparePanel } from "./panels/ComparePanel";
import { ArcLabPanel } from "./panels/ArcLabPanel";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  icon: string;
  /** one line, shown in the rail tooltip and the panel header */
  blurb: string;
  render: () => ReactNode;
  /** camera preset that frames this work best, applied when focused */
  camera?: number;
}

/** Wrap a legacy page so its fixed-position chrome reflows into the dock. */
const embed = (node: ReactNode) => <div className="dock-embed">{node}</div>;

export const MODULES: ModuleDef[] = [
  {
    id: "predict",
    label: "Shot Lab",
    icon: "◉",
    blurb: "Place the shooter, pick the action, read the model",
    render: () => <ShotLabPanel />,
    camera: 0,
  },
  {
    id: "defend",
    label: "Defence",
    icon: "⛨",
    blurb: "Place bodies and score the shot from where they stand",
    render: () => <DefencePanel />,
    camera: 1,
  },
  {
    id: "film",
    label: "Film",
    icon: "▣",
    blurb: "Replay any shot you have taken, exactly as it fell",
    render: () => embed(<FilmPage />),
    camera: 0,
  },
  {
    id: "explore",
    label: "Heat Map",
    icon: "▦",
    blurb: "Make probability over the floor, drawn flat and with a legend",
    render: () => <ShotChartPanel />,
    camera: 6,
  },
  {
    id: "physics",
    label: "Arc Lab",
    icon: "∿",
    blurb: "Does the arc fit the rim and clear the hand",
    render: () => <ArcLabPanel />,
    camera: 3,
  },
  {
    id: "players",
    label: "Players",
    icon: "♟",
    blurb: "Real player profiles standing on the floor",
    render: () => embed(<PlayersPage />),
    camera: 2,
  },
  {
    id: "study",
    label: "Play Study",
    icon: "⛹",
    blurb: "Ten tracked players, from where the possession started",
    render: () => <PlayStudyPanel />,
    camera: 0,
  },
  {
    id: "movement",
    label: "Game Plan",
    icon: "▦",
    blurb: "What real tracked players did in this situation",
    render: () => <GamePlanPanel />,
    camera: 0,
  },
  {
    id: "compare",
    label: "Compare",
    icon: "⇄",
    blurb: "Save two scenarios and hold them side by side",
    render: () => <ComparePanel />,
  },
  {
    id: "models",
    label: "Registry",
    icon: "≡",
    blurb: "The frozen production bundles and their metrics",
    render: () => embed(<ModelsPage />),
    camera: 5,
  },
];

export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));
