import { useEffect, useRef } from "react";
import { W, H, BASKET, PX } from "./CourtCanvas";
import { ZONES } from "../mockData";

/**
 * Court with the five zones shaded by the selected metric. Zones are drawn as
 * filled regions clipped to the same geometry CourtCanvas uses, so the heatmap
 * and the predictor agree about where a corner three ends.
 */
const REGION = {
  restricted: (ctx) => {
    ctx.beginPath();
    ctx.arc(BASKET.x, BASKET.y, 4 * PX, 0, Math.PI * 2);
  },
  paint: (ctx) => {
    ctx.beginPath();
    ctx.rect(BASKET.x - 8 * PX, 1, 16 * PX, 19 * PX);
  },
  midrange: (ctx) => {
    ctx.beginPath();
    ctx.arc(BASKET.x, BASKET.y, 23.75 * PX, 0, Math.PI, false);
  },
  corner3: (ctx) => {
    ctx.beginPath();
    ctx.rect(1, 1, BASKET.x - 22 * PX - 1, 14 * PX);
    ctx.rect(BASKET.x + 22 * PX, 1, W - (BASKET.x + 22 * PX) - 1, 14 * PX);
  },
  break3: (ctx) => {
    ctx.beginPath();
    ctx.rect(1, 1, W - 2, H - 2);
  },
};

const ORDER = ["break3", "midrange", "corner3", "paint", "restricted"];

function shade(v, min, max) {
  const t = max > min ? (v - min) / (max - min) : 0.5;
  const hue = 200 - t * 160; // blue (low) to orange/red (high)
  return `hsla(${hue}, 70%, 50%, ${0.18 + t * 0.42})`;
}

export function ZoneHeatmap({ zones, mode = "frequency", onZoneClick }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#161b28";
    ctx.fillRect(0, 0, W, H);

    const val = (z) =>
      mode === "frequency" ? z.attempts : mode === "actual" ? z.actual : z.predicted;
    const vals = zones.map(val);
    const min = Math.min(...vals), max = Math.max(...vals);

    for (const key of ORDER) {
      const z = zones.find((x) => x.zone === key);
      if (!z) continue;
      ctx.save();
      REGION[key](ctx);
      ctx.clip();
      ctx.fillStyle = shade(val(z), min, max);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // court lines on top
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.strokeRect(BASKET.x - 8 * PX, 1, 16 * PX, 19 * PX);
    const r = 23.75 * PX, cz = 22 * PX;
    const meetY = BASKET.y + Math.sqrt(r * r - cz * cz);
    ctx.beginPath(); ctx.moveTo(BASKET.x - cz, 1); ctx.lineTo(BASKET.x - cz, meetY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(BASKET.x + cz, 1); ctx.lineTo(BASKET.x + cz, meetY); ctx.stroke();
    ctx.beginPath();
    ctx.arc(BASKET.x, BASKET.y, r, Math.acos(cz / r), Math.PI - Math.acos(cz / r));
    ctx.stroke();
    ctx.strokeStyle = "#f97316";
    ctx.beginPath(); ctx.arc(BASKET.x, BASKET.y, 0.75 * PX, 0, Math.PI * 2); ctx.stroke();

    // labels
    ctx.font = "600 11px Inter, sans-serif";
    const at = {
      restricted: [BASKET.x, BASKET.y + 62], paint: [BASKET.x, 150],
      midrange: [BASKET.x, 250], corner3: [60, 90], break3: [BASKET.x, 400],
    };
    for (const z of zones) {
      const [x, y] = at[z.zone] ?? [0, 0];
      const v = mode === "frequency" ? `${z.attempts}` :
        `${((mode === "actual" ? z.actual : z.predicted) * 100).toFixed(1)}%`;
      ctx.fillStyle = "rgba(249,250,251,0.92)";
      ctx.textAlign = "center";
      ctx.fillText(ZONES[z.zone].label, x, y);
      ctx.fillStyle = "rgba(249,250,251,0.7)";
      ctx.fillText(v, x, y + 14);
    }
    ctx.textAlign = "left";
  }, [zones, mode]);

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      className="w-full max-w-[500px] rounded-lg border border-line cursor-pointer"
      onClick={(e) => {
        const r = ref.current.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W;
        const y = ((e.clientY - r.top) / r.height) * H;
        const d = Math.hypot((x - BASKET.x) / PX, (y - BASKET.y) / PX);
        const corner = Math.abs((x - BASKET.x) / PX) >= 22 && (y - BASKET.y) / PX <= 14;
        const zone = d >= 23.75 || (corner && d >= 22) ? (corner ? "corner3" : "break3")
          : d < 4 ? "restricted"
          : Math.abs((x - BASKET.x) / PX) <= 8 && (y - BASKET.y) / PX <= 19 ? "paint" : "midrange";
        onZoneClick?.(zone);
      }}
    />
  );
}
