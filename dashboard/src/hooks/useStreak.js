import { useCallback, useEffect, useState } from "react";

const KEY = "hoopiq.challenge";

const EMPTY = { streak: 0, best: 0, total: 0, correct: 0, history: [], runs: [], lastId: null };

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Top ten streaks, longest first. The run in progress is included and marked
 * live, otherwise your best-ever streak vanishes from the board for as long as
 * you keep extending it.
 */
export function rankRuns(runs, currentStreak, now = Date.now()) {
  return [
    ...(currentStreak > 0 ? [{ length: currentStreak, at: now, live: true }] : []),
    ...runs,
  ]
    .sort((a, b) => b.length - a.length || b.at - a.at)
    .slice(0, 10);
}

/** Challenge streak, persisted locally. One scored attempt per challenge id. */
export function useStreak() {
  const [state, setState] = useState(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state));
  }, [state]);

  const record = useCallback((challenge, guess, actual) => {
    setState((s) => {
      if (s.lastId === challenge.id) return s;
      const right = guess === actual;
      const streak = right ? s.streak + 1 : 0;
      // a wrong call closes the run, so the length it reached becomes a result
      const runs = !right && s.streak > 0
        ? [{ length: s.streak, at: Date.now() }, ...s.runs].slice(0, 30)
        : s.runs;
      return {
        streak,
        best: Math.max(s.best, streak),
        total: s.total + 1,
        correct: s.correct + (right ? 1 : 0),
        lastId: challenge.id,
        runs,
        history: [
          { id: challenge.id, guess, actual, right, probability: challenge.probability, at: Date.now() },
          ...s.history,
        ].slice(0, 7),
      };
    });
  }, []);

  const reset = useCallback(() => setState({ ...EMPTY }), []);
  const accuracy = state.total ? state.correct / state.total : 0;

  const leaderboard = rankRuns(state.runs, state.streak);

  return { ...state, accuracy, leaderboard, record, reset, answered: (id) => state.lastId === id };
}
