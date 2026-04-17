import { useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';
import { fmtDurationShort, fmtHHMM } from '@/data/sampleTemplate';

// ERD §5.4 E6: clicking the right-aligned time pill opens a popover
// with two inputs (start / end). Conflict detection runs live while
// typing; overlapping → pill dyes warning + tooltip names the offender.

interface Props {
  startMin: number;
  endMin: number;
  onChange: (startMin: number, endMin: number) => void;
  /** Optional other Rails in the same template; any overlap dyes warning. */
  conflictsWith?: Array<{ id: string; name: string; startMin: number; endMin: number }>;
  currentId?: string;
}

export function TimePillPopover({
  startMin,
  endMin,
  onChange,
  conflictsWith = [],
  currentId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(fmtHHMM(startMin));
  const [end, setEnd] = useState(fmtHHMM(endMin));

  // recompute on external change (e.g. color popover committed a different
  // Rail's time while this popover was closed)
  if (!open) {
    const sHH = fmtHHMM(startMin);
    const eHH = fmtHHMM(endMin);
    if (sHH !== start) setStart(sHH);
    if (eHH !== end) setEnd(eHH);
  }

  const parseHHMM = (s: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  };

  const parsedStart = parseHHMM(start);
  const parsedEnd = parseHHMM(end);
  const durationValid =
    parsedStart !== null && parsedEnd !== null && parsedEnd > parsedStart;

  const conflicting = durationValid
    ? conflictsWith.find(
        (r) =>
          r.id !== currentId &&
          parsedStart! < r.endMin &&
          r.startMin < parsedEnd!,
      )
    : undefined;

  const commit = () => {
    if (durationValid && !conflicting) {
      onChange(parsedStart!, parsedEnd!);
      setOpen(false);
    }
  };

  const duration = durationValid ? parsedEnd! - parsedStart! : 0;

  const pillConflict = !!conflicting && open;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={conflicting ? `与《${conflicting.name}》重叠` : undefined}
          className={clsx(
            'inline-flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-xs tabular-nums transition',
            pillConflict
              ? 'bg-warn-soft text-warn'
              : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
          )}
        >
          {fmtHHMM(startMin)} <span className="text-ink-tertiary">→</span> {fmtHHMM(endMin)}
          <span className="ml-1 text-ink-tertiary">{fmtDurationShort(endMin - startMin)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[260px]">
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Start
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{1,2}:[0-9]{2}"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              className="rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-sm tabular-nums outline-none ring-0 focus:bg-surface-3"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              End
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{1,2}:[0-9]{2}"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              className="rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-sm tabular-nums outline-none ring-0 focus:bg-surface-3"
            />
          </label>
        </div>

        <div className="mt-2 flex items-center justify-between font-mono text-2xs text-ink-tertiary">
          <span className="uppercase tracking-widest">Duration</span>
          <span className="tabular-nums text-ink-secondary">
            {durationValid ? fmtDurationShort(duration) : '—'}
          </span>
        </div>

        {!durationValid && (start || end) && (
          <p className="mt-2 font-mono text-2xs text-warn">
            End 需晚于 Start
          </p>
        )}
        {conflicting && (
          <p className="mt-2 flex items-center gap-1 font-mono text-2xs text-warn">
            <AlertTriangle className="h-3 w-3" strokeWidth={2} />
            与《{conflicting.name}》{fmtHHMM(conflicting.startMin)}–
            {fmtHHMM(conflicting.endMin)} 重叠
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Enter to commit
          </span>
          <button
            type="button"
            onClick={commit}
            disabled={!durationValid || !!conflicting}
            className={clsx(
              'rounded-sm px-2.5 py-1 font-mono text-2xs uppercase tracking-widest transition',
              durationValid && !conflicting
                ? 'bg-ink-primary text-surface-0 hover:bg-ink-secondary'
                : 'cursor-not-allowed bg-surface-2 text-ink-tertiary',
            )}
          >
            应用
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
