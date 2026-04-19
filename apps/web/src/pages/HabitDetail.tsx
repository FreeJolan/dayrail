import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowUpRight, Check, Clock, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  findAffectedFutureAutoTasks,
  materializeAutoTasks,
  mondayOf,
  purgeFutureAutoTasks,
  selectHabitPhasesByLine,
  useStore,
  type HabitBinding,
  type Line,
  type Rail,
  type Task,
  type Template,
} from '@dayrail/core';
import { buildPhaseBands, type PhaseBand } from './reviewFromStore';
import { RAIL_COLOR_HEX, RAIL_COLOR_STEP_4, RAIL_COLOR_STEP_6, RAIL_COLOR_STEP_7 } from '@/components/railColors';
import { RailPicker } from '@/components/RailPicker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/primitives/Popover';
import type { RailColor } from '@/data/sample';

// ERD §5.5.0 v0.4 habit detail page.
//
// Layout:
//   ● <habit name>                     (header — outside this file)
//   ──────────────────────────────────
//   Rhythm (14-day mini heatmap)
//   Schedule (bound Rails list)
//   Phases (handled by the existing HabitPhasePanel, above the fold)
//   Notes (long-form text)
//   Danger zone
//
// A: read-only rhythm strip. Click-to-backfill (B) is a follow-up
// commit — this file keeps strip cells static for now.

const WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Props {
  habit: Line;
}

export function HabitDetail({ habit }: Props) {
  const rails = useStore((s) => s.rails);
  const templates = useStore((s) => s.templates);
  const tasks = useStore((s) => s.tasks);
  const habitBindings = useStore((s) => s.habitBindings);
  const habitPhases = useStore((s) => s.habitPhases);
  const updateLine = useStore((s) => s.updateLine);
  const navigate = useNavigate();

  // Materialise auto-tasks for the strip window on open — §10.2
  // trigger point "Habit 详情页节奏带打开". Materializer is idempotent
  // so re-running on every navigation is fine.
  const windowEnd = useMemo(() => todayIso(), []);
  const windowStart = useMemo(
    () => isoDatePlus(windowEnd, -(WINDOW_DAYS - 1)),
    [windowEnd],
  );
  useEffect(() => {
    void materializeAutoTasks({ startDate: windowStart, endDate: windowEnd });
    // Cycle View materialiser closes the Monday-anchored cycle when
    // the window fully covers it — here we also fire the adjacent
    // cycle so the current week / previous week both get marked.
    const monday = mondayOf(windowStart);
    const prevMonday = isoDatePlus(monday, -7);
    void materializeAutoTasks({
      startDate: prevMonday,
      endDate: isoDatePlus(prevMonday, 6),
    });
    void materializeAutoTasks({
      startDate: monday,
      endDate: isoDatePlus(monday, 6),
    });
  }, [windowStart, windowEnd]);

  const bindings = useMemo<HabitBinding[]>(
    () =>
      Object.values(habitBindings)
        .filter((b) => b.habitId === habit.id)
        .sort((a, b) => a.createdAt - b.createdAt),
    [habitBindings, habit.id],
  );

  const updateTask = useStore((s) => s.updateTask);

  // ERD §5.5.0 B rhythm-strip click-to-backfill: one click retroactively
  // writes a terminal status to every auto-task on that date for this
  // habit. "clear" reverts to pending + wipes stamp fields. Multi-rail
  // habits: the action applies to all (rhythm cells reduce per-day to
  // one summary already, so a single interaction maps to "fix this
  // day").
  const handleRhythmBackfill = useCallback(
    (date: string, action: BackfillAction) => {
      const affected = Object.values(tasks).filter(
        (t) =>
          t.lineId === habit.id &&
          t.source === 'auto-habit' &&
          t.slot?.date === date &&
          t.status !== 'deleted',
      );
      if (affected.length === 0) return;
      const nowIso = new Date().toISOString();
      for (const t of affected) {
        if (action === 'clear') {
          void updateTask(t.id, {
            status: 'pending',
            doneAt: undefined,
            deferredAt: undefined,
            archivedAt: undefined,
          });
        } else if (action === 'done') {
          void updateTask(t.id, {
            status: 'done',
            doneAt: nowIso,
            deferredAt: undefined,
            archivedAt: undefined,
          });
        } else if (action === 'deferred') {
          void updateTask(t.id, {
            status: 'deferred',
            deferredAt: nowIso,
            doneAt: undefined,
            archivedAt: undefined,
          });
        } else {
          void updateTask(t.id, {
            status: 'archived',
            archivedAt: nowIso,
            doneAt: undefined,
            deferredAt: undefined,
          });
        }
      }
    },
    [tasks, habit.id, updateTask],
  );

  // Phase-band overlay on the rhythm strip — shared helper lifted from
  // reviewFromStore so Review + HabitDetail render bands the same way.
  const phaseBands = useMemo<PhaseBand[]>(() => {
    const phases = selectHabitPhasesByLine({ habitPhases }, habit.id);
    if (phases.length === 0) return [];
    const dates: string[] = [];
    for (let t = 0; t < WINDOW_DAYS; t++) {
      dates.push(isoDatePlus(windowStart, t));
    }
    return buildPhaseBands(phases, dates);
  }, [habitPhases, habit.id, windowStart]);

  return (
    <div className="flex flex-col gap-8">
      <RhythmStrip
        habitId={habit.id}
        windowStart={windowStart}
        windowEnd={windowEnd}
        tasks={tasks}
        color={habit.color}
        phaseBands={phaseBands}
        onBackfill={handleRhythmBackfill}
      />

      <ScheduleList
        habit={habit}
        bindings={bindings}
        rails={rails}
        templates={templates}
        onGoToTemplate={(templateKey) => navigate(`/templates/${templateKey}`)}
      />

      <NotesSection line={habit} onCommit={(note) => updateLine(habit.id, { note })} />

      <DangerSection line={habit} onArchive={() => navigate('/tasks/inbox')} />
    </div>
  );
}

