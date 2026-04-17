import type { Config } from 'tailwindcss';
import {
  sand,
  sage,
  olive,
  slate,
  mauve,
  brown,
  bronze,
  amber,
  teal,
  pink,
  gray,
} from '@radix-ui/colors';

// ---------- G-group design tokens (ERD §9.6) ----------

// G3 · Surface tiers — sand-1..4
const surface = {
  0: sand.sand1,
  1: sand.sand2,
  2: sand.sand3,
  3: sand.sand4,
};

// §9.6 · Ink text — slate 10/11/12
const ink = {
  primary: slate.slate12,
  secondary: slate.slate11,
  tertiary: slate.slate10,
};

// G1 · Terracotta CTA — bronze 9/10/11 (the "warm earth" family in Radix;
// the brightest `orange` scale is too candy for a printed-manual tone).
// Foreground = ink-primary because step-9's muted lightness doesn't carry
// white text at WCAG AA small-text sizes; dark text on a warm accent
// is also closer to how an actual stamped / letterpress highlight reads.
const cta = {
  DEFAULT: bronze.bronze9,
  hover: bronze.bronze10,
  active: bronze.bronze11,
  foreground: slate.slate12,
  soft: bronze.bronze3,
};

// G2 · Hairline (for sticky / scroll boundary only) — slate-10
const hairline = slate.slate10;

// §9.6 · Warn (amber, never red)
const warn = {
  DEFAULT: amber.amber9,
  soft: amber.amber4,
};

// Rail step-9 palette — the 10 natural+saturated scales
const railStep9 = {
  sand: sand.sand9,
  sage: sage.sage9,
  olive: olive.olive9,
  slate: slate.slate9,
  mauve: mauve.mauve9,
  brown: brown.brown9,
  amber: amber.amber9,
  teal: teal.teal9,
  pink: pink.pink9,
  gray: gray.gray9,
};

// Rail step-4 (for "unmarked" hatching per C-group)
const railStep4 = {
  sand: sand.sand4,
  sage: sage.sage4,
  olive: olive.olive4,
  slate: slate.slate4,
  mauve: mauve.mauve4,
  brown: brown.brown4,
  amber: amber.amber4,
  teal: teal.teal4,
  pink: pink.pink4,
  gray: gray.gray4,
};

// Rail step-6 (for "skipped" hatching per C-group)
const railStep6 = {
  sand: sand.sand6,
  sage: sage.sage6,
  olive: olive.olive6,
  slate: slate.slate6,
  mauve: mauve.mauve6,
  brown: brown.brown6,
  amber: amber.amber6,
  teal: teal.teal6,
  pink: pink.pink6,
  gray: gray.gray6,
};

// Rail step-7 (for "shifted" cell tint per F2 Review heatmap — not strictly
// needed on Today Track, but kept here since the palette lives together)
const railStep7 = {
  sand: sand.sand7,
  sage: sage.sage7,
  olive: olive.olive7,
  slate: slate.slate7,
  mauve: mauve.mauve7,
  brown: brown.brown7,
  amber: amber.amber7,
  teal: teal.teal7,
  pink: pink.pink7,
  gray: gray.gray7,
};

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface,
        ink,
        cta,
        hairline,
        warn,
        rail: railStep9,
        'rail-4': railStep4,
        'rail-6': railStep6,
        'rail-7': railStep7,
      },
      borderRadius: {
        // G5 · sharp / sm / md / lg = 0 / 6 / 10 / 16
        sharp: '0',
        sm: '6px',
        md: '10px',
        lg: '16px',
        full: '9999px',
      },
      fontFamily: {
        // §9.6 · Inter body + JetBrains Mono numeric.
        // CN primary: Noto Sans SC (Source Han Sans SC) served from
        // Google Fonts at weights 400/500/600. Loaded with font-display:
        // swap so PingFang takes over during the ~300 ms download
        // window and on platforms where the CDN is blocked. Consistent
        // cross-platform rendering — no more macOS PingFang vs Windows
        // Microsoft YaHei mismatch.
        sans: [
          'Inter',
          '"Noto Sans SC"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Compact typographic scale biased toward print rhythm
        '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.04em' }],
        xs: ['11px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['15px', { lineHeight: '22px' }],
        lg: ['17px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['26px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        '3xl': ['34px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
      },
      letterSpacing: {
        widest: '0.18em', // for uppercase Mono overlines
      },
      transitionDuration: {
        DEFAULT: '180ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.22, 0.61, 0.36, 1)', // ease-out-ish, never bouncy
      },
    },
  },
  plugins: [],
};

export default config;
