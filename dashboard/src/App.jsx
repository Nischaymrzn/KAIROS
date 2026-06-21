import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { MovementReplay } from "./pages/MovementReplay";
import { Sidebar } from "./components/Sidebar";
import { OfflineBanner } from "./components/OfflineBanner";
import { PlaygroundProvider } from "./state/playgroundStore";
const TrainingGround = lazy(() => import("./pages/TrainingGround").then((m) => ({ default: m.TrainingGround })));
const ShotPredictor = lazy(() => import("./pages/ShotPredictor").then((m) => ({ default: m.ShotPredictor })));
const Compare = lazy(() => import("./pages/Compare").then((m) => ({ default: m.Compare })));
const PlayerAnalysis = lazy(() => import("./pages/PlayerAnalysis").then((m) => ({ default: m.PlayerAnalysis })));
const DailyChallenge = lazy(() => import("./pages/DailyChallenge").then((m) => ({ default: m.DailyChallenge })));
const ModelInsights = lazy(() => import("./pages/ModelInsights").then((m) => ({ default: m.ModelInsights })));
const About = lazy(() => import("./pages/About").then((m) => ({ default: m.About })));

export default function App() {
  const [open, setOpen] = useState(true);
  return (
    <BrowserRouter>
      <PlaygroundProvider>
      <div className="flex h-full">
        <Sidebar open={open} onToggle={() => setOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-page p-6 fade-in">
            <Suspense fallback={<div className="card text-sm text-txt-muted">Loading…</div>}>
            <OfflineBanner />
            <Routes>
              <Route path="/training" element={<TrainingGround />} />
              <Route path="/" element={<ShotPredictor />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/player" element={<PlayerAnalysis />} />
              <Route path="/mechanics" element={<Navigate to="/training" replace />} />
              <Route path="/movement" element={<MovementReplay />} />
              <Route path="/challenge" element={<DailyChallenge />} />
              <Route path="/insights" element={<ModelInsights />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<ShotPredictor />} />
            </Routes>
            </Suspense>
          </div>
        </main>
      </div>
      </PlaygroundProvider>
    </BrowserRouter>
  );
}
