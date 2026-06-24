import { useEffect, useRef } from "react";
import { BALL_DIAMETER_IN, ENTRY_OPTIMAL, effectiveRimWidth, entryIsOptimal } from "../science";

/**
 * Side elevation of the shot: release point on the left, rim and backboard on
 * the right, and the arc between them.
 *
 * The arc is real projectile motion rather than a drawn curve. Given the release
 * height, the horizontal distance and the launch angle, the speed needed to pass
 * through the rim follows from the ballistic equation, and the entry angle falls
 * out of the velocity components at the rim. That means the entry angle readout
 * is derived, not decorative: change the launch angle and the number moves for
 * the right reason.
 *
 *   y = y0 + x·tanθ − g·x² / (2·v²·cos²θ)
 *   solving y(D) = rim height for v, then entry angle = atan(vy/vx) at x = D.
 */
export const SW = 700;
export const SH = 350;
const RIM = { x: 650, y: 260 };
const G = 32.174; // ft/s²
const RIM_IN = 18;

const RELEASE_H = { Low: 6.4, Medium: 7.6, High: 8.6 };
/** Hand placement shifts where the ball leaves relative to the head. */
const HAND_OFFSET = { "One Hand": 0.25, "Two Hand": 0, "Finger Roll": -0.35, Hook: 0.45 };

export function solveArc({ distance, jumpAngle, releaseHeight, handPlacement }) {
  const h0 = (RELEASE_H[releaseHeight] ?? 7.6) + (HAND_OFFSET[handPlacement] ?? 0);
  const rimH = 10;
  const D = Math.max(distance, 1);
  const th = (jumpAngle * Math.PI) / 180;
  const drop = rimH - h0;

  // v² = g·D² / (2·cos²θ·(D·tanθ − drop))
  const denom = 2 * Math.cos(th) ** 2 * (D * Math.tan(th) - drop);
  const feasible = denom > 0;
  const v = feasible ? Math.sqrt((G * D * D) / denom) : NaN;

  let entry = NaN;
  let flight = NaN;
  if (feasible) {
    const vx = v * Math.cos(th);
    const vy = v * Math.sin(th) - (G * D) / vx;
    entry = Math.abs((Math.atan2(vy, vx) * 180) / Math.PI);
    flight = D / vx;
  }

  const apex = feasible ? h0 + (v * Math.sin(th)) ** 2 / (2 * G) : h0;
  return { h0, v, entry, flight, apex, feasible, D };
}

/**
 * Clear space around the ball at the rim. The window shrinks as the ball comes
 * in flatter, because the opening the ball sees is the rim foreshortened by the
 * entry angle. Dimensions come from science.js so the side view, the rim
 * projection and the target bar can never disagree — this file previously
 * carried its own 9.5 in ball against science.js's 9.4.
 */
export function rimWindow(entryDeg) {
  if (!isFinite(entryDeg)) return 0;
  return Math.max(0, effectiveRimWidth(entryDeg) - BALL_DIAMETER_IN);
}

