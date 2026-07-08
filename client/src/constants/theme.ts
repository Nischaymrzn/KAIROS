/**
 * Visual theme — every colour used by the court lives here so the whole scene can
 * be re-tuned from one place (and future layers stay consistent). Values are
 * chosen to match the reference renders in `designs/` (warm reddish hardwood,
 * royal-blue painted key, warm-white lines, portable blue-based hoop).
 */

export const COLORS = {
  // hardwood — real NBA light honey maple (bright, warm, clearly grained)
  woodBase: "#c79a5f",
  woodLight: "#e7c88d",
  woodDark: "#a9793f",
  woodSeam: "rgba(120,82,42,0.45)",
  woodGrain: "rgba(120,80,42,0.13)",
  woodSheen: "rgba(255,246,222,0.16)",
  floorEdge: "#8a5f30",

  // court markings
  keyFill: "#3654bd", // royal-blue painted lane (lightened)
  keyFillEdge: "#2c459c", // slight inner shade for depth
  line: "rgba(246,244,236,0.98)", // warm white
  boundary: "#3d4fc4", // blue sideline / baseline / division line

  // hoop
  // The rim is powder-coated steel in a red-leaning orange, not the yellow-orange
  // a ball is. Lighting supplies the highlight now that the ring no longer
  // illuminates itself, so the base colour can sit at its true value.
  rim: "#e2571c",
  rimEmissive: "#8a3610", // retained: <Backboard/> still reads it for the target square
  glass: "#eaf5ff",
  square: "#e8642a",
  metalDark: "#2b3340",
  metalMid: "#3a4557",
  padNavy: "#233079", // portable-base padding (matches reference base)
  netColor: "#f6f6f2",

  // scene backdrop — a real building at game time. The bowl is DARK and the
  // court is the brightest surface in it. The previous palette lit the house up
  // like a practice facility, which flattened everything: light grey concrete,
  // light grey seats and a light grey ceiling gave the eye nothing to prefer,
  // and the hardwood had to compete with its own surroundings.
  skyTop: "#0b0e16",      // ceiling shadow
  skyHorizon: "#1a2233",  // toward the concourse
  bgTop: "#0b0e16",
  bgBottom: "#080a11",

  // arena bowl — house lights down, court lit
  arena: {
    concrete: "#2c3446",     // riser faces catching a little spill
    concreteDark: "#1d2432",
    seat: "#2f4bb4",         // team blue, the colour a bowl reads as from the floor
    seatShade: "#263d94",
    barrier: "#11151f",      // courtside dasher
    led: "#0d1119",          // LED-board body; the ribbon emissive rides on it
    rail: "#7c869b",
    concourse: "#0d1119",
    trim: "#3d63e0",         // ribbon glow
  },
} as const;

/** Physical-material presets, kept together so surfaces read consistently. */
export const MATERIALS = {
  hardwood: { roughness: 0.5, metalness: 0.0, clearcoat: 0.22, clearcoatRoughness: 0.34 },
  markings: { roughness: 0.44, metalness: 0.0 },
  glass: { roughness: 0.06, metalness: 0.0, transmission: 0.7, thickness: 0.25, opacity: 0.32 },
  rim: { roughness: 0.35, metalness: 0.55, emissiveIntensity: 0.25 },
  metal: { roughness: 0.45, metalness: 0.6 },
  pad: { roughness: 0.7, metalness: 0.0 },
} as const;
