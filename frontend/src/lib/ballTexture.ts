/**
 * Procedural basketball texture: pebbled orange leather with the classic
 * eight-panel seam pattern. Returns a shared THREE.CanvasTexture.
 */
import * as THREE from "three";

const S = 1024;

export function createBallTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;

  // base leather (deep, saturated orange)
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, "#e07a2c");
  g.addColorStop(0.5, "#cf631d");
  g.addColorStop(1, "#b44f14");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // dense pebbling
  for (let i = 0; i < 55000; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const d = Math.random() * 0.5 - 0.25;
    ctx.fillStyle = d < 0 ? `rgba(70,28,4,${-d * 0.55})` : `rgba(255,205,150,${d * 0.5})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // seams (UV sphere: x ≈ longitude, y ≈ latitude)
  ctx.strokeStyle = "#140a04";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";

  // equator seam
  ctx.beginPath();
  ctx.moveTo(0, S / 2);
  ctx.lineTo(S, S / 2);
  ctx.stroke();

  // two longitude seams (pole to pole)
  for (const x of [S * 0.25, S * 0.75]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }

  // curved side seams (the signature curved panels)
  for (const cx of [0, S * 0.5, S]) {
    ctx.beginPath();
    for (let y = 0; y <= S; y += 5) {
      const t = y / S;
      const x = cx + Math.sin(t * Math.PI) * S * 0.13 * (cx === S * 0.5 ? -1 : 1);
      y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // subtle top sheen
  const sheen = ctx.createRadialGradient(S * 0.35, S * 0.3, 10, S * 0.35, S * 0.3, S * 0.5);
  sheen.addColorStop(0, "rgba(255,235,200,0.18)");
  sheen.addColorStop(1, "rgba(255,235,200,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let _cached: THREE.CanvasTexture | null = null;
/** Shared basketball texture (generated once). */
export function getBallTexture(): THREE.CanvasTexture {
  if (!_cached) _cached = createBallTexture();
  return _cached;
}
