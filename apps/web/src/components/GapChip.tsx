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
  return (
    <div className="flex items-center gap-3 pl-6 pr-2">
      {/* vertical tick connecting rows — dashed (per §9.6 "dashed = addable slot") */}
      <span
        aria-hidden
        className="h-full w-[3px] border-l border-dashed border-ink-tertiary/40"
      />
      <div className="flex flex-1 items-center gap-2 font-mono text-2xs tabular-nums text-ink-tertiary">
        <span>
          {fmtHHMM(startMin)}
          <span className="mx-1 text-ink-tertiary/60">–</span>
          {fmtHHMM(endMin)}
        </span>
        <span className="text-ink-tertiary/60">·</span>
        <span className="uppercase tracking-widest">gap {fmtDurationShort(duration)}</span>
      </div>
      <button
        type="button"
        onClick={onFill}
        className="inline-flex items-center gap-1 rounded-sm border border-dashed border-ink-tertiary/40 px-2 py-0.5 text-xs font-medium text-ink-tertiary transition hover:border-ink-secondary hover:text-ink-secondary"
      >
        <Plus className="h-3 w-3" strokeWidth={1.8} />
        填充 Rail
      </button>
    </div>
  );
}
