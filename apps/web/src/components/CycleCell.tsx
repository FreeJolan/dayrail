import { clsx } from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
  RAIL_COLOR_STEP_7,
  RAIL_TEXT_ON_SOLID,
} from './railColors';
import type { RailColor } from '@/data/sample';
import type { SlotState } from '@/data/sampleCycle';

// ERD §5.3 D7 three-part hatching semantics, mapped per cell:
//   done           — solid step 9
//   shifted        — step 7 tint + inline `↗` arrow
//   skipped        — step 6 hatching (over step 2 surface)
//   na             — step 4 hatching (over step 2 surface)
//   planned-task   — surface-1 + small rail-color tag + task name
//   planned-empty  — dashed border, no fill
//
// Cell hover = step-3 bg, revealing the cell is interactive.

interface Props {
  state: SlotState;
  color: RailColor; // Rail's color token (for non-na states)
  taskName?: string;
  meta?: string; // "→ 20:00" etc, Mono inline
}

export function CycleCell({ state, color, taskName, meta }: Props) {
  if (state === 'done') return <DoneCell color={color} taskName={taskName} meta={meta} />;
  if (state === 'shifted') return <ShiftedCell color={color} taskName={taskName} meta={meta} />;
  if (state === 'skipped') return <SkippedCell color={color} meta={meta} />;
  if (state === 'na') return <NaCell color={color} />;
  if (state === 'planned-task') return <PlannedTaskCell color={color} taskName={taskName} />;
  return <PlannedEmptyCell />;
}

function DoneCell({
  color,
  taskName,
  meta,
}: {
  color: RailColor;
  taskName?: string;
  meta?: string;
}) {
  const bg = RAIL_COLOR_HEX[color];
  const text = RAIL_TEXT_ON_SOLID[color];
  return (
    <div
      className="relative flex h-full min-h-[44px] flex-col justify-center gap-0.5 rounded-sm px-2 py-1.5"
      style={{ background: bg, color: text }}
    >
      {taskName ? (
        <span className="line-clamp-2 text-xs" style={{ opacity: 0.92 }}>
          {taskName}
        </span>
      ) : (
        <span
          className="font-mono text-2xs uppercase tracking-widest"
          style={{ opacity: 0.7 }}
        >
          Done
        </span>
      )}
      {meta && (
        <span className="font-mono text-2xs" style={{ opacity: 0.7 }}>
          {meta}
        </span>
      )}
    </div>
  );
}

function ShiftedCell({
  color,
  taskName,
  meta,
}: {
  color: RailColor;
  taskName?: string;
  meta?: string;
}) {
  return (
    <div
      className="relative flex h-full min-h-[44px] flex-col justify-center gap-0.5 rounded-sm px-2 py-1.5"
      style={{ background: RAIL_COLOR_STEP_7[color] }}
    >
      <div className="flex items-center gap-1">
        <ArrowUpRight className="h-3 w-3 text-ink-secondary" strokeWidth={1.8} />
        <span className="text-xs text-ink-primary">
          {taskName ?? 'Shifted'}
        </span>
      </div>
      {meta && (
        <span className="font-mono text-2xs text-ink-secondary">{meta}</span>
      )}
    </div>
  );
}

function SkippedCell({ color, meta }: { color: RailColor; meta?: string }) {
  return (
    <div
      className="relative flex h-full min-h-[44px] flex-col justify-center rounded-sm bg-surface-1 px-2 py-1.5 hatch-skipped"
      style={{ ['--hatch' as string]: RAIL_COLOR_STEP_6[color] }}
    >
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Skipped
      </span>
      {meta && (
        <span className="font-mono text-2xs text-ink-tertiary">{meta}</span>
      )}
    </div>
  );
}

function NaCell({ color }: { color: RailColor }) {
  return (
    <div
      className="relative flex h-full min-h-[44px] items-center justify-center rounded-sm bg-surface-1 hatch-unmarked"
      style={{ ['--hatch' as string]: RAIL_COLOR_STEP_4[color] }}
    >
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary/70">
        N/A
      </span>
    </div>
  );
}

function PlannedTaskCell({
  color,
  taskName,
}: {
  color: RailColor;
  taskName?: string;
}) {
  return (
    <div className="relative flex h-full min-h-[44px] flex-col justify-center gap-1 rounded-sm bg-surface-1 px-2 py-1.5 transition hover:bg-surface-2">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ background: RAIL_COLOR_HEX[color] }}
        />
        <span className="line-clamp-2 text-xs text-ink-primary">
          {taskName}
        </span>
      </div>
    </div>
  );
}

function PlannedEmptyCell() {
  return (
    <div
      className={clsx(
        'relative h-full min-h-[44px] rounded-sm transition',
        'border border-dashed border-ink-tertiary/30',
        'hover:border-ink-tertiary/60 hover:bg-surface-1',
      )}
    />
  );
}
