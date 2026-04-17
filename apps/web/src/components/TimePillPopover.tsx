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

  // Tolerant parser — accepts "8", "08", "800", "0800", "8:0", "8:00", "08:00".
  // Returns minutes-of-day or null.
  const parseHHMM = (raw: string): number | null => {
    const s = raw.trim();
    if (!s) return null;
    let h: number;
    let mm: number;
    if (s.includes(':')) {
      const [hh, mmStr] = s.split(':');
      if (hh == null || mmStr == null) return null;
      h = Number(hh);
      mm = Number(mmStr);
    } else {
      const digits = s.replace(/\D/g, '');
      if (digits.length === 0) return null;
      if (digits.length <= 2) {
        // "8" or "08" → 08:00
        h = Number(digits);
        mm = 0;
      } else if (digits.length === 3) {
        // "830" → 08:30
        h = Number(digits.slice(0, 1));
        mm = Number(digits.slice(1));
      } else if (digits.length === 4) {
        // "0830" → 08:30
        h = Number(digits.slice(0, 2));
        mm = Number(digits.slice(2));
      } else {
        return null;
      }
    }
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  };

  // Normalize raw input to canonical "HH:MM"; returns null if unparseable.
  const normalize = (raw: string): string | null => {
    const mins = parseHHMM(raw);
    if (mins == null) return null;
    return fmtHHMM(mins);
  };

  // ArrowUp / ArrowDown step the field by 15 min (60 min with Shift).
  const onStepKey = (
    e: React.KeyboardEvent<HTMLInputElement>,
    current: string,
    setValue: (v: string) => void,
  ) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const mins = parseHHMM(current);
    if (mins == null) return;
    e.preventDefault();
    const step = e.shiftKey ? 60 : 15;
    const delta = e.key === 'ArrowUp' ? step : -step;
    const next = Math.max(0, Math.min(24 * 60, mins + delta));
    setValue(fmtHHMM(next));
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit();
                  return;
                }
                onStepKey(e, start, setStart);
              }}
              onBlur={() => {
                const n = normalize(start);
                if (n) setStart(n);
              }}
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit();
                  return;
                }
                onStepKey(e, end, setEnd);
              }}
              onBlur={() => {
                const n = normalize(end);
                if (n) setEnd(n);
              }}
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
            ↵ commit · ↑↓ 15m · ⇧↑↓ 1h
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
