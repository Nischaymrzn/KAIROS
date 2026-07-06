/**
 * APP — one environment, no routes.
 *
 * The previous shell was a nine-route application over a shared 3D scene. It
 * looked modular and behaved like a set of disconnected tools: opening the heat
 * map closed the defence analysis, and every capability owned the entire screen
 * for as long as you were looking at it.
 *
 * The Workspace replaces it. Capabilities are dockable panels over one persistent
 * court, several can be open at once, and the scenario is never reset by moving
 * between them. The shot library keeps a route because it is a reference document
 * rather than a live surface, and it is lazy so it stays out of the entry bundle.
 */
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Workspace from "../workspace/Workspace";
import "../state/filmStore"; // side effect: auto-records every fired shot

const ShotLibraryPage = lazy(() => import("../shots/ShotLibraryPage"));
const ShotDetailPage = lazy(() => import("../shots/ShotDetailPage"));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/shots"
          element={<Suspense fallback={null}><ShotLibraryPage /></Suspense>}
        />
        <Route
          path="/shots/:shotId"
          element={<Suspense fallback={null}><ShotDetailPage /></Suspense>}
        />
        <Route path="*" element={<Workspace />} />
      </Routes>
    </BrowserRouter>
  );
}
