import { useState } from 'react';
import { ChevronDown, Calendar } from 'lucide-react';
import { clsx } from 'clsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';
import {
  formatCycleRange,
  SAMPLE_CYCLES,
  type SampleCycle,
} from '@/data/sampleCycle';

// ERD §5.3 D4 — Cycle pager. `C1 Apr 13 – Apr 19 ▾` form; click opens
// popover listing previous / current / next cycles. Notation is always
// `C1 / C2 / C3`, NEVER week numbers. Today's cycle wears a small
// CURRENT chip; the rest are plain rows.

interface Props {
  current: SampleCycle;
  onSelect: (cycle: SampleCycle) => void;
}

export function CyclePagerPicker({ current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const todayISO = '2026-04-17'; // mock today

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-surface-1 px-3 py-1.5 transition hover:bg-surface-2"
        >
          <Calendar className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.6} />
          <span className="font-mono text-sm tabular-nums text-ink-primary">
            {current.label}
          </span>
          <span className="font-mono text-xs tabular-nums text-ink-secondary">
            {formatCycleRange(current)}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.6} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[280px] p-1">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Cycles
          </span>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            ← 旧 · 新 →
          </span>
        </div>
        <ul>
          {SAMPLE_CYCLES.map((c) => {
            const isCurrent = c.startDate <= todayISO && todayISO <= c.endDate;
            const isActive = c.id === current.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(c);
                    setOpen(false);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition',
                    isActive ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="font-mono text-sm tabular-nums text-ink-primary">
                    {c.label}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-ink-secondary">
                    {formatCycleRange(c)}
                  </span>
                  {isCurrent && <CurrentChip />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function CurrentChip() {
  return (
    <span className="ml-auto inline-flex items-center gap-1 rounded-sm bg-cta px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-cta-foreground">
      <span className="inline-block h-1 w-1 rounded-full bg-cta-foreground" />
      Now
    </span>
  );
}
