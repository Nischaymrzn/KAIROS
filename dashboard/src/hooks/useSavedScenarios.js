import { useCallback, useEffect, useState } from "react";

const KEY = "hoopiq.scenarios";

/**
 * Scenarios saved from the predictor, so Save Scenario actually goes somewhere:
 * Compare reads this list and can load either side from it. Persisted locally,
 * capped so the store cannot grow without bound.
 */
export function useSavedScenarios(limit = 12) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const save = useCallback((entry) => {
    setItems((s) => [{ ...entry, id: Date.now() }, ...s].slice(0, limit));
  }, [limit]);

  const remove = useCallback((id) => setItems((s) => s.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  return { items, save, remove, clear };
}
