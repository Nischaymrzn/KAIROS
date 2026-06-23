import { useEffect, useRef } from "react";
import {
  RIM_DIAMETER_IN, BALL_DIAMETER_IN,
  approachRimWidth, approachMargin, effectiveRimWidth, rimMargin,
} from "../science";

/**
 * The rim as the ball actually sees it.
 *
 * Two separate foreshortenings, both drawn to scale against the ball:
 *   entry angle    narrows it vertically   rim × sin(entry)
 *   approach angle narrows it horizontally rim × cos(approach)
 *
 * Drawing them is the point. A number saying "9 inches" does not land; a circle
 * that is visibly narrower than the ball does. When the margin goes negative the
 * ball no longer fits through the geometric opening at all, which is why a pure
 * side approach has to use the glass.
 */
const SIZE = 190;
const PPI = 6; // pixels per inch

export function RimProjection({ entryDeg, approachDeg }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2;

    const wide = approachRimWidth(approachDeg);  // horizontal axis, inches
    const tall = effectiveRimWidth(entryDeg);    // vertical axis, inches
    const margin = Math.min(approachMargin(approachDeg), rimMargin(entryDeg));
    const fits = margin > 0;

    // full rim for reference
    ctx.strokeStyle = "rgba(249,115,22,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, (RIM_DIAMETER_IN / 2) * PPI, 0, Math.PI * 2);
    ctx.stroke();

    // the opening as foreshortened by both angles
    ctx.strokeStyle = fits ? "#f97316" : "#ef4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, (wide / 2) * PPI, (tall / 2) * PPI, 0, 0, Math.PI * 2);
    ctx.stroke();

    // the ball, to the same scale
    ctx.fillStyle = "rgba(148,163,184,0.28)";
    ctx.strokeStyle = "rgba(226,232,240,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, (BALL_DIAMETER_IN / 2) * PPI, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = "600 10px Inter, sans-serif";
    ctx.fillStyle = "rgba(249,250,251,0.55)";
    ctx.textAlign = "center";
    ctx.fillText(`${wide.toFixed(1)}" across`, cx, SIZE - 8);
    ctx.save();
    ctx.translate(12, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${tall.toFixed(1)}" deep`, 0, 0);
    ctx.restore();
    ctx.textAlign = "left";
  }, [entryDeg, approachDeg]);

  const margin = Math.min(approachMargin(approachDeg), rimMargin(entryDeg));

  return (
    <div className="flex flex-col items-center">
      <canvas ref={ref} width={SIZE} height={SIZE} />
      <div className="text-center mt-1">
        <div className={`stat text-lg ${margin > 2 ? "text-accent-green" : margin > 0 ? "text-accent-amber" : "text-accent-red"}`}>
          {margin > 0 ? `${margin.toFixed(1)}" clearance` : "no clearance"}
        </div>
        <div className="text-[11px] text-txt-muted">
          {margin > 0
            ? `either side of the ball, against 4.3" straight on`
            : "the opening is narrower than the ball from this angle"}
        </div>
      </div>
    </div>
  );
}