export function SideViewCanvas({
  distance = 18, jumpAngle = 45, releaseHeight = "Medium", handPlacement = "Two Hand",
  animateKey = 0, compact = false,
}) {
  const ref = useRef(null);
  const raf = useRef(0);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const sol = solveArc({ distance, jumpAngle, releaseHeight, handPlacement });

    // world -> canvas: rim sits at RIM, scale so the longest shot still fits
    const ppf = Math.min((RIM.x - 60) / Math.max(sol.D, 8), 18);
    const originX = RIM.x - sol.D * ppf;
    const groundY = RIM.y + 10 * ppf;
    const wx = (x) => originX + x * ppf;
    const wy = (y) => groundY - y * ppf;

    const draw = (t) => {
      ctx.clearRect(0, 0, SW, SH);
      ctx.fillStyle = "#161b28";
      ctx.fillRect(0, 0, SW, SH);

      // floor
      ctx.strokeStyle = "rgba(200,169,110,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(SW, groundY);
      ctx.stroke();

      // backboard + rim
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(wx(sol.D + 1.25), wy(9));
      ctx.lineTo(wx(sol.D + 1.25), wy(12.5));
      ctx.stroke();
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(wx(sol.D - 0.75), wy(10));
      ctx.lineTo(wx(sol.D + 0.75), wy(10));
      ctx.stroke();

      // net: cords converging from the rim to a narrower throat
      ctx.strokeStyle = "rgba(229,231,235,0.45)";
      ctx.lineWidth = 1;
      const netTopL = wx(sol.D - 0.75), netTopR = wx(sol.D + 0.75);
      const netBotL = wx(sol.D - 0.42), netBotR = wx(sol.D + 0.42);
      const netTopY = wy(10), netBotY = wy(10) + 1.35 * ppf;
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        ctx.beginPath();
        ctx.moveTo(netTopL + (netTopR - netTopL) * f, netTopY);
        ctx.lineTo(netBotL + (netBotR - netBotL) * f, netBotY);
        ctx.stroke();
      }
      for (let r = 1; r <= 2; r++) {
        const f = r / 3;
        const yy = netTopY + (netBotY - netTopY) * f;
        const l = netTopL + (netBotL - netTopL) * f;
        const rr = netTopR + (netBotR - netTopR) * f;
        ctx.beginPath();
        ctx.moveTo(l, yy);
        ctx.lineTo(rr, yy);
        ctx.stroke();
      }

      if (!sol.feasible) {
        ctx.fillStyle = "#ef4444";
        ctx.font = "600 13px Inter, sans-serif";
        ctx.fillText("This angle cannot reach the rim from here", 24, 28);
        return;
      }

      // the arc
      const th = (jumpAngle * Math.PI) / 180;
      const vx = sol.v * Math.cos(th);
      const yAt = (x) => sol.h0 + x * Math.tan(th) - (G * x * x) / (2 * vx * vx);
      const upto = Math.max(0.02, t);

      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const x = (i / 60) * sol.D * upto;
        const px = wx(x), py = wy(yAt(x));
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();

      // release marker
      ctx.fillStyle = "#9ca3af";
      ctx.beginPath();
      ctx.arc(wx(0), wy(sol.h0), 4, 0, Math.PI * 2);
      ctx.fill();

      // ball riding the arc
      const bx = sol.D * upto;
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(wx(bx), wy(yAt(bx)), 5, 0, Math.PI * 2);
      ctx.fill();

      if (compact) return;

      // the 38-52 optimal band, shaded, so the current angle is read against it
      const good = entryIsOptimal(sol.entry);
      ctx.fillStyle = "rgba(34,197,94,0.16)";
      ctx.beginPath();
      ctx.moveTo(wx(sol.D), wy(10));
      ctx.arc(wx(sol.D), wy(10), 34, Math.PI + (38 * Math.PI) / 180, Math.PI + (52 * Math.PI) / 180);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = good ? "#22c55e" : "#f59e0b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wx(sol.D), wy(10), 26, Math.PI, Math.PI + (sol.entry * Math.PI) / 180);
      ctx.stroke();
      ctx.fillStyle = good ? "#22c55e" : "#f59e0b";
      ctx.font = "700 13px Inter, sans-serif";
      ctx.fillText(`${sol.entry.toFixed(1)}° entry`, wx(sol.D) - 96, wy(10) - 34);

      // The target window drawn to scale across the rim: the opening the ball
      // actually sees at this entry angle, against the full 18 in. Green when
      // there is real clearance, red once the ball no longer fits.
      const win = rimWindow(sol.entry);
      const eff = effectiveRimWidth(sol.entry);
      const inPerPx = 1.5 / (RIM_IN / 12); // rim spans 1.5 ft on the canvas
      const halfEff = ((eff / 12) / 2) * ppf;
      const halfBall = ((BALL_DIAMETER_IN / 12) / 2) * ppf;
      const ry = wy(10) + 13;

      ctx.strokeStyle = "rgba(249,250,251,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(wx(sol.D - 0.75), ry);
      ctx.lineTo(wx(sol.D + 0.75), ry);
      ctx.stroke();

      ctx.strokeStyle = win > 0 ? "#22c55e" : "#ef4444";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wx(sol.D) - halfEff, ry);
      ctx.lineTo(wx(sol.D) + halfEff, ry);
      ctx.stroke();

      // the ball to the same scale, so the clearance is visible not just stated
      ctx.strokeStyle = "rgba(226,232,240,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx(sol.D) - halfBall, ry + 5);
      ctx.lineTo(wx(sol.D) + halfBall, ry + 5);
      ctx.stroke();
      void inPerPx;
      ctx.fillStyle = "rgba(249,250,251,0.55)";
      ctx.font = "500 11px Inter, sans-serif";
      ctx.fillText(`${eff.toFixed(1)}" target / ${win.toFixed(1)}" clear`, wx(sol.D) - 52, wy(10) + 34);

      // readouts
      ctx.fillStyle = "rgba(249,250,251,0.55)";
      ctx.font = "500 11px Inter, sans-serif";
      ctx.fillText(`release ${sol.h0.toFixed(1)} ft`, 16, 22);
      ctx.fillText(`speed ${sol.v.toFixed(1)} ft/s`, 16, 38);
      ctx.fillText(`apex ${sol.apex.toFixed(1)} ft`, 16, 54);
      ctx.fillText(`flight ${sol.flight.toFixed(2)} s`, 16, 70);
    };

    if (!animateKey) { draw(1); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min((now - t0) / 800, 1);
      draw(t);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [distance, jumpAngle, releaseHeight, handPlacement, animateKey, compact]);

  return (
    <canvas
      ref={ref}
      width={SW}
      height={SH}
      className="w-full rounded-lg border border-line"
    />
  );
}
