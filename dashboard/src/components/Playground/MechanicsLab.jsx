/**
 * Mechanics Lab, as a section rather than a page.
 *
 * It used to live at its own route with its own sliders, which meant the arc
 * you tuned here had nothing to do with the shot you built on the court. It now
 * reads the shared scenario, so the jump angle in the Playground's controls and
 * the arc drawn here are the same number, and changing either moves both.
 *
 * Collapsed by default: it is depth for a user who wants it, not something to
 * step over on the way to the court.
 */
import { useMemo, useState } from "react";

import { SideViewCanvas, solveArc } from "../SideViewCanvas";
import { RimProjection } from "../RimProjection";
import { RimTargetBar } from "../RimTargetBar";
import { effectiveRimWidth, approachRimWidth } from "../../science";
import { usePlayground } from "../../state/playgroundStore";

const BALL_IN = 9.4;

function Metric({ label, value, unit, tone = "text-txt-primary", note }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-raised p-3">
      <div className="label">{label}</div>
      <div className={`stat mt-1 text-xl ${tone}`}>
        {value}<span className="ml-1 text-xs font-normal text-txt-muted">{unit}</span>
      </div>
      {note && <div className="mt-1 text-[11px] leading-snug text-txt-muted">{note}</div>}
    </div>
  );
}

export function MechanicsLab() {
  const [open, setOpen] = useState(false);
  const { scenario } = usePlayground();

  const cfg = useMemo(() => ({
    distance: scenario.distance,
    jumpAngle: scenario.jumpAngle,
    releaseHeight: scenario.releaseHeight,
    handPlacement: scenario.handPlacement,
  }), [scenario.distance, scenario.jumpAngle, scenario.releaseHeight, scenario.handPlacement]);

  const sol = useMemo(() => solveArc(cfg), [cfg]);
  const entry = Number.isFinite(sol?.entry) ? sol.entry : 45;
  const rim = effectiveRimWidth(entry);
  const approach = approachRimWidth(scenario.approachAngle);
  const margin = (rim - BALL_IN) / 2;

  const entryTone = entry >= 38 && entry <= 52 ? "text-accent-green"
    : entry >= 33 && entry <= 58 ? "text-accent-amber" : "text-accent-red";

  return (
    <section className="card">
      <button
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`text-txt-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="h-title text-base">Mechanics Lab</span>
        <span className="ml-auto text-[11px] text-txt-muted">
          {open ? "Hide" : `Entry ${entry.toFixed(0)}° · rim ${rim.toFixed(1)} in`}
        </span>
      </button>

      {open && (
        <div className="mt-5 grid grid-cols-1 gap-5 border-t border-line pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-4">
            <SideViewCanvas {...cfg} animateKey={scenario.jumpAngle} />
            <p className="text-[11px] leading-relaxed text-txt-muted">
              Side elevation of the shot currently on the court. The launch angle comes
              from the Playground controls, so moving that slider redraws this arc.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Metric
              label="Entry angle" value={entry.toFixed(1)} unit="°" tone={entryTone}
              note="Optimal 38° to 52°. Steeper presents more rim, flatter presents less."
            />
            <Metric
              label="Effective rim target" value={rim.toFixed(1)} unit="in"
              note={`18 × sin(entry). The ball is ${BALL_IN} in across.`}
            />
            <Metric
              label="Ball margin" value={margin.toFixed(1)} unit="in"
              tone={margin > 2 ? "text-accent-green" : margin > 0.8 ? "text-accent-amber" : "text-accent-red"}
              note="Clearance available on each side of the ball."
            />
            <Metric
              label="Approach projection" value={approach.toFixed(1)} unit="in"
              note={`At ${scenario.approachAngle}° of approach the rim presents this width.`}
            />
            <RimTargetBar entryDeg={entry} />
            <RimProjection entryDeg={entry} approachDeg={scenario.approachAngle} />
          </div>
        </div>
      )}
    </section>
  );
}
