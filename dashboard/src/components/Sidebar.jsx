import { NavLink } from "react-router-dom";

// Training Ground leads: it is the page that carries the scenario and holds the
// analysis panels. Mechanics Lab is no longer here because it is a section
// inside that page, sharing its jump angle rather than owning a separate one.
const ITEMS = [
  { to: "/training", label: "Training Ground", icon: "⚔" },
  { to: "/", label: "Shot Predictor", icon: "◎", end: true },
  { to: "/compare", label: "Compare", icon: "⇄" },
  { to: "/player", label: "Player Analysis", icon: "◕" },
  { to: "/movement", label: "Movement Replay", icon: "⟿" },
  { to: "/challenge", label: "Daily Challenge", icon: "★" },
  { to: "/insights", label: "Model Insights", icon: "≡" },
  { to: "/about", label: "About", icon: "ⓘ" },
];

export function Sidebar({ open, onToggle }) {
  return (
    <aside
      className={`${open ? "w-[220px]" : "w-16"} shrink-0 border-r border-line bg-bg-secondary
                  transition-[width] duration-150 flex flex-col`}
    >
      <button
        onClick={onToggle}
        aria-label={open ? "Collapse navigation" : "Expand navigation"}
        className="h-14 flex items-center gap-3 px-5 text-txt-secondary hover:text-txt-primary"
      >
        <span className="text-lg leading-none">☰</span>
        {open && <span className="font-semibold tracking-tight text-txt-primary">HoopIQ</span>}
      </button>

      <nav className="flex-1 py-2">
        {ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            end={it.to === "/"}
            title={it.label}
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 h-11 border-l-2 transition-colors duration-150 ` +
              (isActive
                ? "border-accent-blue bg-bg-tertiary text-txt-primary"
                : "border-transparent text-txt-secondary hover:text-txt-primary hover:bg-bg-tertiary/50")
            }
          >
            <span className="w-4 text-center">{it.icon}</span>
            {open && <span className="text-sm truncate">{it.label}</span>}
          </NavLink>
        ))}
      </nav>

      {open && (
        <div className="p-5 text-[11px] text-txt-muted leading-relaxed border-t border-line">
          Shot quality model v7
          <br />
          BSc (Hons) Computing with AI
        </div>
      )}
    </aside>
  );
}
