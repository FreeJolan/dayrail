import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import type { SampleRail } from '@/data/sample';
import { RAIL_COLOR_HEX } from './railColors';

// §5.6 — the only surface Signal ever appears on. Rendered only when the
// queue is non-empty. A single Rail expands as an inline row; 2+ Rails
// collapse to a summary line that can be expanded.

export type CheckInAction = 'done' | 'skip' | 'shift' | 'ignore';

interface Props {
  queue: SampleRail[];
  onAction: (instanceId: string, action: CheckInAction) => void;
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
          {queue.map((rail, idx) => (
            <CheckInRow
              key={rail.id}
              rail={rail}
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
  rail,
  first,
  onAction,
}: {
  rail: SampleRail;
  first: boolean;
  onAction: (instanceId: string, action: CheckInAction) => void;
}) {
  const accent = RAIL_COLOR_HEX[rail.color];
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
        {rail.start}–{rail.end}
      </span>
      <span className="text-sm text-ink-primary">{rail.name}</span>
      {rail.subtitle && (
        <span className="truncate text-sm text-ink-tertiary">· {rail.subtitle}</span>
      )}

      <span className="ml-auto flex items-center gap-1">
        <ActionChip variant="primary" onClick={() => onAction(rail.id, 'done')}>
          完成
        </ActionChip>
        <ActionChip onClick={() => onAction(rail.id, 'skip')}>跳过</ActionChip>
        <ActionChip onClick={() => onAction(rail.id, 'shift')}>Shift</ActionChip>
        <ActionChip variant="ghost" onClick={() => onAction(rail.id, 'ignore')}>
          忽略
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
