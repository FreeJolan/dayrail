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
  slate: slate.slate9,
  brown: brown.brown9,
  amber: amber.amber9,
  teal: teal.teal9,
  pink: pink.pink9,
  grass: grass.grass9,
  indigo: indigo.indigo9,
  plum: plum.plum9,
};

export const RAIL_COLOR_STEP_4: Record<RailColor, string> = {
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

export const RAIL_COLOR_STEP_6: Record<RailColor, string> = {
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

export const RAIL_COLOR_STEP_7: Record<RailColor, string> = {
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

// For text rendered ON TOP of a Rail color at step 9 (the solid "done"
// state). Radix convention: muted/natural scales + amber (high
// luminance) take dark text; saturated/dark scales take white.
export const RAIL_TEXT_ON_SOLID: Record<RailColor, string> = {
  sand: slate.slate12,
  sage: slate.slate12,
  slate: slate.slate12,
  brown: slate.slate12,
  amber: slate.slate12,
  teal: sand.sand1,
  pink: sand.sand1,
  grass: slate.slate12,
  indigo: sand.sand1,
  plum: sand.sand1,
};
