import type { Config } from 'tailwindcss';

// ---------- G-group design tokens (ERD §9.6) ----------
//
// Tokens route through CSS variables defined by `src/lib/themeTokens.ts`
// (injected at boot). `rgb(var(--x) / <alpha-value>)` lets Tailwind's
// alpha modifiers (`bg-surface-0/40`) keep working; the variables
// themselves swap on `.dark` class toggle for dark mode.

const rgbVar = (name: string): string => `rgb(var(--${name}) / <alpha-value>)`;

const surface = {
  0: rgbVar('surface-0'),
  1: rgbVar('surface-1'),
  2: rgbVar('surface-2'),
  3: rgbVar('surface-3'),
};

const ink = {
  primary: rgbVar('ink-primary'),
  secondary: rgbVar('ink-secondary'),
  tertiary: rgbVar('ink-tertiary'),
};

const cta = {
  DEFAULT: rgbVar('cta'),
  hover: rgbVar('cta-hover'),
  active: rgbVar('cta-active'),
  foreground: rgbVar('cta-foreground'),
  soft: rgbVar('cta-soft'),
};

const hairline = rgbVar('hairline');

const warn = {
  DEFAULT: rgbVar('warn'),
  soft: rgbVar('warn-soft'),
};

// Rail tokens use plain hex `var(--rail-sand-9)` (no Tailwind alpha
// needed; Rails render via inline style or one-off utility classes —
// we don't do `bg-rail-sand-9/40` anywhere). If we ever do, switch
// to triplet format alongside the core tokens.
const railVar = (name: string) => `var(--rail-${name})`;
const RAIL_NAMES = [
  'sand',
  'sage',
  'slate',
  'brown',
  'amber',
  'teal',
  'pink',
  'grass',
  'indigo',
  'plum',
] as const;
type RailName = (typeof RAIL_NAMES)[number];

function railStepMap(step: 4 | 6 | 7 | 9): Record<RailName, string> {
  const m = {} as Record<RailName, string>;
  for (const n of RAIL_NAMES) m[n] = railVar(`${n}-${step}`);
  return m;
}

const railStep9 = railStepMap(9);
const railStep4 = railStepMap(4);
const railStep6 = railStepMap(6);
const railStep7 = railStepMap(7);

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
        // Readable-at-scale typography (post-2026-04-18 pass). The
        // original "print-compact" scale was 1px smaller across the
        // board; `2xs` (Mono overlines) sat at 10px which felt
        // straining even with tracking-widest and uppercase.
        // Current scale:
        //   2xs is still the overline tier — Mono + uppercase +
        //     0.04em letter-spacing differentiates it visually from
        //     body `xs` even though the px value is the same.
        //   xs / sm / base / lg match Tailwind defaults.
        '2xs': ['13px', { lineHeight: '18px', letterSpacing: '0.04em' }],
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
