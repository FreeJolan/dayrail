import {
  computeSummary,
  fmtDurationHours,
  fmtHHMM,
  type EditableRail,
} from '@/data/sampleTemplate';

// ERD §5.4 E5: sticky 36px strip below the tab bar.
// Mono, auto-derived, numbers tick in real time. Shares the "top-of-view
// state slice" language with Cycle View's summary strip (D5).

interface Props {
  rails: EditableRail[];
}

export function SummaryStrip({ rails }: Props) {
  const s = computeSummary(rails);
  const bullet = <span className="px-2 text-ink-tertiary/60">·</span>;
  return (
    <div className="hairline-b sticky top-[52px] z-20 -mx-10 flex h-9 items-center gap-0 bg-surface-0 px-10 font-mono text-xs tabular-nums text-ink-secondary">
      <span>
        <span className="text-ink-primary">{s.railCount}</span> Rails
      </span>
      {bullet}
      <span>
        合计 <span className="text-ink-primary">{fmtDurationHours(s.totalMin)}</span>
      </span>
      {bullet}
      <span>
        <span className="text-ink-primary">{fmtHHMM(s.firstMin)}</span>
        <span className="mx-1 text-ink-tertiary">→</span>
        <span className="text-ink-primary">{fmtHHMM(s.lastMin)}</span>
      </span>
      {bullet}
      <span>
        <span className="text-ink-primary">{s.gaps.length}</span> 处空隙
        {s.gapTotalMin > 0 && (
          <span className="text-ink-tertiary"> ({fmtDurationHours(s.gapTotalMin)})</span>
        )}
      </span>
    </div>
  );
}
