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
import type { RailColor } from '@/data/sample';

// Terracotta CTA — locked to "Current Rail + primary action + Replace Shift".
// Lives here (not in Tailwind only) so inline `style` references don't drift
// from the utility-class tokens.
export const CTA_HEX = bronze.bronze9;

// Map from Rail.color token name → step-9 hex, for inline style binding.
// Kept as a single source so the Tailwind palette and the runtime values
// can't drift. Step-9 = ERD §9.6 "solid" filler.

export const RAIL_COLOR_HEX: Record<RailColor, string> = {
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

export const RAIL_COLOR_STEP_4: Record<RailColor, string> = {
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

export const RAIL_COLOR_STEP_6: Record<RailColor, string> = {
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
