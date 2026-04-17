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
    <ul className="grid grid-cols-7 gap-1 pt-2">
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'group flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition',
            // Today gets a distinct background + a stronger ring so it
            // reads as "you are here" without borrowing terracotta
            // (which G1 locks to Current Rail / primary CTA / Replace).
            isToday
              ? 'bg-surface-2 ring-1 ring-inset ring-ink-primary/60'
              : open
                ? 'bg-surface-2'
                : 'hover:bg-surface-1',
          )}
        >
          <div className="flex w-full items-baseline justify-between">
            <span
              className={clsx(
                'font-mono text-2xs uppercase tracking-widest',
                isToday ? 'text-ink-primary' : 'text-ink-tertiary',
              )}
            >
              {weekday}
            </span>
            {day.overridden && (
              <span
                className="font-mono text-[9px] uppercase tracking-widest text-ink-tertiary"
                title="overridden from the weekday default"
              >
                覆盖
              </span>
            )}
          </div>
          <span
            className={clsx(
              'font-mono text-xl tabular-nums',
              isToday ? 'text-ink-primary font-medium' : 'text-ink-secondary',
            )}
          >
            {dayNum}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-[3px] w-5 rounded-full"
              style={{ background: RAIL_COLOR_HEX[template.color] }}
            />
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {template.label}
            </span>
          </span>
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
