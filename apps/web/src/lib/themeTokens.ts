// Dark-mode token plumbing (ERD §9.6). We generate the CSS variable
// blocks for `:root` (light) and `.dark` (dark) at module-init time
// from Radix Colors imports — single source of truth, no hand-written
// duplicate hex tables to drift.
//
// Tokens split into two groups:
//   1. "Base" tokens used by Tailwind utilities (surface / ink / cta /
//      hairline / warn). These need R-G-B triplet form so
//      `bg-surface-0/40` alpha modifiers keep working.
//   2. "Rail" tokens consumed inline via `RAIL_COLOR_HEX[color]` etc.
//      Plain hex strings — no alpha-utility concern since Rail colors
//      are rendered through `style={{ background }}`, not Tailwind.

import {
  sand,
  sandDark,
  sage,
  sageDark,
  slate,
  slateDark,
  brown,
  brownDark,
  bronze,
  bronzeDark,
  amber,
  amberDark,
  teal,
  tealDark,
  pink,
  pinkDark,
  grass,
  grassDark,
  indigo,
  indigoDark,
  plum,
  plumDark,
} from '@radix-ui/colors';

/** `#rrggbb` → `"r g b"` (space-separated channels), Tailwind-alpha-compatible. */
function hexRgb(hex: string): string {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function baseTokens(scope: 'light' | 'dark'): string {
  const s = scope === 'dark' ? sandDark : sand;
  const sl = scope === 'dark' ? slateDark : slate;
  const br = scope === 'dark' ? bronzeDark : bronze;
  const am = scope === 'dark' ? amberDark : amber;
  return [
    `--surface-0: ${hexRgb(s.sand1)};`,
    `--surface-1: ${hexRgb(s.sand2)};`,
    `--surface-2: ${hexRgb(s.sand3)};`,
    `--surface-3: ${hexRgb(s.sand4)};`,
    `--ink-primary: ${hexRgb(sl.slate12)};`,
    `--ink-secondary: ${hexRgb(sl.slate11)};`,
    `--ink-tertiary: ${hexRgb(sl.slate10)};`,
    `--cta: ${hexRgb(br.bronze9)};`,
    `--cta-hover: ${hexRgb(br.bronze10)};`,
    `--cta-active: ${hexRgb(br.bronze11)};`,
    `--cta-foreground: ${hexRgb(sl.slate12)};`,
    `--cta-soft: ${hexRgb(br.bronze3)};`,
    `--hairline: ${hexRgb(sl.slate10)};`,
    `--warn: ${hexRgb(am.amber9)};`,
    `--warn-soft: ${hexRgb(am.amber4)};`,
  ].join(' ');
}

// Rail scales — plain hex, one mapping per light/dark. Steps 3 / 4 / 6
// / 7 / 9 all swap; text-on-solid is computed separately (foreground color
// matters for legibility on solid step-9 fills, stays ink-primary /
// surface-0 depending on scale luminance).
type Scale = Record<string, string>;
const RAIL_PAIRS: Record<string, { light: Scale; dark: Scale }> = {
  sand: { light: sand as Scale, dark: sandDark as Scale },
  sage: { light: sage as Scale, dark: sageDark as Scale },
  slate: { light: slate as Scale, dark: slateDark as Scale },
  brown: { light: brown as Scale, dark: brownDark as Scale },
  amber: { light: amber as Scale, dark: amberDark as Scale },
  teal: { light: teal as Scale, dark: tealDark as Scale },
  pink: { light: pink as Scale, dark: pinkDark as Scale },
  grass: { light: grass as Scale, dark: grassDark as Scale },
  indigo: { light: indigo as Scale, dark: indigoDark as Scale },
  plum: { light: plum as Scale, dark: plumDark as Scale },
};

function railTokens(scope: 'light' | 'dark'): string {
  const parts: string[] = [];
  for (const [name, pair] of Object.entries(RAIL_PAIRS)) {
    const pal = scope === 'dark' ? pair.dark : pair.light;
    parts.push(`--rail-${name}-3: ${pal[`${name}3`]};`);
    parts.push(`--rail-${name}-4: ${pal[`${name}4`]};`);
    parts.push(`--rail-${name}-6: ${pal[`${name}6`]};`);
    parts.push(`--rail-${name}-7: ${pal[`${name}7`]};`);
    parts.push(`--rail-${name}-9: ${pal[`${name}9`]};`);
  }
  return parts.join(' ');
}

/** Returns the full `<style>` body (two blocks, one each for
 *  :root and .dark). Call once at app boot. */
export function buildThemeCss(): string {
  return `
:root { ${baseTokens('light')} ${railTokens('light')} }
.dark { ${baseTokens('dark')} ${railTokens('dark')} }
`;
}

/** Inject the theme variables into `document.head` under a
 *  stable id so HMR re-inject doesn't dupe. Idempotent. */
export function injectThemeTokens(): void {
  if (typeof document === 'undefined') return;
  const ID = 'dayrail-theme-tokens';
  let tag = document.getElementById(ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = ID;
    document.head.appendChild(tag);
  }
  tag.textContent = buildThemeCss();
}
