import type { HeatmapState } from '@/data/sampleReview';
import { ArrowUpRight } from 'lucide-react';

// Small visual legend so users can decode the five heatmap states
// without having to hover every cell. Appears inline with the heatmap
// header. Uses a neutral Rail color (slate) since the legend is about
// STATE, not Rail identity — the same state glyph reads the same on
// any Rail hue.

const items: Array<{ state: HeatmapState; label: string }> = [
  { state: 'done', label: '完成' },
  { state: 'shifted', label: 'Shift' },
  { state: 'skipped', label: '跳过' },
  { state: 'unmarked', label: '未标记' },
  { state: 'empty', label: '不参与' },
];

// Neutral slate family for the legend swatches so the glyph pattern
// reads clearly against every real Rail color in the heatmap.
const SLATE_STEP_9 = '#8B8D98';
const SLATE_STEP_7 = '#BCBDC7';
const SLATE_STEP_6 = '#C1C4CD';
const SLATE_STEP_4 = '#E0E1E6';

export function HeatmapLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-ink-tertiary">
      <li className="font-mono text-2xs uppercase tracking-widest">Legend</li>
      {items.map((it) => (
        <li key={it.state} className="flex items-center gap-1.5">
          <LegendSwatch state={it.state} />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

function LegendSwatch({ state }: { state: HeatmapState }) {
  if (state === 'done') {
    return (
      <span
        aria-hidden
        className="h-3 w-5 rounded-sm"
        style={{ background: SLATE_STEP_9 }}
      />
    );
  }
  if (state === 'shifted') {
    return (
      <span
        aria-hidden
        className="relative flex h-3 w-5 items-center justify-center rounded-sm"
        style={{ background: SLATE_STEP_7 }}
      >
        <ArrowUpRight className="h-2 w-2 text-ink-secondary" strokeWidth={2.2} />
      </span>
    );
  }
  if (state === 'skipped') {
    return (
      <span
        aria-hidden
        className="h-3 w-5 rounded-sm bg-surface-1"
        style={{
          backgroundImage: `repeating-linear-gradient(-45deg, ${SLATE_STEP_6} 0 1.5px, transparent 1.5px 6px)`,
        }}
      />
    );
  }
  if (state === 'unmarked') {
    return (
      <span
        aria-hidden
        className="h-3 w-5 rounded-sm bg-surface-1"
        style={{
          backgroundImage: `repeating-linear-gradient(-45deg, ${SLATE_STEP_4} 0 1px, transparent 1px 6px)`,
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="h-3 w-5 rounded-sm border border-dashed border-ink-tertiary/40"
    />
  );
}
