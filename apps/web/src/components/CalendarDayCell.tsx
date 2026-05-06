import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Check, Plus, X, Pencil } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './primitives/Popover';
import type { TemplateKey } from '@/data/sampleTemplate';
import type { RailColor } from '@/data/sample';
import type { ExternalEvent, UserDayNote } from '@dayrail/core';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
} from './railColors';
import { ExternalEventChip } from './ExternalEventChip';

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
  /** ERD §14 — holiday + user-note ExternalEvents rendered as chips
   *  in the cell footer (below the template badge). */
  externalEvents: ExternalEvent[];
  /** ERD §14.3 — user notes for this date (passed through alongside
   *  externalEvents so the popover's editor has the underlying entity
   *  ids, not just the chip mapping). */
  userNotes: UserDayNote[];
  onOverride: (date: string, tpl: TemplateKey) => void;
  onClearOverride: (date: string) => void;
  onCreateAdhoc: (
    date: string,
    opts: { name: string; startMinutes: number; durationMinutes: number },
  ) => void;
  onDeleteAdhoc: (id: string) => void;
  onUpsertNote: (
    date: string,
    opts: { id?: string; label: string; color?: RailColor },
  ) => void;
  onDeleteNote: (id: string) => void;
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
  externalEvents,
  userNotes,
  onOverride,
  onClearOverride,
  onCreateAdhoc,
  onDeleteAdhoc,
  onUpsertNote,
  onDeleteNote,
}: Props) {
  const [open, setOpen] = useState(false);
  const [adhocFormOpen, setAdhocFormOpen] = useState(false);
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  // Reset transient editor state when the popover closes so reopening
  // a different cell starts clean.
  useEffect(() => {
    if (!open) {
      setNoteFormOpen(false);
      setEditingNoteId(null);
      setAdhocFormOpen(false);
    }
  }, [open]);
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

          {/* Bottom: template label + ad-hoc titles + holiday/note chips */}
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
            {/* ERD §14 — external event chips (holidays / observances /
                user notes / makeup workdays). Rendered above the
                template badge so the day's "what's special" reads at
                the same level as the day shape. Cap = 3 chips visible
                + `+N` overflow; ordering is set by `selectExternalEventsOn`
                (user-notes first → holidays/observances → makeup). */}
            {externalEvents.length > 0 && (
              <div className="flex w-full flex-wrap items-center gap-1">
                {externalEvents.slice(0, 3).map((ev, i) => (
                  <ExternalEventChip
                    key={`${ev.sourceId}-${i}`}
                    event={ev}
                    shape="badge"
                    className="max-w-full truncate"
                  />
                ))}
                {externalEvents.length > 3 && (
                  <span className="font-mono text-2xs text-ink-tertiary">
                    +{externalEvents.length - 3}
                  </span>
                )}
              </div>
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
        {/* ERD §14 — read-only context line. Surfaces the day's
            holidays / observances / makeup-workdays (everything
            non-editable) so the popover reads as a complete day
            summary, not just an editor for what the user can change. */}
        <NonEditableContextRow events={externalEvents} />

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

        {/* ERD §14.3 — User day notes editor section. Above ad-hoc
            events because notes are a lighter-weight concept (one-line
            label, no time block) and users add them more often. */}
        <div className="px-3 pb-1 pt-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            备注
          </span>
        </div>
        <ul className="flex flex-col">
          {userNotes.map((note) =>
            editingNoteId === note.id ? (
              <li key={note.id}>
                <UserDayNoteForm
                  initialLabel={note.label}
                  initialColor={note.color}
                  onSubmit={(opts) => {
                    onUpsertNote(date, { id: note.id, ...opts });
                    setEditingNoteId(null);
                  }}
                  onCancel={() => setEditingNoteId(null)}
                  onDelete={() => {
                    onDeleteNote(note.id);
                    setEditingNoteId(null);
                  }}
                />
              </li>
            ) : (
              <li
                key={note.id}
                className="flex items-center gap-2 rounded-md px-3 py-1 hover:bg-surface-2"
              >
                <span
                  aria-hidden
                  className="h-2 w-[2px] shrink-0 rounded-sm"
                  style={{
                    background: note.color
                      ? RAIL_COLOR_HEX[note.color]
                      : 'rgb(var(--ink-tertiary) / 0.4)',
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-primary">
                  {note.label}
                </span>
                <button
                  type="button"
                  aria-label="Edit note"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingNoteId(note.id);
                  }}
                  className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
                >
                  <Pencil className="h-3 w-3" strokeWidth={1.8} />
                </button>
              </li>
            ),
          )}
        </ul>
        {noteFormOpen ? (
          <UserDayNoteForm
            onSubmit={(opts) => {
              onUpsertNote(date, opts);
              setNoteFormOpen(false);
            }}
            onCancel={() => setNoteFormOpen(false)}
          />
        ) : (
          editingNoteId === null && (
            <button
              type="button"
              onClick={() => setNoteFormOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              <Plus className="h-3 w-3" strokeWidth={1.8} />
              添加备注
            </button>
          )
        )}

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

/** Read-only context row shown at the very top of the day popover.
 *  Lists every non-editable ExternalEvent on the day (holidays,
 *  observances, makeup-workdays) — user notes are excluded because
 *  the popover already has a dedicated editable "备注" section for
 *  them. Returns null when there's nothing to show, keeping the
 *  popover clean for empty days. */
function NonEditableContextRow({ events }: { events: ExternalEvent[] }) {
  const contextual = events.filter(
    (e) => e.kind === 'holiday' || e.kind === 'observance' || e.kind === 'makeup-workday',
  );
  if (contextual.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 px-3 pb-1 pt-1.5">
        {contextual.map((ev, i) => (
          <ExternalEventChip
            key={`${ev.sourceId}-${i}`}
            event={ev}
            shape="badge"
            className="max-w-full truncate"
          />
        ))}
      </div>
      <div className="mx-3 my-1 h-px bg-surface-3" />
    </>
  );
}

const NOTE_COLOR_CHOICES: ReadonlyArray<RailColor> = [
  'sand',
  'sage',
  'slate',
  'brown',
  'amber',
  'teal',
  'pink',
  'grass',
  'indigo',
  'plum',
];

/** Inline editor for user-defined day notes (ERD §14.3). Form contract:
 *   - `label` required (trimmed); empty submission is a no-op.
 *   - `color` optional (one of Radix-10 RailColor; undefined = default neutral).
 *   - `onDelete` shown only when editing an existing note.
 *  Save / cancel / delete close the editor; the caller handles the
 *  underlying state mutation. */
function UserDayNoteForm({
  initialLabel = '',
  initialColor,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initialLabel?: string;
  initialColor?: RailColor;
  onSubmit: (opts: { label: string; color?: RailColor }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState<RailColor | undefined>(initialColor);
  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onSubmit({
      label: trimmed,
      ...(color !== undefined && { color }),
    });
  };
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <input
        type="text"
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="备注 (例如：妈妈生日)"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
      />
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setColor(undefined)}
          aria-label="No color"
          className={clsx(
            'h-4 w-4 rounded-full border transition',
            color === undefined
              ? 'border-ink-primary'
              : 'border-hairline hover:border-ink-tertiary',
          )}
          style={{ background: 'rgb(var(--surface-2))' }}
        />
        {NOTE_COLOR_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={c}
            className={clsx(
              'h-4 w-4 rounded-full border transition',
              color === c
                ? 'border-ink-primary'
                : 'border-hairline hover:border-ink-tertiary',
            )}
            style={{ background: RAIL_COLOR_HEX[c] }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-1.5 pt-0.5">
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-cta"
          >
            删除
          </button>
        ) : (
          <span aria-hidden />
        )}
        <div className="flex items-center gap-1.5">
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
    </div>
  );
}
