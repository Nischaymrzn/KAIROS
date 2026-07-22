/**
 * CHART PALETTE — the colours every visualisation draws from, and nothing else.
 *
 * These are not taste. Each set was run through the dataviz validator against the
 * app's dark chart surface (#101420) and only kept once it passed on every check:
 * OKLCH lightness band, chroma floor, colour-vision separation, normal-vision
 * separation, and contrast against the surface.
 *
 * WHAT FAILED ON THE WAY HERE, so nobody re-proposes it:
 *
 *  · The obvious five-hue set taken from the UI tokens (brand orange, blue,
 *    green, yellow, red) failed the lightness band outright: orange, green and
 *    yellow sit at L 0.72-0.85 against a dark band of 0.48-0.67.
 *  · Darkening them into band turned the yellow olive, which then collided with
 *    the red at deutan ΔE 2.6 and with the green at normal-vision ΔE 14.3. Two
 *    series a full-colour reader cannot separate is worse than two series that
 *    share a hue on purpose.
 *
 * The fix was not a better fifth hue. It was noticing that nothing in this app
 * actually needs five categorical series. Teams are two. Make rate is magnitude,
 * which wants ONE hue light to dark, never a rainbow — the 3D floor overlay used
 * blue → yellow → red and was replaced for exactly that reason.
 */

/**
 * CATEGORICAL — identity, assigned in fixed order and never cycled.
 * Validated: protan ΔE 30.1, normal ΔE 34.3, passes in light and dark.
 */
export const TEAM = {
  /** the team in possession */
  offense: "#4c6ef5",
  /** the team defending it */
  defense: "#dc7436",
} as const;

/**
 * SEQUENTIAL — magnitude. One hue, monotonic lightness (L 0.299 → 0.805), so it
 * still reads as an ordered scale in greyscale and under any colour deficiency.
 */
export const MAKE_RATE = ["#3a2a18", "#6b4519", "#a3651d", "#d18a2c", "#f5b04b"] as const;

/** Ink. Text never wears a series colour; a mark beside it carries identity. */
export const INK = {
  primary: "#eef2fa",
  secondary: "#8fa1bd",
  muted: "#5c6d88",
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.16)",
  surface: "#101420",
} as const;

/** Reserved status colours. Never reused as "series 3". */
export const STATUS = { good: "#35c26e", bad: "#eb5757" } as const;

/**
 * Sample the sequential ramp. `lo`/`hi` bound the domain so a grid of make rates
 * spends the whole ramp on the range that actually occurs rather than compressing
 * every real value into two adjacent steps.
 */
export function rateColor(rate: number, lo = 0.2, hi = 0.58): string {
  const f = Math.min(Math.max((rate - lo) / (hi - lo), 0), 1);
  const i = f * (MAKE_RATE.length - 1);
  const a = MAKE_RATE[Math.floor(i)];
  const b = MAKE_RATE[Math.min(Math.ceil(i), MAKE_RATE.length - 1)];
  return mix(a, b, i - Math.floor(i));
}

/** Linear blend in sRGB. Close enough between adjacent steps of one hue. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Readable ink for a label sitting ON a ramp colour. */
export function inkOn(rate: number, lo = 0.2, hi = 0.58): string {
  return (rate - lo) / (hi - lo) > 0.55 ? "#1a1206" : INK.primary;
}
