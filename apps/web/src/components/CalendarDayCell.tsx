import { useState } from 'react';
import { clsx } from 'clsx';
import { Check, Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './primitives/Popover';
import type { TemplateKey } from '@/data/sampleTemplate';
import type { RailColor } from '@/data/sample';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
} from './railColors';

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

export interface DayCellAdhoc {
  id: string;
  /** `HH:MM`-formatted start time; used for the inline label. */
  startLabel: string;
  /** `HH:MM–HH:MM` for tooltips / full title. */
  rangeLabel: string;
  name: string;
  color: RailColor;
  /** True when this Ad-hoc backs a Task's free-time schedule —
   *  drawer shows it read-only since deletion must go through
   *  `unscheduleTask` instead. */
  isTaskBacked: boolean;
}

export interface DayCellTemplateChoice {
  key: TemplateKey;
  label: string;
  color: RailColor;
}

interface Props {
  date: string;
  inMonth: boolean;
  weekday: number;
  dayNum: number;
  isToday: boolean;
  /** Currently applied template key for this date (after CalendarRule
   *  resolution + weekday heuristic fallback). Nullable for the rare
   *  "no template exists at all" edge case during first boot. */
  templateKey: TemplateKey | null;
  /** Whether the active template came from an explicit rule (single-
   *  date in v0.2; date-range / cycle in v0.3) rather than the
   *  heuristic — drives the overridden dot. */
  overridden: boolean;
  templateChoices: DayCellTemplateChoice[];
  adhocs: DayCellAdhoc[];
  onOverride: (date: string, tpl: TemplateKey) => void;
  onClearOverride: (date: string) => void;
  onCreateAdhoc: (
    date: string,
    opts: { name: string; startMinutes: number; durationMinutes: number },
  ) => void;
  onDeleteAdhoc: (id: string) => void;
}

const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarDayCell({
  date,
  inMonth,
  weekday,
  dayNum,
  isToday,
  templateKey,
  overridden,
  templateChoices,
  adhocs,
  onOverride,
  onClearOverride,
  onCreateAdhoc,
  onDeleteAdhoc,
}: Props) {
  const [open, setOpen] = useState(false);
  const [adhocFormOpen, setAdhocFormOpen] = useState(false);
  const template = templateChoices.find((t) => t.key === templateKey);
  const templateHex = template ? RAIL_COLOR_HEX[template.color] : undefined;
  const templateTint = template ? RAIL_COLOR_STEP_4[template.color] : undefined;
  const templateEdge = template ? RAIL_COLOR_STEP_6[template.color] : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'relative flex h-[104px] w-full flex-col items-start gap-2 overflow-hidden rounded-sm p-2 pl-4 pt-[10px] text-left transition',
            'hover:brightness-95',
            !inMonth && 'opacity-45',
            isToday && 'ring-2 ring-inset ring-ink-primary/70',
          )}
          style={{
            background: templateTint,
            borderTop: templateEdge ? `2px solid ${templateEdge}` : undefined,
          }}
        >
          {/* Left color strip — step-9 at 5px, prominent enough to
              read at a glance across the whole month grid. */}
          {templateHex && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[5px]"
              style={{ background: templateHex }}
            />
          )}
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
                  title="overridden from the weekday default"
                  className="h-1.5 w-1.5 rounded-full bg-cta"
                />
              )}
              {adhocs.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  title={`${a.rangeLabel} · ${a.name}`}
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
                {a.startLabel} {a.name}
              </span>
            ))}
            {adhocs.length > 2 && (
              <span className="font-mono text-2xs text-ink-tertiary">
                +{adhocs.length - 2}
              </span>
            )}
            <span
              className={clsx(
                'inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-2xs font-medium uppercase tracking-widest',
                !inMonth && 'opacity-60',
              )}
              style={
                inMonth && templateHex
                  ? { background: templateHex, color: '#fff' }
                  : { color: 'rgb(var(--ink-tertiary))' }
              }
            >
              {template?.label ?? templateKey ?? '—'}
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
          {templateChoices.map((t) => {
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

        <div className="px-3 pb-1 pt-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Ad-hoc events
          </span>
        </div>
        {adhocs.length === 0 && !adhocFormOpen && (
          <div className="px-3 py-1 text-xs text-ink-tertiary">暂无</div>
        )}
        <ul className="flex flex-col">
          {adhocs.map((ad) => (
            <li
              key={ad.id}
              className="flex items-center gap-2 rounded-md px-3 py-1 hover:bg-surface-2"
            >
              <span
                aria-hidden
                className="h-2 w-[2px] shrink-0 rounded-sm"
                style={{ background: RAIL_COLOR_HEX[ad.color] }}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-ink-primary">
                  {ad.name}
                </span>
                <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
                  {ad.rangeLabel}
                </span>
              </span>
              {ad.isTaskBacked ? (
                <span
                  title="由 Task 自由时间排期生成 —— 去 Tasks 视图移除"
                  className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary/70"
                >
                  task
                </span>
              ) : (
                <button
                  type="button"
                  aria-label="Delete event"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAdhoc(ad.id);
                  }}
                  className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
                >
                  <X className="h-3 w-3" strokeWidth={1.8} />
                </button>
              )}
            </li>
          ))}
        </ul>

        {adhocFormOpen ? (
          <AdhocForm
            onSubmit={(opts) => {
              onCreateAdhoc(date, opts);
              setAdhocFormOpen(false);
            }}
            onCancel={() => setAdhocFormOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdhocFormOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
            今日添加事件
          </button>
        )}

        {overridden && (
          <>
            <div className="mx-3 my-1 h-px bg-surface-3" />
            <button
              type="button"
              onClick={() => {
                onClearOverride(date);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              恢复默认
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AdhocForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (opts: {
    name: string;
    startMinutes: number;
    durationMinutes: number;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('14:00');
  const [end, setEnd] = useState('15:00');
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const s = parseHHMM(start);
    const e = parseHHMM(end);
    if (s == null || e == null) return;
    if (e <= s) return;
    onSubmit({
      name: trimmed,
      startMinutes: s,
      durationMinutes: e - s,
    });
  };
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="事件名称"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
      />
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-1.5 font-mono text-xs tabular-nums text-ink-primary outline-none focus:border-ink-secondary"
        />
        <span className="font-mono text-2xs text-ink-tertiary">→</span>
        <input
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-1.5 font-mono text-xs tabular-nums text-ink-primary outline-none focus:border-ink-secondary"
        />
      </div>
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-sm bg-ink-primary px-2 py-0.5 text-2xs text-surface-0 transition hover:bg-ink-primary/90"
        >
          保存
        </button>
      </div>
    </div>
  );
}

function parseHHMM(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
