/**
 * Procedurally draws an NBA court (full or HALF) onto a 2D canvas and returns a
 * THREE.CanvasTexture, to exact dimensions from courtDimensions.ts.
 * Realistic light-maple hardwood with crisp white markings.
 */
import * as THREE from "three";
import * as D from "./courtDimensions";

const PPF = 34; // pixels per foot

interface Ctx {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  fx: (x: number) => number;
  fz: (z: number) => number;
  fr: (ft: number) => number;
}

function woodFloor(c: Ctx) {
  const { ctx, W, H } = c;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#e4ca98");
  g.addColorStop(0.5, "#dcbe88");
  g.addColorStop(1, "#d2b17b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const plankH = c.fr(0.33);
  for (let y = 0, i = 0; y < H; y += plankH, i++) {
    const tone = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const shade = (tone - 0.5) * 0.06;
    ctx.fillStyle = shade < 0 ? `rgba(120,85,45,${-shade})` : `rgba(255,238,200,${shade})`;
    ctx.fillRect(0, y, W, plankH);
    ctx.strokeStyle = "rgba(110,80,45,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(120,85,45,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 1000; i++) {
    const y = Math.random() * H;
    const x = Math.random() * W;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 60 + 20, y + (Math.random() * 2 - 1));
    ctx.stroke();
  }
  const sheen = ctx.createLinearGradient(0, H * 0.2, 0, H * 0.8);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,250,235,0.10)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
}

function setLine(c: Ctx) {
  c.ctx.strokeStyle = "rgba(250,250,250,0.96)";
  c.ctx.fillStyle = "rgba(250,250,250,0.96)";
  c.ctx.lineWidth = c.fr(D.LINE_WIDTH);
  c.ctx.lineCap = "butt";
  c.ctx.lineJoin = "round";
}

function arc(c: Ctx, cx: number, cz: number, r: number, a0: number, a1: number, dashed = false) {
  const { ctx } = c;
  if (dashed) ctx.setLineDash([c.fr(0.9), c.fr(0.7)]);
  ctx.beginPath();
  const steps = 170;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const px = c.fx(cx + r * Math.cos(a));
    const py = c.fz(cz + r * Math.sin(a));
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function seg(c: Ctx, x0: number, z0: number, x1: number, z1: number) {
  c.ctx.beginPath();
  c.ctx.moveTo(c.fx(x0), c.fz(z0));
  c.ctx.lineTo(c.fx(x1), c.fz(z1));
  c.ctx.stroke();
}

function rect(c: Ctx, x0: number, z0: number, x1: number, z1: number) {
  c.ctx.beginPath();
  c.ctx.rect(c.fx(x0), c.fz(z0), c.fx(x1) - c.fx(x0), c.fz(z1) - c.fz(z0));
  c.ctx.stroke();
}

function drawEnd(c: Ctx, end: -1 | 1) {
  const baseline = D.baselineX(end);
  const bx = D.basketX(end);
  const ftLineX = baseline - end * D.FT_FROM_BASELINE;
  const backboardX = baseline - end * D.BACKBOARD_FROM_BASELINE;
  const meetX = bx - end * D.cornerArcMeetX;
  const base = end === -1 ? 0 : Math.PI;
  const phi = Math.atan2(D.CORNER_3_Z, D.cornerArcMeetX);
  const half = D.PAINT_WIDTH / 2;

  // stained paint
  c.ctx.save();
  c.ctx.fillStyle = "rgba(150,108,58,0.32)";
  c.ctx.fillRect(c.fx(Math.min(baseline, ftLineX)), c.fz(-half),
    Math.abs(c.fx(ftLineX) - c.fx(baseline)), c.fz(half) - c.fz(-half));
  c.ctx.restore();

  rect(c, baseline, -half, ftLineX, half);
  arc(c, ftLineX, 0, D.FT_CIRCLE_RADIUS, base - Math.PI / 2, base + Math.PI / 2);
  arc(c, ftLineX, 0, D.FT_CIRCLE_RADIUS, base + Math.PI / 2, base + (3 * Math.PI) / 2, true);
  arc(c, bx, 0, D.RESTRICTED_RADIUS, base - Math.PI / 2, base + Math.PI / 2);
  seg(c, backboardX, -D.BACKBOARD_WIDTH / 2, backboardX, D.BACKBOARD_WIDTH / 2);
  c.ctx.beginPath();
  c.ctx.arc(c.fx(bx), c.fz(0), c.fr(D.RIM_RADIUS), 0, Math.PI * 2);
  c.ctx.stroke();
  seg(c, baseline, D.CORNER_3_Z, meetX, D.CORNER_3_Z);
  seg(c, baseline, -D.CORNER_3_Z, meetX, -D.CORNER_3_Z);
  arc(c, bx, 0, D.THREE_RADIUS, base - phi, base + phi);
}

function makeCanvas(xMin: number, xMax: number): Ctx {
  const lenFt = xMax - xMin;
  const W = Math.round(lenFt * PPF);
  const H = Math.round(D.COURT_WIDTH * PPF);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  return {
    ctx: canvas.getContext("2d")!,
    W, H,
    fx: (x) => ((x - xMin) / lenFt) * W,
    fz: (z) => ((z + D.HALF_WIDTH) / D.COURT_WIDTH) * H,
    fr: (ft) => ft * PPF,
  };
}

function finalize(c: Ctx): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c.ctx.canvas);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Full court (both ends). */
export function createCourtTexture(): THREE.CanvasTexture {
  const c = makeCanvas(-D.HALF_LENGTH, D.HALF_LENGTH);
  woodFloor(c);
  setLine(c);
  rect(c, -D.HALF_LENGTH + 0.5, -D.HALF_WIDTH + 0.5, D.HALF_LENGTH - 0.5, D.HALF_WIDTH - 0.5);
  seg(c, 0, -D.HALF_WIDTH + 0.5, 0, D.HALF_WIDTH - 0.5);
  arc(c, 0, 0, D.CENTER_CIRCLE_RADIUS, 0, Math.PI * 2);
  arc(c, 0, 0, D.CENTER_INNER_RADIUS, 0, Math.PI * 2);
  drawEnd(c, -1);
  drawEnd(c, 1);
  return finalize(c);
}

/** Half court: left end (basket) up to the division line at x=0. */
export function createHalfCourtTexture(): THREE.CanvasTexture {
  const c = makeCanvas(-D.HALF_LENGTH, 0);
  woodFloor(c);
  setLine(c);
  // boundary (baseline, two sidelines, division line at x=0)
  rect(c, -D.HALF_LENGTH + 0.5, -D.HALF_WIDTH + 0.5, -0.25, D.HALF_WIDTH - 0.5);
  // center-circle half (the part inside this half-court)
  arc(c, 0, 0, D.CENTER_CIRCLE_RADIUS, Math.PI / 2, (3 * Math.PI) / 2);
  arc(c, 0, 0, D.CENTER_INNER_RADIUS, Math.PI / 2, (3 * Math.PI) / 2);
  drawEnd(c, -1);
  return finalize(c);
}
