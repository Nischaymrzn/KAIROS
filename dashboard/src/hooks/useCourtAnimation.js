import { useEffect, useRef } from "react";

/**
 * Runs a phased animation on one rAF loop and hands each frame to `onFrame` as
 * `{ phase, t }`, where t is 0-1 within the current phase.
 *
 * Deliberately state-free: the canvas paints straight from the callback, so a
 * shot in flight never re-renders the page. `phases` is an ordered list of
 * [name, durationMs]; when the last one ends, onFrame(null) clears the frame.
 */
export function useCourtAnimation(triggerKey, phases, onFrame) {
  const raf = useRef(0);
  const total = phases.reduce((a, [, d]) => a + d, 0);

  useEffect(() => {
    if (!triggerKey) return;
    const t0 = performance.now();

    const step = (now) => {
      const e = now - t0;
      if (e >= total) {
        onFrame(null);
        return;
      }
      let acc = 0;
      for (const [name, dur] of phases) {
        if (e < acc + dur) {
          onFrame({ phase: name, t: (e - acc) / dur });
          break;
        }
        acc += dur;
      }
      raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [triggerKey, total, onFrame]);
}
