export function SuggestionBox({ suggestions, onApply }) {
  return (
    <div className="card">
      <div className="label mb-3">How to improve this shot</div>
      <ul className="space-y-4">
        {suggestions.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-1 text-accent-blue text-xs">▸</span>
            <div className="flex-1">
              <p className="text-sm text-txt-primary leading-snug">{s.text}</p>
              <p className="text-xs text-txt-muted leading-relaxed mt-1">{s.why}</p>
              {s.action && (
                <button className="btn mt-2 !py-1 !px-3 text-xs" onClick={() => onApply(s.action)}>
                  Apply
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
