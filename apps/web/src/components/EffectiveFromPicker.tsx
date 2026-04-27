// ERD §10.5 Phase 4 — "apply edits from:" picker.
//
// A small affordance for surfaces that produce versioned writes (rail
// edits, template edits, calendar-rule edits). The user picks when the
// next edit's revision should start applying:
//
//   • 今天起 (default) — revision.effectiveFrom = today.
//   • 明天起          — revision.effectiveFrom = tomorrow. Today's
//                       resolution still reads the prior revision.
//   • 自定义日期…      — revision.effectiveFrom = picked ISO date.
//
// The picker is *stateful at the call site*: parent owns the `value`
// (one of the three modes) and the optional `customDate`. We surface
// a derived ISO date via `effectiveFrom` so the parent can pass it
// straight to a writer.

import { useId, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { toIsoDate } from '@dayrail/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';

export type EffectiveFromMode = 'today' | 'tomorrow' | 'custom';

export interface EffectiveFromValue {
  mode: EffectiveFromMode;
  /** ISO YYYY-MM-DD; required when `mode === 'custom'`. */
  customDate?: string;
}

export interface EffectiveFromPickerProps {
  value: EffectiveFromValue;
  onChange: (next: EffectiveFromValue) => void;
  /** Optional label rendered before the dropdown. */
  label?: string;
  /** Disable the picker (e.g. while a confirm dialog is open). */
  disabled?: boolean;
  className?: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Resolve an `EffectiveFromValue` into the ISO date the writers want.
 *  Returns `undefined` when the value is invalid (e.g. custom mode
 *  without a date). Callers can then fall back to the writer's default
 *  (which itself defaults to today). */
export function resolveEffectiveFromValue(
  v: EffectiveFromValue,
): string | undefined {
  if (v.mode === 'today') return toIsoDate();
  if (v.mode === 'tomorrow') {
    const t = new Date();
    return toIsoDate(new Date(t.getTime() + ONE_DAY_MS));
  }
  // custom
  if (!v.customDate) return undefined;
  return v.customDate;
}

function formatLabel(v: EffectiveFromValue): string {
  if (v.mode === 'today') return '今天起';
  if (v.mode === 'tomorrow') return '明天起';
  return v.customDate ? `${v.customDate} 起` : '自定义日期…';
}

export function EffectiveFromPicker({
  value,
  onChange,
  label = '应用日期',
  disabled = false,
  className,
}: EffectiveFromPickerProps): JSX.Element {
  const inputId = useId();
  const [showCustom, setShowCustom] = useState(value.mode === 'custom');

  const resolved = useMemo(() => resolveEffectiveFromValue(value), [value]);

  return (
    <div className={clsx('inline-flex items-center gap-2', className)}>
      <span className="text-2xs uppercase tracking-wide text-ink-tertiary">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={clsx(
              'inline-flex items-center gap-1 rounded border border-hairline bg-surface-0 px-2 py-1 font-mono text-2xs tabular-nums text-ink-primary transition',
              'hover:bg-surface-1',
              disabled && 'cursor-not-allowed opacity-60',
            )}
            disabled={disabled}
          >
            {formatLabel(value)}
            <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4}>
          <DropdownMenuItem
            onSelect={() => {
              setShowCustom(false);
              onChange({ mode: 'today' });
            }}
          >
            今天起
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setShowCustom(false);
              onChange({ mode: 'tomorrow' });
            }}
          >
            明天起
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(ev) => {
              ev.preventDefault();
              setShowCustom(true);
              if (value.mode !== 'custom') {
                onChange({ mode: 'custom', ...(value.customDate && { customDate: value.customDate }) });
              }
            }}
          >
            自定义日期…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showCustom && (
        <input
          id={inputId}
          type="date"
          className="rounded border border-hairline bg-surface-0 px-2 py-1 font-mono text-2xs tabular-nums text-ink-primary"
          value={value.customDate ?? ''}
          min={toIsoDate()}
          onChange={(e) => {
            const next = e.target.value;
            onChange({
              mode: 'custom',
              ...(next && { customDate: next }),
            });
          }}
          disabled={disabled}
          aria-label="自定义生效日期"
        />
      )}
      {/* Resolved ISO surfaced for screen readers + keeps the picker
          honest in tests. */}
      <span className="sr-only" aria-live="polite">
        {resolved ?? '未选择日期'}
      </span>
    </div>
  );
}
