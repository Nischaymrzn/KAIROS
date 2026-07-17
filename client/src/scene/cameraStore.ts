/**
 * Tiny camera-view store — a framework-agnostic pub/sub so the DOM overlay
 * (<ViewControls/>, outside the R3F canvas) and the 3D <CameraRig/> (inside it)
 * agree on the active preset without any React-context bridging across the
 * renderer boundary. `set(i)` selects a view (re-selecting the same index is
 * allowed — it re-frames that view).
 */
type Listener = (index: number) => void;

let current = 0;
const listeners = new Set<Listener>();

export const cameraStore = {
  get: () => current,
  set: (index: number) => {
    current = index;
    listeners.forEach((l) => l(index));
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
