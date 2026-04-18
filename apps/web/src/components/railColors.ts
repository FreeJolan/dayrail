import type { RailColor } from '@/data/sample';

// Rail color maps. Values are CSS `var(--rail-*)` references — the
// variables themselves are defined in `src/lib/themeTokens.ts` and
// swap between light and dark Radix scales via the `.dark` class on
// `<html>`. Inline `style={{ background: RAIL_COLOR_HEX[color] }}`
// therefore tracks the active theme without component-side changes.

function railVar(name: RailColor, step: 4 | 6 | 7 | 9): string {
  return `var(--rail-${name}-${step})`;
}

function buildStepMap(step: 4 | 6 | 7 | 9): Record<RailColor, string> {
  const names: RailColor[] = [
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
  ];
  return names.reduce<Record<RailColor, string>>(
    (m, n) => {
      m[n] = railVar(n, step);
      return m;
    },
    {} as Record<RailColor, string>,
  );
}

// Terracotta CTA — locked to "Current Rail + primary action + Replace Shift".
// Lives here (not in Tailwind only) so inline `style` references don't drift
// from the utility-class tokens. Theme-aware via --cta variable.
// `--cta` is stored as an R-G-B triplet for Tailwind alpha support,
// so inline usage wraps with rgb().
export const CTA_HEX = 'rgb(var(--cta))';

export const RAIL_COLOR_HEX: Record<RailColor, string> = buildStepMap(9);
export const RAIL_COLOR_STEP_4: Record<RailColor, string> = buildStepMap(4);
export const RAIL_COLOR_STEP_6: Record<RailColor, string> = buildStepMap(6);
export const RAIL_COLOR_STEP_7: Record<RailColor, string> = buildStepMap(7);

// For text rendered ON TOP of a Rail color at step 9 (the solid "done"
// state). Radix convention: muted/natural scales + amber (high
// luminance) take dark text; saturated/dark scales take white. The
// light-scale choice holds in dark mode too because Radix dark's
// step-9 remains saturated — Radix's "accent scale" design pins the
// ratio.
export const RAIL_TEXT_ON_SOLID: Record<RailColor, string> = {
  sand: 'rgb(var(--ink-primary))',
  sage: 'rgb(var(--ink-primary))',
  slate: 'rgb(var(--ink-primary))',
  brown: 'rgb(var(--ink-primary))',
  amber: 'rgb(var(--ink-primary))',
  teal: 'rgb(var(--surface-0))',
  pink: 'rgb(var(--surface-0))',
  grass: 'rgb(var(--ink-primary))',
  indigo: 'rgb(var(--surface-0))',
  plum: 'rgb(var(--surface-0))',
};
