/**
 * Best streaks, longest first. The run in progress is included and marked,
 * because otherwise your best-ever streak disappears from the board for exactly
 * as long as you keep extending it.
 */
export function Leaderboard({ runs }) {
  if (runs.length === 0) {
    return <p className="text-sm text-txt-muted">No streak yet. One correct call starts one.</p>;
  }
  return (
    <ol className="space-y-1 text-sm">
      {runs.map((r, i) => (
        <li
          key={`${r.at}-${i}`}
          className={`flex items-center gap-3 border-b border-line/50 py-1.5 ${
            r.live ? "text-accent-amber" : "text-txt-secondary"
          }`}
        >
          <span className="stat w-6 text-txt-muted">{i + 1}</span>
          <span className="stat flex-1">
            {r.length} in a row
          </span>
          <span className="text-[11px] text-txt-muted">
            {r.live ? "in progress" : new Date(r.at).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ol>
  );
}