// ------------------------------------------------------------------
// Rhythm strip (14-day).
// ------------------------------------------------------------------

type CellState = 'done' | 'deferred' | 'archived' | 'pending' | 'empty';

type BackfillAction = 'done' | 'deferred' | 'archived' | 'clear';

function RhythmStrip({
  habitId,
  windowStart,
  windowEnd,
  tasks,
  color,
  phaseBands,
  onBackfill,
}: {
  habitId: string;
  windowStart: string;
  windowEnd: string;
  tasks: Record<string, Task>;
  color?: RailColor;
  /** HabitPhase bands for the 14-day window. Each band annotates the
   *  columns where one phase was active. */
  phaseBands?: PhaseBand[];
  /** Retroactively write a status to every auto-task on `date` for
   *  this habit. Disabled / omitted → cells stay read-only. */
  onBackfill?: (date: string, action: BackfillAction) => void;
}) {
  const dates = useMemo(() => {
    const out: string[] = [];
    for (let t = 0; t < WINDOW_DAYS; t++) {
      out.push(isoDatePlus(windowStart, t));
    }
    return out;
  }, [windowStart]);

  // Index auto-tasks by date. Habit has 1+ bound rails, so a single
  // date may have 1+ occurrences. We reduce to one cell per date:
  // worst-status wins (deferred > archived > pending > done > empty).
  const cellByDate = useMemo<Record<string, CellState>>(() => {
    const byDate: Record<string, CellState> = {};
    for (const d of dates) byDate[d] = 'empty';
    for (const t of Object.values(tasks)) {
      if (!t.slot) continue;
      if (t.lineId !== habitId) continue;
      const d = t.slot.date;
      if (d < windowStart || d > windowEnd) continue;
      byDate[d] = reduceCell(byDate[d]!, t.status);
    }
    return byDate;
  }, [dates, tasks, habitId, windowStart, windowEnd]);

  const accent: RailColor = (color ?? 'slate') as RailColor;

  return (
    <section aria-label="Habit rhythm" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Rhythm
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          最近 {WINDOW_DAYS} 天 · 点击回填
        </span>
      </header>
      {phaseBands && phaseBands.length > 0 && (
        <RhythmPhaseBandRow bands={phaseBands} totalCols={WINDOW_DAYS} />
      )}
      <div className="flex items-end gap-1">
        {dates.map((d) => (
          <RhythmCell
            key={d}
            date={d}
            state={cellByDate[d]!}
            accent={accent}
            isLast={d === windowEnd}
            {...(onBackfill && { onBackfill })}
          />
        ))}
      </div>
      <Legend />
    </section>
  );
}

