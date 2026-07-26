/**
 * VERB ROW — a horizontal chip strip that admits when it is hiding something.
 *
 * The command bar packs four groups of chips into one bar, so the widest group
 * has to scroll. It already did, but with the scrollbar hidden and no edge
 * treatment the result read as a rendering fault rather than a scroller: the
 * first chip appeared as "g layup" and the selected one as "Pull-u", which looks
 * exactly like clipped text.
 *
 * Four fixes, all here:
 *
 *  1. Edges fade only on the side that actually has more content, driven by a
 *     `data-edge` attribute this component maintains. A permanent fade would dim
 *     the end chips of rows that fit, which is the same lie in the other
 *     direction.
 *  2. Bringing the selected chip into view centres it in the row rather than
 *     nudging it to the nearest edge. `scrollIntoView({ inline: "nearest" })`
 *     moves the minimum distance, which parks the chip flush against the cut and
 *     half under the fade. It can also scroll ancestor elements, which is
 *     unwanted inside a fixed bar; setting `scrollLeft` cannot.
 *  3. A mouse wheel scrolls it. Horizontal scrollers ignore deltaY by default, so
 *     on a desktop mouse the hidden chips could be seen and not reached.
 *  4. Arrows, because 1 to 3 all require the reader to already suspect the row
 *     moves. An arrow is the only one of the four that says so on its own.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Measuring has to happen before paint, or the row shows un-faded edges for a
 * frame. That means useLayoutEffect on the client — but rendercheck renders these
 * panels with renderToString, where React warns that a layout effect cannot run.
 * The warning is correct and irrelevant: the app mounts with createRoot. Falling
 * back to useEffect off-DOM keeps the check output clean, so a real warning is
 * still visible when one appears.
 */
const useMeasureEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/** How much clear space to leave beside a centred chip before giving up on it. */
const EDGE_PAD = 12;

export function VerbRow({
  children,
  /** Changing this re-centres the chip carrying `.on`. */
  activeKey,
}: {
  children: ReactNode;
  activeKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /** Mark which sides still have content, so CSS can fade only those. */
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Sub-pixel widths make an exactly-fitting row report a 0.5px overflow, which
    // would fade an edge with nothing behind it.
    const slack = 1;
    const left = el.scrollLeft > slack;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - slack;
    el.dataset.edge = left && right ? "both" : left ? "left" : right ? "right" : "none";
  }, []);

  useMeasureEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // Chip widths depend on the font, so the first measure can run before Space
    // Grotesk arrives and land on the fallback's metrics.
    document.fonts?.ready.then(measure).catch(() => {});
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);

  /**
   * A mouse wheel over a horizontal scroller does nothing on desktop. The row
   * only moved with a trackpad swipe or shift+wheel, neither of which is
   * discoverable, so the chips past the edge were effectively unreachable even
   * with the fade telling the reader they were there.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;                       // nothing hidden, let the page scroll
      // deltaX is already handled natively by trackpads; only translate deltaY.
      const step = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY;
      if (!step) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + step));
      if (next === el.scrollLeft) return;         // at an end: give the wheel back
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = el.querySelector<HTMLElement>(".verb.on");
    if (!on) return;

    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;                       // nothing to scroll, nothing to do

    // Centre the chip, then clamp. Clamping is what keeps the first and last
    // chips flush with their ends instead of floating in from a centred position.
    const target = on.offsetLeft + on.offsetWidth / 2 - el.clientWidth / 2;
    const next = Math.max(0, Math.min(max, target));

    // Only move when the chip is actually obscured. Re-centring on every render
    // makes the row twitch each time an unrelated part of the scenario changes.
    const visibleFrom = el.scrollLeft + EDGE_PAD;
    const visibleTo = el.scrollLeft + el.clientWidth - EDGE_PAD;
    if (on.offsetLeft >= visibleFrom && on.offsetLeft + on.offsetWidth <= visibleTo) return;

    el.scrollTo({ left: next, behavior: "smooth" });
  }, [activeKey]);

  /** Page the row by most of its width, so a nudge does not lose the reader. */
  const page = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth - 48, 80), behavior: "smooth" });
  };

  return (
    <div className="verb-wrap">
      {/* Arrows are the only affordance that does not have to be discovered. The
          fade says content is hidden and the wheel reaches it, but neither tells
          a first-time reader that the row moves at all. Rendered always and
          hidden by CSS on the side with nothing behind it, so their appearing
          never reflows the chips. */}
      <button
        type="button" className="verb-arrow left" tabIndex={-1} aria-hidden="true"
        onClick={() => page(-1)}
      >
        ‹
      </button>
      <div className="verb-row" ref={ref} data-edge="none">
        {children}
      </div>
      <button
        type="button" className="verb-arrow right" tabIndex={-1} aria-hidden="true"
        onClick={() => page(1)}
      >
        ›
      </button>
    </div>
  );
}
