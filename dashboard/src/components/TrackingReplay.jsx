import { useEffect, useRef, useState } from "react";
import { W, H, PX, BASKET } from "./CourtCanvas";

/**
 * SportVU-style replay: the approach into the shot, drawn the way tracking data
 * is normally viewed. A dot per tracked position, a trail behind it, and the
 * path laid out underneath so the shape of the move is readable while it plays.
 *
 * Only the shooter is tracked through time in this corpus. The other nine
 * players exist in it as a single frame at release, so a full ten-dot replay is
 * not reconstructible from the extracted artifacts. Drawing nine dots anyway,
 * interpolated from one frame, would look like tracking data without being it,
 * so the panel shows what exists and says what does not.
 *
 * Waypoints carry real timestamps, so playback runs on the model's own clock
 * rather than a fixed frame rate.
 */
const SPEED_LO = "#3b82f6";
const SPEED_HI = "#ef4444";

/** Blend blue to red by speed, so a sprint and a walk are distinguishable. */
function speedColor(v, max) {
  const t = Math.max(0, Math.min(1, v / Math.max(max, 1)));
  const lo = [59, 130, 246];
  const hi = [239, 68, 68];
  const c = lo.map((l, i) => Math.round(l + (hi[i] - l) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function TrackingReplay({ waypoints, playKey, rate = 0.6 }) {
  const ref = useRef(null);
  const raf = useRef(0);
  const [t, setT] = useState(0);

  const pts = waypoints ?? [];
  const total = pts.length ? pts[pts.length - 1].t : 0;
  const maxSpeed = pts.length ? Math.max(...pts.map((w) => w.speed)) : 1;

  // court feet -> canvas pixels. The backend's chart frame puts x lateral and
  // y as depth from the baseline, which is the same convention the court canvas
  // uses, so this is a scale rather than a projection.
  const toPx = (w) => ({ x: BASKET.x + w.x * PX, y: BASKET.y + w.y * PX });

  useEffect(() => {
    if (!pts.length || !playKey) return;
    const t0 = performance.now();
    const step = (now) => {
      const e = ((now - t0) / 1000) * rate;
      setT(Math.min(e, total));
      if (e < total) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playKey, total, rate, pts.length]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0f1420";
    ctx.fillRect(0, 0, W, H);

    // court reference: baseline, arc, rim
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.beginPath();
    ctx.arc(BASKET.x, BASKET.y, 23.75 * PX, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(BASKET.x, BASKET.y, 0.75 * PX, 0, Math.PI * 2);
    ctx.stroke();

    if (!pts.length) {
      ctx.fillStyle = "rgba(249,250,251,0.4)";
      ctx.font = "500 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("no path loaded", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }

    // the whole path, faint, so the shape is visible before it plays
    ctx.strokeStyle = "rgba(148,163,184,0.28)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((w, i) => {
      const p = toPx(w);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();

    // every tracked position as a dot, tinted by speed
    pts.forEach((w) => {
      const p = toPx(w);
      ctx.fillStyle = speedColor(w.speed, maxSpeed);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // played portion, solid, plus the live dot
    const upto = pts.filter((w) => w.t <= t);
    if (upto.length > 1) {
      ctx.lineWidth = 3;
      for (let i = 1; i < upto.length; i++) {
        const a = toPx(upto[i - 1]);
        const b = toPx(upto[i]);
        ctx.strokeStyle = speedColor(upto[i].speed, maxSpeed);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    const head = upto.length ? upto[upto.length - 1] : pts[0];
    const hp = toPx(head);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#f9fafb";
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = speedColor(head.speed, maxSpeed);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // readouts
    ctx.fillStyle = "rgba(249,250,251,0.6)";
    ctx.font = "600 11px Inter, sans-serif";
    ctx.fillText(`${head.speed.toFixed(1)} ft/s`, 12, 22);
    ctx.fillText(`${t.toFixed(2)} / ${total.toFixed(2)} s`, 12, 38);

    // speed legend
    const lx = W - 92;
    const g = ctx.createLinearGradient(lx, 0, lx + 60, 0);
    g.addColorStop(0, SPEED_LO);
    g.addColorStop(1, SPEED_HI);
    ctx.fillStyle = g;
    ctx.fillRect(lx, 14, 60, 6);
    ctx.fillStyle = "rgba(249,250,251,0.5)";
    ctx.font = "500 9px Inter, sans-serif";
    ctx.fillText("slow", lx, 32);
    ctx.fillText(`${maxSpeed.toFixed(0)} ft/s`, lx + 28, 32);
  }, [pts, t, total, maxSpeed]);

  return <canvas ref={ref} width={W} height={H} className="w-full max-w-[500px] rounded-lg border border-line" />;
}
