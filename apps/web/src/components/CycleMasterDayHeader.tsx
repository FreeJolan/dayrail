import { useState } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';
import {
  formatDayLabel,
  type CycleDay,
} from '@/data/sampleCycle';
import { SAMPLE_TEMPLATES } from '@/data/sampleTemplate';
import type { TemplateKey } from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';

// Compact master day header (ERD D3). Each day is a small button
// rendered in roughly 56 px of vertical space:
//   - weekday abbreviation (Mon / Tue ...)
//   - day number (tabular nums)
//   - 2 px Template.color strip beneath
// Template NAME is shown in tooltip/popover, not on the header itself.
// Overridden days wear a small bronze dot, not "覆盖" text.

// ERD §5.3 D3 — the top-of-page header row is the SOLE entry for
// switching a day's template. Each day is a small button; click opens
// a popover with the template options (single-day override only).

interface Props {
  days: CycleDay[];
  todayISO: string;
  onOverride: (date: string, nextTemplate: TemplateKey) => void;
  onClearOverride: (date: string) => void;
}

export function CycleMasterDayHeader({
  days,
  todayISO,
  onOverride,
  onClearOverride,
}: Props) {
  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Days
        </span>
        <span className="text-xs text-ink-tertiary">
          点击切换当日模板
        </span>
      </div>
      <ul className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <li key={day.date}>
            <DayButton
              day={day}
              isToday={day.date === todayISO}
              onOverride={(tpl) => onOverride(day.date, tpl)}
              onClearOverride={() => onClearOverride(day.date)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayButton({
  day,
  isToday,
  onOverride,
  onClearOverride,
}: {
  day: CycleDay;
  isToday: boolean;
  onOverride: (tpl: TemplateKey) => void;
  onClearOverride: () => void;
}) {
  const [open, setOpen] = useState(false);
  const template = SAMPLE_TEMPLATES.find((t) => t.key === day.templateKey)!;
  const { weekday, dayNum } = formatDayLabel(day);
  const tooltip = day.overridden
    ? `${template.label} · 覆盖`
    : template.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={tooltip}
          className={clsx(
            'group relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 pb-0 pt-1.5 text-left transition',
            isToday
              ? 'bg-surface-2 ring-1 ring-inset ring-ink-primary/60'
              : open
                ? 'bg-surface-2'
                : 'hover:bg-surface-1',
          )}
        >
          <div className="flex flex-1 items-baseline gap-2">
            <span
              className={clsx(
                'font-mono text-2xs uppercase tracking-widest',
                isToday ? 'text-ink-primary' : 'text-ink-tertiary',
              )}
            >
              {weekday}
            </span>
            <span
              className={clsx(
                'font-mono text-base tabular-nums',
                isToday ? 'font-medium text-ink-primary' : 'text-ink-primary',
              )}
            >
              {dayNum}
            </span>
          </div>
          {day.overridden && (
            <span
              aria-hidden
              title="overridden from the weekday default"
              className="h-1.5 w-1.5 rounded-full bg-cta"
            />
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 bottom-0 block h-[2px] rounded-full"
            style={{ background: RAIL_COLOR_HEX[template.color] }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-[200px] p-1">
        <div className="px-3 pb-1 pt-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Day template
          </span>
        </div>
        <ul className="flex flex-col">
          {SAMPLE_TEMPLATES.map((t) => {
            const active = t.key === day.templateKey;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => {
                    onOverride(t.key);
                    setOpen(false);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition',
                    active ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-3 w-[3px] rounded-sm"
                    style={{ background: RAIL_COLOR_HEX[t.color] }}
                  />
                  <span className="flex-1">{t.label}</span>
                  {active && (
                    <Check className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={2} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {day.overridden && (
          <>
            <div className="mx-3 my-1 h-px bg-surface-3" />
            <button
              type="button"
              onClick={() => {
                onClearOverride();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              清除此日覆盖
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
