/**
 * DOCK — the stack of open panels.
 *
 * THE LAYOUT BUG THIS FIXES
 * Panels are flex items in a column. Flex items default to `flex-shrink: 1`, so
 * once the open panels were taller than the dock, the browser did what it is
 * supposed to do and SHRANK every one of them below its own content height. With
 * `overflow: hidden` on the panel that clipped each one mid-content and the
 * headers rode up over each other, which looks exactly like panels overlapping
 * and losing their content. The dock had a scrollbar the whole time; nothing ever
 * grew tall enough to use it.
 *
 * Panels are now `flex: none`, so they keep their natural height and the dock
 * scrolls, which is what it was always meant to do.
 *
 * Headers are sticky, so while scrolling a long stack you can always see which
 * panel you are inside, and each carries three explicit controls: minimise to the
 * header, expand to fill the dock alone, and close.
 */
import { useDockStore } from "./dockStore";
import { MODULE_BY_ID } from "./modules";

export function Dock() {
  const open = useDockStore((s) => s.open);
  const collapsed = useDockStore((s) => s.collapsed);
  const solo = useDockStore((s) => s.solo);
  const close = useDockStore((s) => s.close);
  const toggleCollapsed = useDockStore((s) => s.toggleCollapsed);
  const toggleSolo = useDockStore((s) => s.toggleSolo);
  const setFocus = useDockStore((s) => s.setFocus);

  if (!open.length) {
    return (
      <aside className="dock empty">
        <div className="dock-empty">
          <strong>Nothing open</strong>
          <span>Pick a panel from the rail.</span>
        </div>
      </aside>
    );
  }

  // When one panel is expanded the others step aside rather than being closed, so
  // the arrangement survives going in and out of a single panel.
  const shown = solo ? open.filter((id) => id === solo) : open;

  return (
    <aside className={`dock ${solo ? "soloed" : ""}`} aria-label="Open panels">
      {shown.map((id) => {
        const mod = MODULE_BY_ID.get(id);
        if (!mod) return null;
        const isCollapsed = !solo && collapsed.includes(id);
        const isSolo = solo === id;
        return (
          <section
            key={id}
            className={`panel ${isCollapsed ? "collapsed" : ""} ${isSolo ? "solo" : ""}`}
          >
            <header
              className="panel-head"
              onClick={() => { setFocus(id); toggleCollapsed(id); }}
              title={isCollapsed ? "Expand" : "Minimise"}
            >
              <span className="panel-icon">{mod.icon}</span>
              <span className="panel-name">{mod.label}</span>

              <button
                className="panel-btn"
                onClick={(e) => { e.stopPropagation(); toggleCollapsed(id); }}
                title={isCollapsed ? "Expand" : "Minimise"}
                aria-label={isCollapsed ? "Expand" : "Minimise"}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
              <button
                className={`panel-btn ${isSolo ? "on" : ""}`}
                onClick={(e) => { e.stopPropagation(); toggleSolo(id); }}
                title={isSolo ? "Show the other panels again" : "Expand this one on its own"}
                aria-label="Expand"
              >
                {isSolo ? "▣" : "▢"}
              </button>
              <button
                className="panel-btn close"
                onClick={(e) => { e.stopPropagation(); close(id); }}
                title="Close"
                aria-label={`Close ${mod.label}`}
              >
                ×
              </button>
            </header>

            {!isCollapsed && (
              <div className="panel-scroll">
                <div className="panel-blurb">{mod.blurb}</div>
                {mod.render()}
              </div>
            )}
          </section>
        );
      })}

      {solo && (
        <button className="dock-restore" onClick={() => toggleSolo(solo)}>
          show all {open.length} panels
        </button>
      )}
    </aside>
  );
}
