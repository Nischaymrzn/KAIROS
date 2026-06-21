import { useCallback, useEffect, useRef } from "react";
import { useCourtAnimation } from "../hooks/useCourtAnimation";
import { peakHeight } from "../science";

/**
 * NBA half court on canvas, plus the shot trajectory animation.
 *
 * Geometry is drawn from real dimensions at 10 px per foot, so distances read
 * off the canvas are true feet: the arc is 23.75 ft, the paint 16 ft wide, the
 * restricted area a 4 ft radius. Basket sits at (250, 52).
 *
 * The animation runs on one rAF loop writing straight to the canvas. Nothing
 * about it touches React state, so a running shot never re-renders the page.
 */
export const PX = 10;
export const W = 500;
export const H = 470;
export const BASKET = { x: 250, y: 52 };

/** path draws in, ball flies, result reads out. */
const PHASES = [["path", 100], ["ball", 700], ["result", 400]];

export function toFeet(px, py) {
  const dx = (px - BASKET.x) / PX;
  const dy = (py - BASKET.y) / PX;
  return { dist: Math.hypot(dx, dy), dx, dy };
}

export function zoneAt(px, py) {
  const { dist, dx, dy } = toFeet(px, py);
  const corner = Math.abs(dx) >= 22 && dy <= 14;
  if (dist >= 23.75 || (corner && dist >= 22)) return corner ? "corner3" : "break3";
  if (dist < 4) return "restricted";
  if (Math.abs(dx) <= 8 && dy <= 19) return "paint";
  return "midrange";
}

