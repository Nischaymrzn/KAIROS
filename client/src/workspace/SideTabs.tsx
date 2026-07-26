/**
 * SIDE TABS — one column, two jobs, only one on screen at a time.
 *
 * Coach and Learn each grew a second thing worth showing: the tracked play study
 * alongside the shot they are working on. Stacking both in one scrolling column
 * is how the old dock became a wall, and it also buries whichever one is second
 * below a screen-height of the first.
 *
 * Tabs instead. Two named choices at the top of the column is Hick's law working
 * in the right direction: the reader sees that both exist, and pays no attention
 * cost for the one they are not reading. State is local because which tab is open
 * is a glance, not a setting anyone wants remembered across sessions.
 */
import { useEffect, useState, type ReactNode } from "react";

export interface SideTab {
  id: string;
  label: string;
  render: () => ReactNode;
}

export function SideTabs({
  tabs,
  onChange,
}: {
  tabs: SideTab[];
  /** Fired with the open tab's id. The shell uses it to clear the court of
   *  shooting controls while a tab that owns the floor is open. */
  onChange?: (id: string) => void;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  useEffect(() => { onChange?.(current?.id ?? ""); }, [current?.id, onChange]);

  return (
    <>
      <div className="stabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current?.id}
            className={`stab ${t.id === current?.id ? "on" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Keyed so switching tabs remounts rather than handing the incoming panel
          the outgoing one's scroll position and in-flight requests. */}
      <div className="stab-body" key={current?.id}>{current?.render()}</div>
    </>
  );
}
