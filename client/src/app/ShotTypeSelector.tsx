/**
 * SHOT TYPE SELECTOR — compact pill row letting the user pick the action verb
 * that feeds the backend's ACTION_MAP (catch_shoot → "Jump Shot" etc.).
 * Only the active verb re-renders on store update.
 */
import { useShotStore, ShotVerb } from "../state/shotStore";

const SHOT_TYPES: { verb: ShotVerb; label: string }[] = [
  { verb: "catch_shoot", label: "Catch & Shoot" },
  { verb: "pullup",      label: "Pull-up" },
  { verb: "stepback",    label: "Step-back" },
  { verb: "fadeaway",    label: "Fadeaway" },
  { verb: "driving_layup", label: "Layup" },
  { verb: "floater",    label: "Floater" },
  { verb: "hook",        label: "Hook" },
  { verb: "dunk",        label: "Dunk" },
];

export function ShotTypeSelector() {
  const active = useShotStore((s) => s.scenario.shotType);
  const setShotType = useShotStore((s) => s.setShotType);

  return (
    <div className="shot-type-bar">
      {SHOT_TYPES.map(({ verb, label }) => (
        <button
          key={verb}
          className={`shot-type-btn ${active === verb ? "active" : ""}`}
          onClick={() => setShotType(verb)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
