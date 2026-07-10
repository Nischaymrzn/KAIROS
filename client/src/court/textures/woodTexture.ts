/**
 * Procedural hardwood texture → THREE.CanvasTexture.
 *
 * Draws a continuous maple floor: lengthwise planks (running along world X), each
 * plank with its own tone, subtle grain streaks, dark seams between planks, and a
 * soft central sheen. Tuned to the warm reddish hardwood in `designs/floor.png`.
 * One texture covers the whole visible floor (no tiling → no seams).
 */
import * as THREE from "three";
import { COLORS } from "../../constants/theme";

/** Deterministic pseudo-random so the floor is identical every reload. */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export interface WoodOptions {
  /** floor extent in feet, used to keep plank size physically sensible */
  widthFt: number;
  heightFt: number;
  /** pixels per foot (detail) */
  ppf?: number;
  /** plank width in feet (planks run along X → drawn as horizontal rows here) */
  plankFt?: number;
}

export function createWoodTexture(opts: WoodOptions): THREE.CanvasTexture {
  const ppf = opts.ppf ?? 26;
  const plankFt = opts.plankFt ?? 0.55;
  const W = Math.round(opts.widthFt * ppf);
  const H = Math.round(opts.heightFt * ppf);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rand = rng(20260713);

  // base vertical gradient — a light maple, marginally brighter across the middle
  // like light falling across a glossy floor (kept light so grain stays visible)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, COLORS.woodBase);
  g.addColorStop(0.5, COLORS.woodLight);
  g.addColorStop(1, COLORS.woodBase);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // planks (horizontal rows = boards running along the length of the court)
  const plankPx = plankFt * ppf;
  for (let y = 0, i = 0; y < H; y += plankPx, i++) {
    // per-plank tone variation (clearly visible board-to-board differences)
    const t = rand();
    const shade = (t - 0.5) * 0.9; // -0.45..0.45
    const col = shade < 0
      ? `rgba(120,80,42,${Math.abs(shade) * 0.55})`
      : `rgba(240,210,158,${shade * 0.5})`;
    ctx.fillStyle = col;
    ctx.fillRect(0, y, W, plankPx);

    // grain streaks within the plank
    const streaks = Math.floor(W / 90);
    ctx.strokeStyle = COLORS.woodGrain;
    ctx.lineWidth = 1;
    for (let s = 0; s < streaks; s++) {
      const sx = rand() * W;
      const sy = y + rand() * plankPx;
      const len = 40 + rand() * 120;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(
        sx + len * 0.4, sy + (rand() - 0.5) * 2,
        sx + len * 0.7, sy + (rand() - 0.5) * 2,
        sx + len, sy + (rand() - 0.5) * 3
      );
      ctx.stroke();
    }

    // occasional short board-end butt joint (staggered like a real floor)
    if (rand() > 0.55) {
      const jx = rand() * W;
      ctx.strokeStyle = "rgba(30,17,8,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(jx, y);
      ctx.lineTo(jx, y + plankPx);
      ctx.stroke();
    }

    // seam shadow + tiny highlight bevel between planks
    ctx.strokeStyle = COLORS.woodSeam;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,225,180,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 1.5);
    ctx.lineTo(W, y + 1.5);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}
