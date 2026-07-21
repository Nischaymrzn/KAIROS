/**
 * PHYSICS STORE — the chosen launch angle for the arc visual. `null` means
 * "use the minimum-speed (optimal) angle + 4°", the coach's default teaching arc.
 * The Physics page slider writes here; the 3D ShotArc reads it.
 */
import { create } from "zustand";

interface PhysicsState {
  /** launch angle override in degrees, or null = optimal+4 */
  launchDeg: number | null;
  setLaunchDeg(v: number | null): void;
}

export const usePhysicsStore = create<PhysicsState>((set) => ({
  launchDeg: null,
  setLaunchDeg: (launchDeg) => set({ launchDeg }),
}));
