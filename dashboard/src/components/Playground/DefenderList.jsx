/**
 * The defenders on the court, as rows.
 *
 * The colours match the dots on the canvas so a row can be identified without
 * counting, and the distance updates live while a dot is dragged. Only the
 * nearest distance reaches the model, which the footer says outright rather
 * than leaving the user to infer it from three numbers.
 */
import { MAX_DEFENDERS } from "../../state/playgroundStore";
import { PX } from "../CourtCanvas";

const COLORS = ["#ef4444", "#f87171", "#fca5a5"];

const tone = (ft) =>
  ft < 3 ? "text-accent-red" : ft < 6 ? "text-accent-amber" : "text-txt-secondary";

export function DefenderList({ pg }) {
  const rows = pg.defenders.map((d, i) => ({
    ...d,
    i,
    ft: Math.hypot(d.x - pg.shooter.x, d.y - pg.shooter.y) / PX,
  }));
  const nearest = rows.length ? Math.min(...rows.map((r) => r.ft)) : null;

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="label">Defenders</div>
        <div className="text-[11px] text-txt-muted">{rows.length} / {MAX_DEFENDERS}</div>
      </div>

      {rows.length === 0 ? (
        <p className="mb-3 text-sm text-txt-muted">
          No defenders. The shot is treated as uncontested.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}
                className="flex items-center gap-3 rounded-md border border-border-subtle
                           bg-bg-raised px-3 py-2">
              <span className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ background: COLORS[r.i % COLORS.length] }} />
              <span className="text-sm text-txt-primary">D{r.i + 1}</span>
              <span className={`ml-auto stat text-sm ${tone(r.ft)}`}>
                {r.ft.toFixed(1)} ft
              </span>
              <button
                className="text-txt-muted transition-colors hover:text-accent-red"
                aria-label={`Remove defender ${r.i + 1}`}
                onClick={() => pg.removeDefender(r.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        className="btn w-full"
        disabled={rows.length >= MAX_DEFENDERS}
        onClick={() => pg.addDefender()}
      >
        + Add defender
      </button>

      <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-txt-muted">
        Drag a dot on the court to move it.
        {nearest != null && (
          <> The model sees the nearest only, currently
            {" "}<span className="text-txt-secondary">{nearest.toFixed(1)} ft</span>.</>
        )}
      </p>
    </section>
  );
}
