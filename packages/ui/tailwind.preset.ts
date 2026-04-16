import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import {
  sand, sage, olive, slate, mauve, brown, amber, teal, pink, gray,
} from '@radix-ui/colors';

const step9 = (source: Record<string, string>, name: string): string => {
  const key = `${name}9`;
  const value = source[key];
  if (!value) throw new Error(`Radix scale ${name} missing step 9`);
  return value;
};

const radixStep9: Record<string, string> = {
  sand: step9(sand, 'sand'),
  sage: step9(sage, 'sage'),
  olive: step9(olive, 'olive'),
  slate: step9(slate, 'slate'),
  mauve: step9(mauve, 'mauve'),
  brown: step9(brown, 'brown'),
  amber: step9(amber, 'amber'),
  teal: step9(teal, 'teal'),
  pink: step9(pink, 'pink'),
  gray: step9(gray, 'gray'),
};

const preset: Partial<Config> = {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        // shadcn tokens — wired to CSS variables defined in globals.css
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        // `destructive` in shadcn is conventionally red; DayRail §9.6 forbids red for
        // "未完成/过期". We map it to amber ("中性警示") so any component that reaches
        // for `destructive` can't accidentally violate the No-guilt principle.
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',

        rail: radixStep9,
        canvas: {
          light: '#FAFAF8',
          dark: '#18181B',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'PingFang SC', 'Source Han Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      transitionDuration: {
        DEFAULT: '180ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'fade-out': 'fade-out 180ms ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default preset;
