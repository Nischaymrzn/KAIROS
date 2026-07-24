/**
 * MODULE RAIL — toggles, not links.
 *
 * A rail item opens a panel beside whatever is already open. Nothing unmounts,
 * the court keeps its scenario, and the user can hold the heat map and the
 * defence panel on screen at the same time, which is the comparison the previous
 * routed build made impossible.
 *
 */
import { MODULES } from "./modules";
import { useDockStore } from "./dockStore";
import { cameraStore } from "../scene/cameraStore";

/**
 * Every capability, always available.
 *
 * These used to be gated behind levels. Locking most of an analysis tool behind a
 * progression curve is the wrong trade: it withholds the thing someone came for
 * in order to motivate them to keep doing the thing they came with. Progression
 * still exists, but it belongs to the Predict game, where being scored is the
 * point, and not to a set of instruments.
 */
export function ModuleRail() {
  const open = useDockStore((s) => s.open);
  const toggle = useDockStore((s) => s.toggle);

  return (
    <nav className="rail" aria-label="Analysis panels">
      {MODULES.map((m) => {
        const active = open.includes(m.id);
        return (
          <button
            key={m.id}
            className={`rail-item ${active ? "active" : ""}`}
            title={`${m.label} — ${m.blurb}`}
            aria-pressed={active}
            onClick={() => {
              toggle(m.id);
              if (!active && m.camera != null) cameraStore.set(m.camera);
            }}
          >
            <span className="rail-icon">{m.icon}</span>
            <span className="rail-label">{m.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
