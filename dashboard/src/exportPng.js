import { W, H } from "./components/CourtCanvas";

const PAD = 24;
const GAP = 20;
const HEAD = 96;
const ROW = 26;

const INK = {
  bg: "#0d1117",
  panel: "#161b28",
  line: "#2a3040",
  primary: "#f9fafb",
  secondary: "#9ca3af",
  muted: "#6b7280",
  a: "#2dd4bf",
  b: "#22c55e",
};

function text(ctx, s, x, y, { size = 13, weight = 400, color = INK.primary, align = "left" } = {}) {
  ctx.font = `${weight} ${size}px "Open Sans", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
  ctx.textAlign = "left";
}

/**
 * Composites both court canvases and the comparison table into a single PNG.
 *
 * The two courts are copied straight off the live canvases rather than redrawn,
 * so the export is exactly what is on screen, marker positions and all. The
 * table is laid out here because it lives in the DOM and there is no way to
 * rasterise DOM in a canvas without pulling in a whole renderer.
 */
export function exportComparison({ canvasA, canvasB, rows, summary }) {
  if (!canvasA || !canvasB) return false;

  const colW = W;
  const width = PAD * 2 + colW * 2 + GAP;
  const tableTop = HEAD + H + 44;
  const height = tableTop + ROW * (rows.length + 1) + PAD + 28;

  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");

  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, width, height);

  text(ctx, "HoopIQ — Scenario Comparison", PAD, 34, { size: 19, weight: 700 });
  text(ctx, summary, PAD, 56, { size: 12, color: INK.secondary });
  text(ctx, new Date().toLocaleString(), width - PAD, 34, { size: 11, color: INK.muted, align: "right" });

  const xA = PAD;
  const xB = PAD + colW + GAP;
  text(ctx, "Scenario A", xA, HEAD - 10, { size: 12, weight: 600, color: INK.a });
  text(ctx, "Scenario B", xB, HEAD - 10, { size: 12, weight: 600, color: INK.b });
  ctx.drawImage(canvasA, xA, HEAD);
  ctx.drawImage(canvasB, xB, HEAD);

  const cols = [PAD, PAD + 260, PAD + 420, PAD + 560];
  let y = tableTop;
  text(ctx, "Feature", cols[0], y, { size: 11, weight: 600, color: INK.muted });
  text(ctx, "A", cols[1], y, { size: 11, weight: 600, color: INK.muted, align: "right" });
  text(ctx, "B", cols[2], y, { size: 11, weight: 600, color: INK.muted, align: "right" });
  text(ctx, "Favours", cols[3], y, { size: 11, weight: 600, color: INK.muted, align: "right" });

  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y + 8);
  ctx.lineTo(width - PAD, y + 8);
  ctx.stroke();

  for (const r of rows) {
    y += ROW;
    text(ctx, r.label, cols[0], y, { size: 12, color: INK.secondary });
    text(ctx, r.a, cols[1], y, { size: 12, align: "right" });
    text(ctx, r.b, cols[2], y, { size: 12, align: "right" });
    text(ctx, r.fav, cols[3], y, {
      size: 12,
      weight: 600,
      align: "right",
      color: r.fav === "A" ? INK.a : r.fav === "B" ? INK.b : INK.muted,
    });
  }

  text(ctx, "Probabilities from the HoopIQ v7 model. Advisory only.", PAD, height - 14, {
    size: 10,
    color: INK.muted,
  });

  const link = document.createElement("a");
  link.download = `hoopiq-comparison-${Date.now()}.png`;
  link.href = cv.toDataURL("image/png");
  link.click();
  return true;
}
