import { Suspense } from "react";
import { Scene } from "@/components/scene/Scene";
import { Header } from "@/components/ui/Header";
import { ControlPanel } from "@/components/ui/ControlPanel";
import { PredictionPanel } from "@/components/ui/PredictionPanel";
import "@/styles/app.css";

export default function App() {
  return (
    <div className="app-root">
      <div className="scene-layer">
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </div>

      <div className="hud">
        <Header />
        <div className="left-dock">
          <ControlPanel />
        </div>
        <div className="right-dock">
          <PredictionPanel />
        </div>
      </div>
    </div>
  );
}