function RhythmPhaseBandRow({
  bands,
  totalCols,
}: {
  bands: PhaseBand[];
  totalCols: number;
}) {
  // Mirrors Review's PhaseBandRow but flex-based to line up with the
  // cell row (which is also flex, not a table). Each band occupies
  // columns [startCol, endCol] inclusive; gaps between bands render
  // as empty flex filler so alignment stays exact.
  const sorted = [...bands].sort((a, b) => a.startCol - b.startCol);
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  for (const band of sorted) {
    if (band.startCol > cursor) {
      segments.push(
        <div
          key={`gap-${cursor}`}
          className="shrink-0"
          style={{ flex: `${band.startCol - cursor} 1 0` }}
        />,
      );
    }
    const span = band.endCol - band.startCol + 1;
    segments.push(
      <div
        key={`band-${band.phaseId}`}
        title={band.label}
        className="min-w-0 shrink-0 truncate rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-ink-secondary"
        style={{ flex: `${span} 1 0` }}
      >
        {band.label}
      </div>,
    );
    cursor = band.endCol + 1;
  }
  if (cursor < totalCols) {
    segments.push(
      <div
        key={`gap-${cursor}-tail`}
        className="shrink-0"
        style={{ flex: `${totalCols - cursor} 1 0` }}
      />,
    );
  }
  return <div className="flex items-center gap-1">{segments}</div>;
}

