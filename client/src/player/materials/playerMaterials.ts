/**
 * PLAYER MATERIALS — every surface a player wears, in one place (mirrors the
 * court's theme.ts approach). Skin uses a soft, low-sheen physical material so it
 * reads as skin (not plastic) under the arena lights; fabrics are matte with a
 * hint of sheen for the jersey's satin; shoes get a light clearcoat.
 *
 * All builders return NEW material instances (a rig owns and disposes its own),
 * while geometry-independent data (the tone palette) is shared constants.
 */
import * as THREE from "three";
import { UniformConfig } from "../config/PlayerConfig";

/** Skin-tone palette, light → deep (index = appearance.skinTone). */
export const SKIN_TONES = [
  "#f0c8a8",
  "#e2b18c",
  "#caa07e",
  "#b08260",
  "#8d6248",
  "#6f4a33",
  "#573823",
  "#3f2818",
] as const;

/**
 * Fine skin detail: pores and a little tonal drift.
 *
 * A single flat colour is what makes a body read as vinyl. Real skin scatters
 * light unevenly at a scale the eye registers even when it cannot resolve it, so
 * this breaks up the specular with a roughness map rather than a colour map,
 * which keeps the tone palette exactly as authored.
 */
let poreMap: THREE.CanvasTexture | null = null;
function skinPores(): THREE.CanvasTexture {
  if (poreMap) return poreMap;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // mostly smooth, with sparse darker pores
    const base = 150 + ((Math.random() * 26) | 0);
    const pore = Math.random() < 0.06 ? -34 : 0;
    const v = Math.max(0, Math.min(255, base + pore));
    const k = i * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  poreMap = tex;
  return tex;
}

export function skinMaterial(toneIndex: number): THREE.MeshPhysicalMaterial {
  const color = SKIN_TONES[Math.min(Math.max(toneIndex, 0), SKIN_TONES.length - 1)];
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.68,
    roughnessMap: skinPores(),
    metalness: 0,
    // Skin is translucent at the edges. Real subsurface scattering is out of
    // scope, but sheen plus a soft clearcoat gives the rim of an arm the warm
    // falloff that a plain standard material never has, and it is the difference
    // between a limb and a painted tube under a single hard court light.
    sheen: 0.35,
    sheenColor: new THREE.Color("#ff9a76"),
    sheenRoughness: 0.85,
    clearcoat: 0.16,
    clearcoatRoughness: 0.72,
  });
}

/**
 * Jersey mesh weave. A flat colour reads as plastic no matter how the sheen is
 * tuned, because real kit fabric breaks up specular at a scale the eye notices.
 * This is a small tiling roughness map, so the highlight is broken up per-pixel
 * without adding geometry or a colour texture that would fight the kit palette.
 */
let weaveMap: THREE.CanvasTexture | null = null;
function fabricWeave(): THREE.CanvasTexture {
  if (weaveMap) return weaveMap;
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // basketball mesh: fine holes on a grid, plus a little noise so it is not
      // mechanically regular
      const hole = (x % 4 < 2) !== (y % 4 < 2) ? 26 : 0;
      const n = (Math.random() * 18) | 0;
      const v = 190 + hole + n;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  weaveMap = t;
  return t;
}

export function fabricMaterial(color: string, sheen = 0.25): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.78,
    roughnessMap: fabricWeave(),
    metalness: 0,
    sheen,
    sheenColor: new THREE.Color("#ffffff"),
    sheenRoughness: 0.6,
  });
}

export function shoeMaterial(color: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.42,
    metalness: 0.05,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
  });
}

export function hairMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
}

/** Kit → resolved jersey/shorts/trim colours (home = light body, away = colour). */
export function resolveKit(u: UniformConfig) {
  const body = u.kit === "home" ? u.primaryColor : u.secondaryColor;
  const trim = u.kit === "home" ? u.secondaryColor : u.primaryColor;
  return { body, trim };
}

/**
 * Jersey-number decal: number in trim, with the WHITE keyline real twill numbers
 * carry between the digit and the body.
 *
 * A single-stroke outline in the body colour, which is what this used to draw,
 * is invisible by definition — it is the same colour as what sits behind it — so
 * purple on gold had no separation at all and muddied at distance. Two strokes,
 * widest first, give the keyline the eye expects.
 */
export function numberTexture(
  num: string, color: string, outline: string, keyline = "#ffffff",
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = "700 150px 'Arial Black', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // outer trim edge, then the keyline, then the digit
  ctx.lineWidth = 22;
  ctx.strokeStyle = outline;
  ctx.strokeText(num, 128, 138);
  ctx.lineWidth = 13;
  ctx.strokeStyle = keyline;
  ctx.strokeText(num, 128, 138);
  ctx.fillStyle = color;
  ctx.fillText(num, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Chest wordmark, arched the way a team name is set across a jersey front.
 *
 * The number alone reads as a training bib. The arched wordmark above it is the
 * single detail that makes a tank identifiable as a team's, which is why it is
 * worth the extra plane.
 */
export function wordmarkTexture(
  text: string, color: string, keyline = "#ffffff",
): THREE.CanvasTexture {
  const W = 512, H = 200;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  ctx.font = "700 92px 'Arial Black', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // Set each glyph on an arc: rotate about a centre well below the canvas so the
  // curve is shallow, which is how a real chest wordmark sits.
  const chars = [...text];
  const radius = 300;
  const spread = 0.13;                       // radians per character
  const start = -((chars.length - 1) / 2) * spread;
  ctx.save();
  ctx.translate(W / 2, H + radius - 96);
  chars.forEach((ch, i) => {
    ctx.save();
    ctx.rotate(start + i * spread);
    ctx.translate(0, -radius);
    ctx.lineWidth = 12;
    ctx.strokeStyle = keyline;
    ctx.strokeText(ch, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
