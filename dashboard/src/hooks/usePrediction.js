import { useEffect, useRef, useState } from "react";
import { predictShot } from "../api";

/**
 * Debounced prediction. Sliders fire continuously, so without this a drag sends
 * one request per pixel. The trailing edge is what the user actually settled on,
 * and stale responses are dropped by sequence number rather than by abort alone,
 * because an aborted request that already resolved can still land late.
 */
export function usePrediction(scenario, { delay = 300 } = {}) {
  const [prediction, setPrediction] = useState(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setPending(true);
    const timer = setTimeout(() => {
      predictShot(scenario)
        .then((r) => {
          if (mine !== seq.current) return; // a newer request has been issued
          setPrediction(r);
          setPending(false);
        })
        .catch(() => {
          if (mine === seq.current) setPending(false);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [JSON.stringify(scenario), delay]);

  return { prediction, pending };
}
