import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import type { RailColor } from '@/data/sample';
import { RAIL_COLOR_HEX } from './railColors';

// §5.6 — the only surface Signal ever appears on. Rendered only when the
// queue is non-empty. A single Rail expands as an inline row; 2+ Rails
// collapse to a summary line that can be expanded.
//
// v0.4: the queue item is a Task-carrying row (ERD §10.1). The component
// passes the whole entry back to onAction so the caller can write Task
// state + recordSignal without another lookup.

export type CheckInAction = 'done' | 'defer' | 'archive';

export interface CheckInEntry {
  taskId: string;
  railId: string;
  railName: string;
  /** Title of the Task carrying this Rail. Rendered next to the rail
   *  name so the user knows what specifically needs marking, not just
   *  which time-slot. */
  taskTitle: string;
  subtitle?: string;
  color: RailColor;
  start: string; // HH:MM
  end: string; // HH:MM
}

interface Props {
  queue: CheckInEntry[];
  onAction: (entry: CheckInEntry, action: CheckInAction) => void;
}

export function CheckInStrip({ queue, onAction }: Props) {
  const [open, setOpen] = useState(true); // start open in the mock for density
  if (queue.length === 0) return null;

  return (
    <section
      aria-label="Unmarked Rails waiting to be decided"
      className="rounded-md border-0 bg-surface-2"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Check-in
        </span>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-1 font-mono text-xs tabular-nums text-ink-secondary">
          {queue.length}
        </span>
        <span className="flex-1 text-sm text-ink-primary">
          条已结束的 Rail 待标记
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-ink-tertiary" strokeWidth={1.6} />
        ) : (
          <ChevronDown className="h-4 w-4 text-ink-tertiary" strokeWidth={1.6} />
        )}
      </button>

      {open && (
        <ul className="px-4 pb-3">
          {queue.map((entry, idx) => (
            <CheckInRow
              key={entry.taskId}
              entry={entry}
              first={idx === 0}
              onAction={onAction}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CheckInRow({
  entry,
  first,
  onAction,
}: {
  entry: CheckInEntry;
  first: boolean;
  onAction: (entry: CheckInEntry, action: CheckInAction) => void;
}) {
  const accent = RAIL_COLOR_HEX[entry.color];
  return (
    <li
      className={clsx(
        'flex items-center gap-3 py-2',
        !first && 'hairline-t',
      )}
    >
      <span
        aria-hidden
        className="h-3.5 w-[3px] rounded-sm"
        style={{ background: accent }}
      />
      <span className="font-mono text-xs text-ink-tertiary">
        {entry.start}–{entry.end}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm text-ink-primary">
          {entry.taskTitle || entry.railName}
        </span>
        <span className="shrink-0 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {entry.railName}
        </span>
        {entry.subtitle && (
          <span className="truncate text-xs text-ink-tertiary">
            · {entry.subtitle}
          </span>
        )}
      </span>

      <span className="ml-auto flex items-center gap-1">
        <ActionChip variant="primary" onClick={() => onAction(entry, 'done')}>
          完成
        </ActionChip>
        <ActionChip onClick={() => onAction(entry, 'defer')}>
          以后再说
        </ActionChip>
        <ActionChip variant="ghost" onClick={() => onAction(entry, 'archive')}>
          归档
        </ActionChip>
      </span>
    </li>
  );
}

function ActionChip({
  children,
  variant = 'default',
  onClick,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'ghost';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-sm px-2.5 py-1 text-xs font-medium transition',
        variant === 'primary' &&
          'bg-ink-primary text-surface-0 hover:bg-ink-secondary',
        variant === 'default' &&
          'bg-surface-1 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
        variant === 'ghost' && 'text-ink-tertiary hover:text-ink-secondary',
      )}
    >
      {children}
    </button>
  );
}
