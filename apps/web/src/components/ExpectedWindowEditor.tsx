import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronDown, X } from 'lucide-react';
import {
  formatExpectedWindow,
  normalizeExpectedWindow,
  type ExpectedWindow,
} from '@dayrail/core';
import { clsx } from 'clsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';

interface Props {
  value?: ExpectedWindow;
  inherited?: ExpectedWindow;
  inheritedLabel?: string;
  onChange: (value: ExpectedWindow | undefined) => void;
  className?: string;
}

export function ExpectedWindowEditor({
  value,
  inherited,
  inheritedLabel,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const effective = value ?? inherited;
  const label = effective ? formatExpectedWindow(effective) : '设置预期时间';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'inline-flex min-w-0 items-center gap-2 rounded-md bg-surface-1 px-2.5 py-1.5 text-left text-xs transition hover:bg-surface-2',
            className,
          )}
        >
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" strokeWidth={1.7} />
          <span className={clsx('truncate', effective ? 'text-ink-primary' : 'text-ink-tertiary')}>
            {label}
          </span>
          {!value && inherited && (
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-ink-tertiary">
              来自 {inheritedLabel ?? 'Project'}
            </span>
          )}
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-ink-tertiary" strokeWidth={1.8} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={5} className="w-[292px] p-3">
        <ExpectedWindowForm
          value={value}
          inherited={inherited}
          onSubmit={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ExpectedWindowForm({
  value,
  inherited,
  onSubmit,
}: {
  value?: ExpectedWindow;
  inherited?: ExpectedWindow;
  onSubmit: (value: ExpectedWindow | undefined) => void;
}) {
  const initial = useMemo(() => value ?? inherited ?? weekWindow(new Date()), [value, inherited]);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const normalized = normalizeExpectedWindow(draft);
  const presets = [
    { label: '今天', value: dayWindow(new Date()) },
    { label: '本周', value: weekWindow(new Date()) },
    { label: '下周', value: weekWindow(addDays(new Date(), 7)) },
    { label: '本月', value: monthWindow(new Date()) },
    { label: '下月', value: monthWindow(addMonths(new Date(), 1)) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          预期窗口
        </span>
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
          用于安排时提醒，不会自动占用具体日期。
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const active =
            preset.value.startDate === draft.startDate &&
            preset.value.endDate === draft.endDate;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => setDraft(preset.value)}
              className={clsx(
                'rounded-sm px-2 py-1 text-xs transition',
                active
                  ? 'bg-ink-primary text-surface-0'
                  : 'bg-surface-2 text-ink-secondary hover:text-ink-primary',
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input
          type="date"
          value={draft.startDate}
          onChange={(event) =>
            setDraft({
              startDate: event.target.value,
              endDate: draft.endDate,
              precision: event.target.value === draft.endDate ? 'day' : 'range',
            })
          }
          className="h-8 min-w-0 rounded-md border border-hairline/60 bg-surface-0 px-2 font-mono text-xs text-ink-primary outline-none focus:border-ink-secondary"
        />
        <span className="text-ink-tertiary">→</span>
        <input
          type="date"
          value={draft.endDate}
          onChange={(event) =>
            setDraft({
              startDate: draft.startDate,
              endDate: event.target.value,
              precision: draft.startDate === event.target.value ? 'day' : 'range',
            })
          }
          className="h-8 min-w-0 rounded-md border border-hairline/60 bg-surface-0 px-2 font-mono text-xs text-ink-primary outline-none focus:border-ink-secondary"
        />
      </div>
      {!normalized && (
        <p className="text-xs text-red-500">结束日期需要晚于或等于开始日期。</p>
      )}
      <div className="flex items-center justify-between pt-1">
        {value && (
          <button
            type="button"
            onClick={() => onSubmit(undefined)}
            className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-red-500"
          >
            <X className="h-3 w-3" strokeWidth={1.8} />
            {inherited ? '清除，改为沿用 Project' : '清除预期'}
          </button>
        )}
        <button
          type="button"
          disabled={!normalized}
          onClick={() => normalized && onSubmit(normalized)}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-ink-primary px-2.5 py-1.5 text-xs text-surface-0 transition hover:opacity-90 disabled:opacity-40"
        >
          <Check className="h-3 w-3" strokeWidth={2} />
          保存
        </button>
      </div>
    </div>
  );
}

function dateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  return next;
}

function dayWindow(date: Date): ExpectedWindow {
  const value = dateOnly(date);
  return { startDate: value, endDate: value, precision: 'day' };
}

function weekWindow(date: Date): ExpectedWindow {
  const monday = new Date(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  return {
    startDate: dateOnly(monday),
    endDate: dateOnly(addDays(monday, 6)),
    precision: 'week',
  };
}

function monthWindow(date: Date): ExpectedWindow {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    startDate: dateOnly(first),
    endDate: dateOnly(last),
    precision: 'month',
  };
}
