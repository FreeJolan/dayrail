import { useState } from 'react';
import { clsx } from 'clsx';
import { Check, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './primitives/Popover';
import { SAMPLE_TEMPLATES } from '@/data/sampleTemplate';
import type { TemplateKey } from '@/data/sampleTemplate';
import { adhocOn, isOverridden, resolveTemplate } from '@/data/sampleCalendar';
import { RAIL_COLOR_HEX } from './railColors';

// Individual day cell on the Calendar month grid (ERD §5.4 F4).
//  · Background tinted with the applied Template.color at ~12% opacity
//    (step-9 with alpha is a cheap substitute for the step-2 the ERD
//    calls for without wiring a second palette map).
//  · Date number + weekday abbreviation, Mono, step-11.
//  · Overridden days wear a small bronze dot in the top-right.
//  · Ad-hoc events show up as small colored dots on the top-left.
//  · Today has a 2 px inset ring in ink-primary (G2 whitelist: border
//    used as a date marker, not as a structural separator — kept
//    deliberately restrained, no terracotta per G1).

interface Props {
  date: string;
  inMonth: boolean;
  weekday: number;
  dayNum: number;
  isToday: boolean;
  onOverride: (date: string, tpl: TemplateKey) => void;
  onClearOverride: (date: string) => void;
  onAddAdhoc: (date: string) => void;
}

const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarDayCell({
  date,
  inMonth,
  weekday,
  dayNum,
  isToday,
  onOverride,
  onClearOverride,
  onAddAdhoc,
}: Props) {
  const [open, setOpen] = useState(false);
  const { templateKey, fromRule } = resolveTemplate(date);
  const overridden = isOverridden(date);
  const adhocs = adhocOn(date);
  const template = SAMPLE_TEMPLATES.find((t) => t.key === templateKey);
  const templateHex = template ? RAIL_COLOR_HEX[template.color] : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'relative flex h-[104px] w-full flex-col items-start gap-2 rounded-sm p-2 text-left transition',
            'hover:brightness-95',
            !inMonth && 'opacity-45',
            isToday && 'ring-2 ring-inset ring-ink-primary/70',
          )}
          style={{
            background: templateHex ? `${templateHex}1A` : undefined,
          }}
        >
          {/* Top row: weekday label + OVR dot / ad-hoc dots */}
          <div className="flex w-full items-start justify-between gap-1">
            <div className="flex flex-col items-start leading-tight">
              <span
                className={clsx(
                  'font-mono text-2xs uppercase tracking-widest',
                  inMonth ? 'text-ink-tertiary' : 'text-ink-tertiary/60',
                )}
              >
                {WEEKDAY_SHORT_EN[weekday]}
              </span>
              <span
                className={clsx(
                  'font-mono text-lg tabular-nums',
                  isToday ? 'font-medium text-ink-primary' : 'text-ink-primary',
                )}
              >
                {dayNum}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
              {overridden && (
                <span
                  aria-hidden
                  title={fromRule === 'single-date' ? '单日覆盖' : '范围覆盖'}
                  className="h-1.5 w-1.5 rounded-full bg-cta"
                />
              )}
              {adhocs.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  title={`${a.start}–${a.end} · ${a.name}`}
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: RAIL_COLOR_HEX[a.color] }}
                />
              ))}
            </div>
          </div>

          {/* Bottom: template label + ad-hoc titles */}
          <div className="mt-auto flex w-full flex-col items-start gap-0.5">
            {adhocs.slice(0, 2).map((a) => (
              <span
                key={a.id}
                className="w-full truncate text-2xs text-ink-secondary"
              >
                <span
                  aria-hidden
                  className="mr-1 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle"
                  style={{ background: RAIL_COLOR_HEX[a.color] }}
                />
                {a.start} {a.name}
              </span>
            ))}
            {adhocs.length > 2 && (
              <span className="font-mono text-2xs text-ink-tertiary">
                +{adhocs.length - 2}
              </span>
            )}
            <span
              className={clsx(
                'font-mono text-2xs uppercase tracking-widest',
                inMonth ? 'text-ink-tertiary' : 'text-ink-tertiary/60',
              )}
            >
              {template?.label ?? templateKey}
            </span>
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" sideOffset={4} className="w-[220px] p-1">
        <div className="flex items-baseline justify-between px-3 pb-1 pt-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Day template
          </span>
          <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
            {date.slice(5)}
          </span>
        </div>
        <ul className="flex flex-col">
          {SAMPLE_TEMPLATES.map((t) => {
            const active = t.key === templateKey;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => {
                    onOverride(date, t.key);
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

        <div className="mx-3 my-1 h-px bg-surface-3" />

        <button
          type="button"
          onClick={() => {
            onAddAdhoc(date);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Plus className="h-3 w-3" strokeWidth={1.8} />
          今日添加 Ad-hoc Event
        </button>

        {overridden && (
          <button
            type="button"
            onClick={() => {
              onClearOverride(date);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            清除此日覆盖
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
