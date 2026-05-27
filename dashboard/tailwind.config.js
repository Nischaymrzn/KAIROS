/** @type {import('tailwindcss').Config} */

// Two naming schemes point at one palette on purpose. The `bg.*`, `txt.*`,
// `line` and `accent.*` names are what the existing components already use, so
// remapping their VALUES here restyles the whole app without touching a single
// component. The `border.*`, `brand.*` and `quality.*` names are the vocabulary
// new components are written against. Same colours either way, so the two can
// sit next to each other without drifting.
const palette = {
  base: "#07090F",
  surface: "#0D1117",
  raised: "#141B24",
  hover: "#1A2332",
  active: "#1F2B3E",

  borderSubtle: "#1C2A3A",
  borderDefault: "#243347",
  borderStrong: "#2E4260",

  textPrimary: "#EDF2FF",
  textSecondary: "#7B93B4",
  textMuted: "#3D5470",
  textInverse: "#07090F",

  brand: "#F97316",
  brandDim: "#C2530A",
};

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // vocabulary the existing components use
        bg: {
          primary: palette.base,
          secondary: palette.surface,
          tertiary: palette.raised,
          base: palette.base,
          surface: palette.surface,
          raised: palette.raised,
          hover: palette.hover,
          active: palette.active,
        },
        line: palette.borderDefault,
        border: {
          subtle: palette.borderSubtle,
          DEFAULT: palette.borderDefault,
          strong: palette.borderStrong,
        },
        txt: {
          primary: palette.textPrimary,
          secondary: palette.textSecondary,
          muted: palette.textMuted,
          inverse: palette.textInverse,
        },
        text: {
          primary: palette.textPrimary,
          secondary: palette.textSecondary,
          muted: palette.textMuted,
          inverse: palette.textInverse,
        },
        brand: {
          DEFAULT: palette.brand,
          dim: palette.brandDim,
          glow: "rgba(249,115,22,0.15)",
        },
        // quality scale, ordered worst to best; the accent.* aliases keep the
        // existing components on exactly these values
        quality: {
          elite: "#14B8A6",
          high: "#22C55E",
          average: "#EAB308",
          low: "#F97316",
          poor: "#EF4444",
        },
        accent: {
          blue: "#3b82f6",
          teal: "#14B8A6",
          green: "#22C55E",
          amber: "#EAB308",
          red: "#EF4444",
          orange: "#F97316",
        },
        court: {
          floor: "#C8A96E",
          lines: "#FFFFFF",
          paint: "rgba(255,255,255,0.06)",
          arc: "#FFFFFF",
        },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      maxWidth: { page: "1400px" },
      transitionDuration: { 200: "200ms" },
    },
  },
  plugins: [],
};