function RhythmCell({
  date,
  state,
  accent,
  isLast,
  onBackfill,
}: {
  date: string;
  state: CellState;
  accent: RailColor;
  isLast: boolean;
  onBackfill?: (date: string, action: BackfillAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const canBackfill = state !== 'empty' && !!onBackfill;

  const swatch = (
    <span
      aria-hidden
      className={clsx(
        'h-8 w-full rounded-sm transition',
        state === 'empty' && 'bg-surface-2',
        canBackfill && 'hover:ring-1 hover:ring-ink-tertiary/30',
      )}
      style={styleFor(state, accent)}
    />
  );

  const label = (
    <span
      className={clsx(
        'font-mono text-2xs tabular-nums',
        isLast ? 'text-ink-primary' : 'text-ink-tertiary',
      )}
    >
      {date.slice(5)}
    </span>
  );

  if (!canBackfill) {
    return (
      <div
        className="flex flex-1 flex-col items-center gap-1"
        title={`${date} · ${STATE_LABEL[state]}`}
      >
        {swatch}
        {label}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-1 flex-col items-center gap-1 rounded-sm text-left"
          title={`${date} · ${STATE_LABEL[state]} · 点击回填`}
          aria-label={`${date} · ${STATE_LABEL[state]}`}
        >
          {swatch}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={6} className="w-[200px] p-1">
        <div className="flex flex-col gap-0.5 px-3 py-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Backfill · {date}
          </span>
          <span className="text-xs text-ink-tertiary">
            当前 · {STATE_LABEL[state]}
          </span>
        </div>
        <ul className="flex flex-col">
          <BackfillOption
            current={state}
            target="done"
            label="完成"
            icon={Check}
            onSelect={() => {
              onBackfill(date, 'done');
              setOpen(false);
            }}
          />
          <BackfillOption
            current={state}
            target="deferred"
            label="以后再说"
            icon={Clock}
            onSelect={() => {
              onBackfill(date, 'deferred');
              setOpen(false);
            }}
          />
          <BackfillOption
            current={state}
            target="archived"
            label="跳过"
            icon={Archive}
            onSelect={() => {
              onBackfill(date, 'archived');
              setOpen(false);
            }}
          />
          <div className="mx-3 my-1 h-px bg-surface-3" />
          <BackfillOption
            current={state}
            target="pending"
            label="清除标记"
            icon={X}
            onSelect={() => {
              onBackfill(date, 'clear');
              setOpen(false);
            }}
          />
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function BackfillOption({
  current,
  target,
  label,
  icon: Icon,
  onSelect,
}: {
  current: CellState;
  target: CellState;
  label: string;
  icon: typeof Check;
  onSelect: () => void;
}) {
  const active = current === target;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition',
          active ? 'bg-surface-2 text-ink-primary' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
        )}
      >
        <Icon
          className="h-3.5 w-3.5 text-ink-tertiary"
          strokeWidth={1.8}
        />
        <span className="flex-1">{label}</span>
        {active && (
          <Check
            className="h-3.5 w-3.5 text-ink-tertiary"
            strokeWidth={2}
          />
        )}
      </button>
    </li>
  );
}

const STATE_LABEL: Record<CellState, string> = {
  done: '完成',
  deferred: '以后再说',
  archived: '跳过',
  pending: '未标记',
  empty: '不参与',
};

function reduceCell(prev: CellState, status: Task['status']): CellState {
  // Rank: lower wins (deferred flags a day as "problem"; done is best).
  const rank: Record<CellState, number> = {
    deferred: 0,
    archived: 1,
    pending: 2,
    done: 3,
    empty: 4,
  };
  let next: CellState;
  if (status === 'done') next = 'done';
  else if (status === 'deferred') next = 'deferred';
  else if (status === 'archived') next = 'archived';
  else if (status === 'pending') next = 'pending';
  else return prev;
  return rank[next] < rank[prev] ? next : prev;
}

function styleFor(state: CellState, color: RailColor): React.CSSProperties | undefined {
  if (state === 'done') return { background: RAIL_COLOR_HEX[color] };
  if (state === 'archived')
    return {
      background: 'var(--surface-1, #F9F9F8)',
      backgroundImage: `repeating-linear-gradient(-45deg, ${RAIL_COLOR_STEP_6[color]} 0 1.5px, transparent 1.5px 6px)`,
    };
  if (state === 'deferred')
    return {
      background: 'var(--surface-1, #F9F9F8)',
      backgroundImage: `repeating-linear-gradient(-45deg, ${RAIL_COLOR_STEP_7[color]} 0 1.5px, transparent 1.5px 6px)`,
    };
  if (state === 'pending') return { background: RAIL_COLOR_STEP_4[color] };
  return undefined;
}

function Legend() {
  return (
    <div className="flex items-center gap-3 font-mono text-2xs text-ink-tertiary">
      <LegendSwatch label="完成" className="bg-ink-primary/70" />
      <LegendSwatch label="以后再说" hatched tone="warn" />
      <LegendSwatch label="跳过" hatched tone="skip" />
      <LegendSwatch label="未标记" className="bg-surface-3" />
      <LegendSwatch label="不参与" className="bg-surface-2" />
    </div>
  );
}

function LegendSwatch({
  label,
  className,
  hatched,
  tone,
}: {
  label: string;
  className?: string;
  hatched?: boolean;
  tone?: 'warn' | 'skip';
}) {
  const hatchColor = tone === 'warn' ? '#d4a24c88' : '#9ca39c88';
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={clsx('block h-2.5 w-2.5 rounded-sm', className)}
        style={
          hatched
            ? {
                background: 'var(--surface-1, #F9F9F8)',
                backgroundImage: `repeating-linear-gradient(-45deg, ${hatchColor} 0 1.5px, transparent 1.5px 4px)`,
              }
            : undefined
        }
      />
      {label}
    </span>
  );
}

// ------------------------------------------------------------------
// Schedule list — bound Rails.
// ------------------------------------------------------------------

function ScheduleList({
  habit,
  bindings,
  rails,
  templates,
  onGoToTemplate,
}: {
  habit: Line;
  bindings: HabitBinding[];
  rails: Record<string, Rail>;
  templates: Record<string, Template>;
  onGoToTemplate: (templateKey: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const upsertHabitBinding = useStore((s) => s.upsertHabitBinding);
  const removeHabitBinding = useStore((s) => s.removeHabitBinding);
  const openEditSession = useStore((s) => s.openEditSession);
  const closeEditSession = useStore((s) => s.closeEditSession);
  const storeState = useStore.getState;

  const availableRails = useMemo(
    () =>
      Object.values(rails).sort((a, b) => {
        if (a.templateKey !== b.templateKey) {
          return a.templateKey.localeCompare(b.templateKey);
        }
        return a.startMinutes - b.startMinutes;
      }),
    [rails],
  );

  const handleAddBinding = useCallback(
    async (opts: { railId: string; weekdays?: number[] }) => {
      await upsertHabitBinding({
        habitId: habit.id,
        railId: opts.railId,
        ...(opts.weekdays && opts.weekdays.length > 0
          ? { weekdays: opts.weekdays }
          : {}),
      });
      // Materialize immediately so the rhythm strip shows today's /
      // upcoming auto-tasks without requiring a page reload. The
      // useEffect-based materialization only fires on window change.
      await materializeAutoTasks({
        startDate: todayIso(),
        endDate: isoDatePlus(todayIso(), 27),
      });
      setFormOpen(false);
    },
    [upsertHabitBinding, habit.id],
  );

  // ERD §10.3 — config-change purge. A habit schedule edit can
  // invalidate future pending auto-tasks. We (1) count how many would
  // be affected, (2) confirm with the user, (3) open an Edit Session
  // so save + purge + re-materialize are one undoable batch.
  const handleUpdateWeekdays = useCallback(
    async (bindingId: string, weekdays: number[] | undefined) => {
      const existing = bindings.find((b) => b.id === bindingId);
      if (!existing) return;
      const sameWeekdays = weekdaysEqual(existing.weekdays, weekdays);
      if (sameWeekdays) return; // no-op — skip confirm and purge

      const affected = findAffectedFutureAutoTasks(storeState(), {
        habitId: existing.habitId,
        railId: existing.railId,
      });

      if (affected.length > 0) {
        const ok = window.confirm(
          `更新「${habit.name}」在「${
            rails[existing.railId]?.name ?? existing.railId
          }」上的星期过滤\n` +
            `· ${affected.length} 个未开始的 auto-task 会在新配置下重新生成\n` +
            `· 已完成/跳过/归档的保留\n继续?`,
        );
        if (!ok) return;
      }

      const session = await openEditSession('habit-binding-edit');
      try {
        await upsertHabitBinding({
          id: bindingId,
          habitId: existing.habitId,
          railId: existing.railId,
          ...(weekdays && weekdays.length > 0 ? { weekdays } : {}),
        }, session.id);
        await purgeFutureAutoTasks(
          { habitId: existing.habitId, railId: existing.railId },
          session.id,
        );
        // Re-materialize the local rhythm-strip window so the change
        // is visible immediately.
        await materializeAutoTasks({
          startDate: todayIso(),
          endDate: isoDatePlus(todayIso(), 27),
        });
      } finally {
        await closeEditSession(session.id);
      }
    },
    [
      bindings,
      habit.name,
      rails,
      storeState,
      upsertHabitBinding,
      openEditSession,
      closeEditSession,
    ],
  );

  const handleRemoveBinding = useCallback(
    async (bindingId: string) => {
      const binding = bindings.find((b) => b.id === bindingId);
      if (!binding) return;
      const rail = rails[binding.railId];
      const affected = findAffectedFutureAutoTasks(storeState(), {
        habitId: binding.habitId,
        railId: binding.railId,
      });
      const lines = [
        `解除 habit「${habit.name}」与 rail「${rail?.name ?? binding.railId}」的绑定?`,
      ];
      if (affected.length > 0) {
        lines.push(
          `· ${affected.length} 个未开始的 auto-task 会被清理`,
          `· 已完成/跳过/归档的保留`,
        );
      } else {
        lines.push('未来不再生成 auto-task;过去已有的保留。');
      }
      if (!window.confirm(`${lines.join('\n')}\n继续?`)) return;

      const session = await openEditSession('habit-binding-remove');
      try {
        await removeHabitBinding(bindingId, session.id);
        await purgeFutureAutoTasks(
          { habitId: binding.habitId, railId: binding.railId },
          session.id,
        );
      } finally {
        await closeEditSession(session.id);
      }
    },
    [
      bindings,
      rails,
      habit.name,
      storeState,
      removeHabitBinding,
      openEditSession,
      closeEditSession,
    ],
  );

  return (
    <section aria-label="Habit schedule" className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Schedule
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {bindings.length} 条节奏
        </span>
      </header>
      {bindings.length === 0 && !formOpen && (
        <p className="rounded-md bg-surface-1 px-3 py-2.5 text-xs text-ink-tertiary">
          还没有绑定任何节奏。点下方「+ 新节奏」把此 habit 绑到 Template Editor 里已有的一条 rail。
        </p>
      )}
      {bindings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {bindings.map((binding) => {
            const rail = rails[binding.railId];
            if (!rail) return null;
            return (
              <ScheduleRow
                key={binding.id}
                binding={binding}
                rail={rail}
                templateName={templates[rail.templateKey]?.name ?? rail.templateKey}
                onGoToTemplate={() => onGoToTemplate(rail.templateKey)}
                onUpdateWeekdays={(weekdays) =>
                  void handleUpdateWeekdays(binding.id, weekdays)
                }
                onRemove={() => void handleRemoveBinding(binding.id)}
              />
            );
          })}
        </ul>
      )}
      {formOpen ? (
        <NewBindingForm
          rails={availableRails}
          templates={templates}
          onSubmit={(opts) => void handleAddBinding(opts)}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={availableRails.length === 0}
          className={clsx(
            'inline-flex items-center gap-1.5 self-start rounded-md border border-dashed px-3 py-1.5 text-xs transition',
            availableRails.length === 0
              ? 'cursor-not-allowed border-ink-tertiary/30 text-ink-tertiary/60'
              : 'border-ink-tertiary/50 text-ink-secondary hover:border-ink-secondary hover:text-ink-primary',
          )}
          title={
            availableRails.length === 0
              ? '先去 Template Editor 建一条 rail,再回来绑'
              : undefined
          }
        >
          <Plus className="h-3 w-3" strokeWidth={1.8} />
          新节奏
        </button>
      )}
    </section>
  );
}

function ScheduleRow({
  binding,
  rail,
  templateName,
  onGoToTemplate,
  onUpdateWeekdays,
  onRemove,
}: {
  binding: HabitBinding;
  rail: Rail;
  templateName: string;
  onGoToTemplate: () => void;
  onUpdateWeekdays: (weekdays: number[] | undefined) => void;
  onRemove: () => void;
}) {
  const start = formatMinutes(rail.startMinutes);
  const end = formatMinutes(rail.startMinutes + rail.durationMinutes);
  const [editingWeekdays, setEditingWeekdays] = useState(false);
  const calendarRules = useStore((s) => s.calendarRules);
  // Weekdays the rail's template is actually active on — derived from
  // the template's weekday-kind CalendarRule. Other rule kinds (single
  // date / cycle / date-range) are time-specific and not summarised
  // as a weekday set; fall back to "all seven" when no weekday rule
  // exists, which is the permissive choice.
  const templateActiveDays = useMemo(() => {
    const rule = calendarRules[`cr-weekday-${rail.templateKey}`];
    if (!rule || rule.kind !== 'weekday') return new Set([0, 1, 2, 3, 4, 5, 6]);
    const raw = (rule.value as { weekdays?: number[] }).weekdays;
    if (!raw || raw.length === 0) return new Set([0, 1, 2, 3, 4, 5, 6]);
    return new Set(raw);
  }, [calendarRules, rail.templateKey]);
  // binding.weekdays ∩ template-active-days. Empty = the binding
  // filters out every day the template fires on — no task ever
  // materializes. Classic pitfall: user picks weekdays=[Mon] for a
  // habit bound to a Restday rail.
  const uncoveredWeekdays = useMemo(() => {
    if (!binding.weekdays) return [];
    return binding.weekdays.filter((d) => !templateActiveDays.has(d));
  }, [binding.weekdays, templateActiveDays]);
  const bindingWouldFire = !binding.weekdays || uncoveredWeekdays.length < binding.weekdays.length;
  return (
    <li className="group flex items-start gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2">
      <span
        aria-hidden
        className="mt-1 h-5 w-[3px] shrink-0 rounded-sm"
        style={{ background: RAIL_COLOR_HEX[rail.color as RailColor] }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-ink-primary">{rail.name}</span>
          <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
            {start}–{end} · {templateName}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            限定星期
          </span>
          {editingWeekdays ? (
            <WeekdayPicker
              value={binding.weekdays}
              onCommit={(next) => {
                onUpdateWeekdays(next);
                setEditingWeekdays(false);
              }}
              onCancel={() => setEditingWeekdays(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingWeekdays(true)}
              className="inline-flex items-center gap-1 rounded-sm border border-dashed border-hairline/50 px-1.5 py-0.5 text-xs text-ink-secondary transition hover:border-ink-secondary hover:bg-surface-3 hover:text-ink-primary"
              title="点击编辑哪些星期生效"
            >
              {weekdaysLabel(binding.weekdays)}
              <Pencil className="h-3 w-3 text-ink-tertiary" strokeWidth={1.8} />
            </button>
          )}
        </div>
        {!bindingWouldFire && (
          <p className="rounded-sm bg-warn/20 px-1.5 py-0.5 text-2xs text-warn">
            ⚠ 限定星期与模板「{templateName}」实际生效的日期没有交集,这条
            binding 永远不会生成 task。去掉这些 weekday,或换到一条不同模板的 rail。
          </p>
        )}
        {bindingWouldFire && uncoveredWeekdays.length > 0 && (
          <p className="rounded-sm bg-warn/10 px-1.5 py-0.5 text-2xs text-warn">
            ⚠ 模板「{templateName}」不生效于{' '}
            {uncoveredWeekdays
              .sort((a, b) => a - b)
              .map((d) => ['日', '一', '二', '三', '四', '五', '六'][d])
              .map((n) => `周${n}`)
              .join(' / ')}
            ,这些日子不会物化任务。
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onGoToTemplate}
        className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
        title="去 Template Editor 改这条 rail"
      >
        Rail
        <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-tertiary transition hover:bg-surface-3 hover:text-warn"
        title="解除绑定"
      >
        <X className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </li>
  );
}

function weekdaysEqual(a?: number[], b?: number[]): boolean {
  const normA = a && a.length > 0 ? [...a].sort((x, y) => x - y) : [];
  const normB = b && b.length > 0 ? [...b].sort((x, y) => x - y) : [];
  if (normA.length !== normB.length) return false;
  return normA.every((v, i) => v === normB[i]);
}

function weekdaysLabel(weekdays?: number[]): string {
  if (!weekdays || weekdays.length === 0) return '每天(按 rail 循环)';
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  return weekdays
    .slice()
    .sort((a, b) => a - b)
    .map((w) => `周${names[w]}`)
    .join(' / ');
}

function WeekdayPicker({
  value,
  onCommit,
  onCancel,
}: {
  value?: number[];
  onCommit: (weekdays: number[] | undefined) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<number[]>(value ?? []);
  return (
    <div className="flex items-center gap-1">
      {['日', '一', '二', '三', '四', '五', '六'].map((name, idx) => {
        const active = draft.includes(idx);
        return (
          <button
            key={idx}
            type="button"
            onClick={() =>
              setDraft((prev) =>
                prev.includes(idx)
                  ? prev.filter((x) => x !== idx)
                  : [...prev, idx].sort(),
              )
            }
            className={clsx(
              'h-6 w-6 rounded-sm text-2xs transition',
              active
                ? 'bg-ink-primary text-surface-0'
                : 'bg-surface-2 text-ink-tertiary hover:bg-surface-3',
            )}
          >
            {name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onCommit(draft.length === 0 ? undefined : draft)}
        className="ml-1 rounded-sm bg-ink-primary px-2 py-0.5 text-2xs text-surface-0 transition hover:bg-ink-primary/90"
      >
        保存
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-sm px-1.5 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-3"
      >
        取消
      </button>
    </div>
  );
}

// Inline "create a new HabitBinding" form. Lets the user pick an
// existing rail + weekday filter; does NOT create new rails (for that
// they go to Template Editor).
function NewBindingForm({
  rails,
  templates,
  onSubmit,
  onCancel,
}: {
  rails: Rail[];
  templates: Record<string, Template>;
  onSubmit: (opts: { railId: string; weekdays?: number[] }) => void;
  onCancel: () => void;
}) {
  const [railId, setRailId] = useState(rails[0]?.id ?? '');
  const [weekdays, setWeekdays] = useState<number[]>([]);

  const submit = useCallback(() => {
    if (!railId) return;
    onSubmit({
      railId,
      ...(weekdays.length > 0 ? { weekdays } : {}),
    });
  }, [railId, weekdays, onSubmit]);

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-1 px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          选择 Rail
        </span>
        <RailPicker
          rails={rails}
          templates={templates}
          value={railId}
          onChange={setRailId}
          className="flex-1"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          限定星期
        </span>
        <span className="text-2xs text-ink-tertiary">
          (不选 = 按 rail 自己的循环)
        </span>
        {['日', '一', '二', '三', '四', '五', '六'].map((name, idx) => {
          const active = weekdays.includes(idx);
          return (
            <button
              key={idx}
              type="button"
              onClick={() =>
                setWeekdays((prev) =>
                  prev.includes(idx)
                    ? prev.filter((x) => x !== idx)
                    : [...prev, idx].sort(),
                )
              }
              className={clsx(
                'h-6 w-6 rounded-sm text-2xs transition',
                active
                  ? 'bg-ink-primary text-surface-0'
                  : 'bg-surface-2 text-ink-tertiary hover:bg-surface-3',
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!railId}
          className="rounded-md bg-ink-primary px-3 py-1 text-xs text-surface-0 transition hover:bg-ink-primary/90 disabled:opacity-50"
        >
          绑定
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Notes.
// ------------------------------------------------------------------

function NotesSection({
  line,
  onCommit,
}: {
  line: Line;
  onCommit: (note: string) => void;
}) {
  const [draft, setDraft] = useState(line.note ?? '');
  useEffect(() => {
    setDraft(line.note ?? '');
  }, [line.id, line.note]);

  const commit = useCallback(() => {
    const trimmed = draft;
    if (trimmed === (line.note ?? '')) return;
    onCommit(trimmed);
  }, [draft, line.note, onCommit]);

  return (
    <section aria-label="Habit notes" className="flex flex-col gap-2">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Notes
      </span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder="写一些动机、目标或要记住的上下文…(失焦自动保存)"
        rows={4}
        className="resize-y rounded-md border border-hairline/60 bg-surface-0 px-3 py-2 text-sm leading-relaxed text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
      />
    </section>
  );
}

// ------------------------------------------------------------------
// Danger zone.
// ------------------------------------------------------------------

function DangerSection({
  line,
  onArchive,
}: {
  line: Line;
  onArchive: () => void;
}) {
  const updateLine = useStore((s) => s.updateLine);
  const deleteLine = useStore((s) => s.deleteLine);
  const handleArchive = useCallback(() => {
    const msg = `归档「${line.name}」?归档后不在主列表显示;随时可从"已归档"恢复。`;
    if (!window.confirm(msg)) return;
    void updateLine(line.id, {
      status: 'archived',
      archivedAt: Date.now(),
    });
    onArchive();
  }, [line, updateLine, onArchive]);
  const handleDelete = useCallback(() => {
    const msg = `把「${line.name}」移到回收站?关联的 auto-task 历史会保留在事件日志里,但列表不再显示。`;
    if (!window.confirm(msg)) return;
    void deleteLine(line.id);
    onArchive();
  }, [line, deleteLine, onArchive]);
  return (
    <section
      aria-label="Habit danger zone"
      className="flex flex-col gap-2 pt-2"
    >
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Danger
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleArchive}
          className="inline-flex items-center gap-1.5 rounded-md bg-surface-1 px-3 py-1.5 text-xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Archive className="h-3.5 w-3.5" strokeWidth={1.8} />
          归档此 habit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-warn"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          移到回收站
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------
// Helpers.
// ------------------------------------------------------------------

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoDatePlus(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

