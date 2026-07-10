/**
 * Procedural court-markings texture → THREE.CanvasTexture (TRANSPARENT).
 *
 * Draws only the paint + lines onto a transparent canvas; the wood shows through
 * everywhere else. This overlays the hardwood on a slightly raised plane, so the
 * floor stays one continuous piece of wood while the markings sit crisply on top.
 *
 * Geometry is ported from the previous frontend's proven court code (the maths was
 * already validated) and re-tuned to `designs/floor.png`: royal-blue lane, warm-
 * white interior lines, blue boundary/division lines, plus NBA lane hash marks.
 */
import * as THREE from "three";
import * as D from "../../constants/dimensions";
import { COLORS } from "../../constants/theme";

const PPF = 42; // pixels per foot — crisp lines

interface Ctx {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  fx: (x: number) => number;
  fz: (z: number) => number;
  fr: (ft: number) => number;
}

function stroke(c: Ctx, color: string, widthFt = D.LINE_WIDTH * 1.4) {
  c.ctx.strokeStyle = color;
  c.ctx.fillStyle = color;
  c.ctx.lineWidth = c.fr(widthFt);
  c.ctx.lineCap = "butt";
  c.ctx.lineJoin = "round";
}

function arc(c: Ctx, cx: number, cz: number, r: number, a0: number, a1: number, dashed = false) {
  const { ctx } = c;
  if (dashed) ctx.setLineDash([c.fr(0.9), c.fr(0.7)]);
  ctx.beginPath();
  const steps = 220;
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

/** Everything for one basket end (paint, key, FT circle, restricted, 3pt, hashes). */
function drawEnd(c: Ctx, end: -1 | 1) {
  const baseline = D.baselineX(end);
  const bx = D.basketX(end);
  const ftLineX = baseline - end * D.FT_FROM_BASELINE;
  const backboardX = baseline - end * D.BACKBOARD_FROM_BASELINE;
  const meetX = bx - end * D.cornerArcMeetX;
  const base = end === -1 ? 0 : Math.PI;
  const phi = Math.atan2(D.CORNER_3_Z, D.cornerArcMeetX);
  const half = D.PAINT_WIDTH / 2;

  // --- royal-blue painted key (opaque fill over the wood) ---
  const keyX0 = Math.min(baseline, ftLineX);
  const keyGrad = c.ctx.createLinearGradient(c.fx(keyX0), 0, c.fx(ftLineX), 0);
  keyGrad.addColorStop(0, COLORS.keyFillEdge);
  keyGrad.addColorStop(0.5, COLORS.keyFill);
  keyGrad.addColorStop(1, COLORS.keyFillEdge);
  c.ctx.fillStyle = keyGrad;
  c.ctx.fillRect(
    c.fx(keyX0),
    c.fz(-half),
    Math.abs(c.fx(ftLineX) - c.fx(baseline)),
    c.fz(half) - c.fz(-half)
  );

  // --- white interior markings ---
  stroke(c, COLORS.line);
  rect(c, baseline, -half, ftLineX, half); // key outline
  arc(c, ftLineX, 0, D.FT_CIRCLE_RADIUS, base - Math.PI / 2, base + Math.PI / 2); // FT circle (solid top)
  arc(c, ftLineX, 0, D.FT_CIRCLE_RADIUS, base + Math.PI / 2, base + (3 * Math.PI) / 2, true); // dashed bottom
  arc(c, bx, 0, D.RESTRICTED_RADIUS, base - Math.PI / 2, base + Math.PI / 2); // restricted-area arc

  // lane hash / block marks on both sides of the lane
  for (const distFt of D.LANE_MARKS_FROM_BASELINE) {
    const mx = baseline - end * distFt;
    seg(c, mx, half, mx, half + D.LANE_MARK_LENGTH); // +Z side
    seg(c, mx, -half, mx, -half - D.LANE_MARK_LENGTH); // -Z side
  }

  // backboard tick + rim ring on the floor
  seg(c, backboardX, -D.BACKBOARD_WIDTH / 2, backboardX, D.BACKBOARD_WIDTH / 2);
  c.ctx.beginPath();
  c.ctx.arc(c.fx(bx), c.fz(0), c.fr(D.RIM_RADIUS), 0, Math.PI * 2);
  c.ctx.stroke();

  // 3-point line: two straight corner segments + the arc
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
    W,
    H,
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

/**
 * Half-court markings: left end (basket) up to the division line at x = 0.
 * The canvas maps exactly to a 47 (x) × 50 (z) ft plane centred at x = -23.5.
 */
export function createHalfCourtMarkings(): THREE.CanvasTexture {
  const c = makeCanvas(-D.HALF_LENGTH, 0);

  // blue boundary: baseline, two sidelines, division line at x = 0
  stroke(c, COLORS.boundary, D.LINE_WIDTH * 1.7);
  rect(c, -D.HALF_LENGTH + 0.5, -D.HALF_WIDTH + 0.5, -0.25, D.HALF_WIDTH - 0.5);

  // centre-circle half that lies inside this half-court
  stroke(c, COLORS.line);
  arc(c, 0, 0, D.CENTER_CIRCLE_RADIUS, Math.PI / 2, (3 * Math.PI) / 2);
  arc(c, 0, 0, D.CENTER_INNER_RADIUS, Math.PI / 2, (3 * Math.PI) / 2);

  drawEnd(c, -1);
  return finalize(c);
}
