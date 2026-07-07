import { useEffect, useState } from "react";
import { CAMERA_VIEWS } from "../scene/cameraPresets";
import { cameraStore } from "../scene/cameraStore";

/**
 * VIEW CONTROLS — a row of buttons, one per camera preset. Clicking one flies the
 * camera to that view; the active view stays highlighted. Driven by the same
 * cameraStore the 3D <CameraRig/> listens to, so buttons, double-click, and number
 * keys all stay in sync. Add a preset in cameraPresets.ts and a button shows up
 * here automatically.
 */
export function ViewControls() {
  const [active, setActive] = useState(cameraStore.get());
  useEffect(() => cameraStore.subscribe(setActive), []);

  return (
    <div className="views" role="toolbar" aria-label="Camera views">
      {CAMERA_VIEWS.map((v, i) => (
        <button
          key={v.name}
          className={i === active ? "view active" : "view"}
          onClick={() => cameraStore.set(i)}
        >
          <span className="view-key">{i + 1}</span>
          {v.name}
        </button>
      ))}
    </div>
  );
}
