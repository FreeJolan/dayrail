import type { Config } from 'tailwindcss';
import {
  sand,
  sage,
  slate,
  brown,
  bronze,
  amber,
  teal,
  pink,
  grass,
  indigo,
  plum,
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

// Rail 10-color palette. Revised from the original §9.6 proposal after
// visual testing: dropped olive/mauve/gray (too-close neighbors with
// sage/slate respectively, or identity-less pure gray); added grass,
// indigo, plum to cover the previously missing "saturated green /
// cool blue / creative purple" slots. Balance: 4 natural-muted (sand,
// sage, slate, brown) + 6 saturated (amber, teal, pink, grass, indigo,
// plum).
const railStep9 = {
  sand: sand.sand9,
  sage: sage.sage9,
  slate: slate.slate9,
  brown: brown.brown9,
  amber: amber.amber9,
  teal: teal.teal9,
  pink: pink.pink9,
  grass: grass.grass9,
  indigo: indigo.indigo9,
  plum: plum.plum9,
};

const railStep4 = {
  sand: sand.sand4,
  sage: sage.sage4,
  slate: slate.slate4,
  brown: brown.brown4,
  amber: amber.amber4,
  teal: teal.teal4,
  pink: pink.pink4,
  grass: grass.grass4,
  indigo: indigo.indigo4,
  plum: plum.plum4,
};

const railStep6 = {
  sand: sand.sand6,
  sage: sage.sage6,
  slate: slate.slate6,
  brown: brown.brown6,
  amber: amber.amber6,
  teal: teal.teal6,
  pink: pink.pink6,
  grass: grass.grass6,
  indigo: indigo.indigo6,
  plum: plum.plum6,
};

const railStep7 = {
  sand: sand.sand7,
  sage: sage.sage7,
  slate: slate.slate7,
  brown: brown.brown7,
  amber: amber.amber7,
  teal: teal.teal7,
  pink: pink.pink7,
  grass: grass.grass7,
  indigo: indigo.indigo7,
  plum: plum.plum7,
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
        // Typographic scale — matches Tailwind defaults for xs/sm/base/lg
        // (post-2026-04-18 readability tune; the original print-compact
        // scale was 1px smaller across the board and felt straining).
        // 2xs (Mono overlines) and the display sizes (xl+) stay as-is.
        '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.04em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '28px' }],
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