function drawCourt(ctx) {
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#161b28";
  ctx.fillRect(0, 0, W, H);

  // faint boards so the floor is not a flat slab
  ctx.strokeStyle = "rgba(200,169,110,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  // baseline + sidelines
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // paint: 16 ft wide, 19 ft deep
  const paintW = 16 * PX;
  const paintH = 19 * PX;
  ctx.strokeRect(BASKET.x - paintW / 2, 1, paintW, paintH);

  // free-throw circle
  ctx.beginPath();
  ctx.arc(BASKET.x, paintH + 1, 6 * PX, 0, Math.PI * 2);
  ctx.stroke();

  // restricted area, 4 ft radius
  ctx.beginPath();
  ctx.arc(BASKET.x, BASKET.y, 4 * PX, 0, Math.PI, false);
  ctx.stroke();

  // three-point line: corners run straight to where the arc meets them
  const r = 23.75 * PX;
  const cornerZ = 22 * PX;
  const meetY = BASKET.y + Math.sqrt(r * r - cornerZ * cornerZ);
  ctx.beginPath();
  ctx.moveTo(BASKET.x - cornerZ, 1);
  ctx.lineTo(BASKET.x - cornerZ, meetY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(BASKET.x + cornerZ, 1);
  ctx.lineTo(BASKET.x + cornerZ, meetY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(BASKET.x, BASKET.y, r, Math.acos(cornerZ / r), Math.PI - Math.acos(cornerZ / r));
  ctx.stroke();

  // centre circle at the half-court line
  ctx.beginPath();
  ctx.arc(BASKET.x, H, 6 * PX, Math.PI, Math.PI * 2);
  ctx.stroke();

  // backboard + rim
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(BASKET.x - 3 * PX, BASKET.y - 1.25 * PX);
  ctx.lineTo(BASKET.x + 3 * PX, BASKET.y - 1.25 * PX);
  ctx.stroke();
  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(BASKET.x, BASKET.y, 0.75 * PX, 0, Math.PI * 2);
  ctx.stroke();
}

/** Arc colour tracks the quality band, so the shape and the colour agree. */
function arcColor(p) {
  if (p >= 0.55) return "#2dd4bf";   // Elite / High
  if (p >= 0.45) return "#f59e0b";   // Average
  return "#ef4444";                  // Low / Poor
}

/**
 * Control point for the flight, from the launch angle rather than a fixed lift.
 *
 *   peak = distance x tan(jump angle) / 4
 *
 * which is the parabola whose initial slope is the launch angle: a 30 degree
 * release stays flat, 75 degrees goes nearly vertical. Capped so a near-90
 * degree setting cannot send the control point off-canvas, since tan diverges.
 */
function controlPoint(from, jumpAngle) {
  const mx = (from.x + BASKET.x) / 2;
  const my = (from.y + BASKET.y) / 2;
  const dist = Math.hypot(from.x - BASKET.x, from.y - BASKET.y);
  // capped because tan diverges near 90 and would throw the control point off-canvas
  const peak = Math.min(peakHeight(dist, Math.min(jumpAngle, 85)), H * 0.8);
  return { x: mx, y: my - peak };
}

function bez(a, c, b, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

// each defender gets its own red so the labels on the court and the rows in the
// controls panel can be matched by colour rather than by counting
const DEFENDER_COLORS = ["#ef4444", "#f87171", "#fca5a5"];

export function CourtCanvas({
  shooter, defender, defenders, probability = 0.5, jumpAngle = 45,
  simulateKey = 0, made = null, onCourtClick, onDefenderDrag, onDefenderMove,
}) {
  const ref = useRef(null);
  const raf = useRef(0);
  const drag = useRef(null);   // id of the defender being dragged, or null

  // `defender` (single) is the older prop; `defenders` (array) is what the
  // playground store passes. Normalising here keeps both callers working.
  const marks = defenders ?? (defender ? [{ id: 1, ...defender }] : []);

  const paint = useCallback(
    (anim) => {
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      drawCourt(ctx);

      const from = shooter;
      const cp = controlPoint(from, jumpAngle);

      if (anim) {
        const { phase, t } = anim;
        ctx.strokeStyle = arcColor(probability);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        const drawTo = phase === "path" ? t : 1;
        for (let i = 1; i <= 40; i++) {
          const p = bez(from, cp, BASKET, (i / 40) * drawTo);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (phase === "ball" || phase === "result") {
          const tt = phase === "ball" ? t : 1;
          // a miss drifts off line over the last fifth of the flight
          const off = made === false && tt > 0.85 ? ((tt - 0.85) / 0.15) * 15 : 0;
          const p = bez(from, cp, BASKET, tt);
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.5)";
          ctx.shadowBlur = 6;
          ctx.fillStyle = "#f97316";
          ctx.beginPath();
          ctx.arc(p.x + off, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          // seam spins with travel
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(p.x + off, p.y, 6, 2.5, tt * 12, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (phase === "result" && made === true) {
          // net ripple: three semicircles expanding under the rim
          for (let i = 0; i < 3; i++) {
            const k = Math.max(0, Math.min(1, t * 1.4 - i * 0.18));
            if (k <= 0) continue;
            ctx.strokeStyle = `rgba(34,197,94,${(1 - k) * 0.9})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(BASKET.x, BASKET.y + 3, 6 + k * 22, 0, Math.PI);
            ctx.stroke();
          }
        }
        if (phase === "result" && made === false) {
          // an X at the rim, offset the way the ball veered
          const r = 6;
          const cx = BASKET.x + 15;
          const cy = BASKET.y;
          ctx.strokeStyle = `rgba(239,68,68,${1 - t})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
          ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
          ctx.stroke();
        }
      }

      // zone label
      const zone = zoneAt(from.x, from.y);
      const names = { restricted: "Restricted Area", paint: "Paint", midrange: "Mid-Range", corner3: "Corner 3", break3: "Above Break 3" };
      ctx.fillStyle = "rgba(249,250,251,0.5)";
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillText(names[zone].toUpperCase(), 12, H - 14);
      ctx.fillText(`${toFeet(from.x, from.y).dist.toFixed(1)} FT`, W - 58, H - 14);

      // contest line to the NEAREST defender only, coloured by how tight it is.
      // Drawing one line rather than three keeps the read unambiguous: that is
      // the distance the model actually consumes.
      if (marks.length) {
        const near = marks.reduce((best, d) =>
          Math.hypot(d.x - from.x, d.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y)
            ? d : best);
        const ft = Math.hypot(near.x - from.x, near.y - from.y) / PX;
        ctx.strokeStyle = ft < 3 ? "rgba(239,68,68,0.75)"
          : ft < 6 ? "rgba(234,179,8,0.7)" : "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(near.x, near.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(237,242,255,0.85)";
        ctx.font = "600 10px Inter, sans-serif";
        ctx.fillText(`${ft.toFixed(1)} ft`, (from.x + near.x) / 2 + 6, (from.y + near.y) / 2 - 4);
      }

      // defenders
      marks.forEach((d, i) => {
        ctx.fillStyle = DEFENDER_COLORS[i % DEFENDER_COLORS.length];
        ctx.beginPath();
        ctx.arc(d.x, d.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "rgba(237,242,255,0.9)";
        ctx.font = "600 9px Inter, sans-serif";
        ctx.fillText(`D${i + 1}`, d.x - 5, d.y + 18);
      });

      // shooter
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(from.x, from.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    [shooter, marks, probability, jumpAngle, made]
  );

  useEffect(() => { paint(null); }, [paint]);

  useCourtAnimation(simulateKey, PHASES, paint);

  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      className="w-full max-w-[500px] rounded-lg border border-line cursor-crosshair select-none touch-none"
      onPointerDown={(e) => {
        const p = pos(e);
        const hit = marks.find((d) => Math.hypot(p.x - d.x, p.y - d.y) < 14);
        if (hit) {
          drag.current = hit.id;
          e.currentTarget.setPointerCapture(e.pointerId);
        } else onCourtClick?.(p);
      }}
      onPointerMove={(e) => {
        if (drag.current == null) return;
        const p = pos(e);
        onDefenderMove?.(drag.current, p);
        onDefenderDrag?.(p);
      }}
      onPointerUp={() => { drag.current = null; }}
    />
  );
}
