import { Plus } from 'lucide-react';
import { fmtDurationShort, fmtHHMM } from '@/data/sampleTemplate';

// ERD §5.4 E4: when adjacent Rails have a gap → an inline chip between
// rows: `10:00–11:00 · 1h · + 填充 Rail`. Clicking Fill Rail creates a
// Rail exactly filling the gap (duration = gap length).

interface Props {
  startMin: number;
  endMin: number;
  onFill: () => void;
}

export function GapChip({ startMin, endMin, onFill }: Props) {
  const duration = endMin - startMin;
  // Gaps shorter than 15 min render as a subtle divider-only marker; gaps
  // 15 min or longer surface as a full call-out row with the "+ Fill Rail"
  // affordance. Avoids drawing attention to tiny sub-quarter gaps that are
  // almost always intentional transitions.
  const big = duration >= 15;

  if (!big) {
    return (
      <div className="flex items-center gap-2 py-1 pl-6 pr-2 text-ink-tertiary/70">
        <span
          aria-hidden
          className="h-px flex-1 border-t border-dashed border-ink-tertiary/30"
        />
        <span className="font-mono text-2xs tabular-nums">
          {fmtDurationShort(duration)}
        </span>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 py-2 pl-6 pr-2 transition hover:bg-surface-1/60">
      <span
        aria-hidden
        className="h-4 w-[3px] border-l-[1.5px] border-dashed border-ink-tertiary/50 transition group-hover:border-ink-secondary"
      />
      <div className="flex flex-1 items-center gap-2 font-mono text-2xs tabular-nums text-ink-tertiary">
        <span>
          {fmtHHMM(startMin)}
          <span className="mx-1 text-ink-tertiary/60">–</span>
          {fmtHHMM(endMin)}
        </span>
        <span className="text-ink-tertiary/60">·</span>
        <span className="uppercase tracking-widest">
          gap {fmtDurationShort(duration)}
        </span>
      </div>
      <button
        type="button"
        onClick={onFill}
        className="inline-flex items-center gap-1 rounded-sm border border-dashed border-ink-tertiary/50 px-2.5 py-1 text-xs font-medium text-ink-secondary transition hover:border-ink-secondary hover:bg-surface-2 hover:text-ink-primary"
      >
        <Plus className="h-3 w-3" strokeWidth={1.8} />
        填充 Rail
      </button>
    </div>
  );
}
