import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { MoreHorizontal } from 'lucide-react';
import {
  railAtDate,
  resolveEnabledHolidayRegions,
  selectCheckinQueue,
  selectExternalEventsOn,
  selectTodayTimeline,
  toIsoDate,
  useStore,
  type ExternalEvent,
  type RailBoundTaskRow,
  type Task,
  type TimelineRow,
} from '@dayrail/core';
import { EmptyTemplatesHint } from '@/components/EmptyTemplatesHint';
import { ExternalEventChip } from '@/components/ExternalEventChip';
import {
  CheckInStrip,
  type CheckInAction,
  type CheckInEntry,
} from '@/components/CheckInStrip';
import { RailCard, type TimelineTask } from '@/components/RailCard';
import { ReasonToast } from '@/components/ReasonToast';
import { ReflectionCard } from '@/components/ReflectionCard';
import { TaskDetailDrawer } from './Tasks';
import {
  latestTagsForTask,
  useReasonToast,
} from '@/components/useReasonToast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';
import type { RailColor } from '@/data/sample';

// Page layout — ERD A/B/C decisions:
//   • left sidebar nav (provided by App.tsx)
//   • simple `NOW` header, Mono date subtitle
//   • §5.6 check-in strip at top when queue is non-empty
//   • single vertical timeline of Rail cards — each card shows its
//     own per-task rows with independent actions (v0.4 multi-task)

const ONLY_WITH_TASKS_STORAGE_KEY = 'dayrail.todayTrack.onlyWithTasks';

export function TodayTrack() {
  const now = useLiveNow();
  const today = toIsoDate(now.asDate);

  const rails = useStore((s) => s.rails);
  const railRevisions = useStore((s) => s.railRevisions);
  const railTombstones = useStore((s) => s.railTombstones);
  const tasks = useStore((s) => s.tasks);
  const lines = useStore((s) => s.lines);
  const templates = useStore((s) => s.templates);
  const calendarRules = useStore((s) => s.calendarRules);
  const calendarRuleRevisions = useStore((s) => s.calendarRuleRevisions);
  const calendarRuleTombstones = useStore((s) => s.calendarRuleTombstones);
  const shifts = useStore((s) => s.shifts);
  const updateTask = useStore((s) => s.updateTask);
  const userDayNotes = useStore((s) => s.userDayNotes);
  const userProfile = useStore((s) => s.userProfile);
  const enabledHolidayRegions = useMemo(
    () => resolveEnabledHolidayRegions(userProfile),
    [userProfile],
  );
  const externalEvents = useMemo(
    () =>
      selectExternalEventsOn(today, {
        enabledHolidayRegions,
        userDayNotes,
      }),
    [today, enabledHolidayRegions, userDayNotes],
  );

  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  // "仅显示 Task" filter · default off · persisted to localStorage so
  // the choice survives reloads. When on, rails with zero tasks today
  // are hidden from the timeline. The check-in strip and PageHeader
  // are unaffected — only the per-rail timeline cards filter.
  const [onlyWithTasks, setOnlyWithTasks] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(ONLY_WITH_TASKS_STORAGE_KEY) === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      ONLY_WITH_TASKS_STORAGE_KEY,
      onlyWithTasks ? '1' : '0',
    );
  }, [onlyWithTasks]);

  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'check-in-strip',
  );

  const handleCheckin = useCallback(
    (entry: CheckInEntry, action: CheckInAction) => {
      fire({
        taskId: entry.taskId,
        railId: entry.railId,
        displayName: entry.railName,
        action,
      });
    },
    [fire],
  );

  const timelineRows = useMemo<TimelineRow[]>(
    () =>
      selectTodayTimeline(
        {
          rails,
          railRevisions,
          railTombstones,
          tasks,
          templates,
          calendarRules,
          calendarRuleRevisions,
          calendarRuleTombstones,
        },
        today,
      ),
    [
      rails,
      railRevisions,
      railTombstones,
      tasks,
      templates,
      calendarRules,
      calendarRuleRevisions,
      calendarRuleTombstones,
      today,
    ],
  );

  // Per-task UI state. Every task on every rail gets its own row — no
  // "primary task" shortcut. `state` is derived from Task.status plus
  // the rail's time window (past-ended pending → unmarked).
  const timelineCards = useMemo(
    () =>
      timelineRows.map((row) => ({
        rail: row.rail,
        isCurrent: isCurrentWindow(
          row.plannedStart,
          row.plannedEnd,
          now.asDate,
        ),
        start: row.plannedStart.slice(11, 16) || '00:00',
        end: row.plannedEnd.slice(11, 16) || '00:00',
        tasks: row.tasks.map<TimelineTask>((t) =>
          taskToTimelineTask(t, row, now.asDate, shifts),
        ),
      })),
    [timelineRows, now.asDate, shifts],
  );

  const handleTaskAction = useCallback(
    (taskId: string, action: CheckInAction) => {
      const task = tasks[taskId];
      if (!task) return;
      const railRev = task.slot
        ? railAtDate(
            { railRevisions, railTombstones },
            task.slot.railId,
            task.slot.date,
          )
        : undefined;
      fire({
        taskId,
        ...(railRev && { railId: railRev.railId }),
        displayName: railRev?.name ?? task.title,
        action,
      });
    },
    [tasks, railRevisions, railTombstones, fire],
  );

  // Settled task → pending. No Reason toast — this is the "undo, I
  // pressed the wrong thing" escape hatch.
  const handleTaskUndo = useCallback(
    (taskId: string) => {
      const task = tasks[taskId];
      if (!task) return;
      if (
        task.status !== 'done' &&
        task.status !== 'deferred' &&
        task.status !== 'archived' &&
        task.status !== 'pending' // unmarked lives as pending + past time
      ) {
        return;
      }
      void updateTask(taskId, {
        status: 'pending',
        doneAt: undefined,
        deferredAt: undefined,
        archivedAt: undefined,
      });
    },
    [tasks, updateTask],
  );

  const checkinQueue = useMemo<CheckInEntry[]>(
    () =>
      selectCheckinQueue(
        { tasks, railRevisions, railTombstones },
        now.asDate,
      ).map((row) => carriedRowToCheckInEntry(row)),
    [tasks, railRevisions, railTombstones, now.asDate],
  );

  // Reset today: sweep every Task carrying a today-slot and push it
  // back to `pending` (done/deferred/archived alike). Useful after a
  // bulk mis-tag.
  const handleResetDay = useCallback(() => {
    const todaysTasks = Object.values(tasks).filter(
      (t) =>
        t.slot?.date === today &&
        t.status !== 'pending' &&
        t.status !== 'deleted',
    );
    if (todaysTasks.length === 0) {
      window.alert('今日暂无需要重置的 Rail —— 所有任务都是 pending。');
      return;
    }
    const msg = `把今日 ${todaysTasks.length} 条已操作的任务重置回 pending？本次重置可通过再次 check-in 撤回。`;
    if (!window.confirm(msg)) return;
    for (const t of todaysTasks) {
      void updateTask(t.id, {
        status: 'pending',
        doneAt: undefined,
        deferredAt: undefined,
        archivedAt: undefined,
      });
    }
  }, [tasks, today, updateTask]);

  // Empty-templates branch — fresh install, no Drive snapshot pulled
  // yet, no manual template creation. Replaces the v0.7-era sample
  // seed (boot.ts comment dated 2026-05-08). Skip the check-in strip
  // and the timeline; still render the reflection card so the day's
  // free-text surface is available regardless of template state.
  const noTemplates = Object.keys(templates).length === 0;

  return (
    <div className="flex w-full max-w-[780px] flex-col gap-8 py-10 pl-10 pr-10 lg:pl-14 xl:pl-20">
      <PageHeader
        now={now}
        externalEvents={externalEvents}
        onResetDay={handleResetDay}
      />
      {noTemplates ? (
        <EmptyTemplatesHint />
      ) : (
        <>
          <CheckInStrip queue={checkinQueue} onAction={handleCheckin} />
          <Timeline
            cards={timelineCards}
            onlyWithTasks={onlyWithTasks}
            onToggleOnlyWithTasks={() => setOnlyWithTasks((v) => !v)}
            onTaskAction={handleTaskAction}
            onTaskUndo={handleTaskUndo}
            onTaskOpenDetail={(taskId) => setDetailTaskId(taskId)}
          />
        </>
      )}
      <ReflectionCard date={today} />
      <Footnote />
      <ReasonToast
        state={toast}
        onAddTag={handleAddTag}
        onUndo={handleUndo}
        onClose={handleClose}
      />

      {detailTaskId && tasks[detailTaskId] && (
        <TaskDetailDrawer
          task={tasks[detailTaskId]!}
          line={lines[tasks[detailTaskId]!.lineId]}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Live-now tick.
// ------------------------------------------------------------------

interface LiveNow {
  hh: number;
  mm: number;
  asDate: Date;
}

function useLiveNow(): LiveNow {
  const [now, setNow] = useState<LiveNow>(() => sample(new Date()));
  useEffect(() => {
    const tick = () => setNow(sample(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function sample(d: Date): LiveNow {
  return { hh: d.getHours(), mm: d.getMinutes(), asDate: d };
}

// ------------------------------------------------------------------
// Domain → display adapters.
// ------------------------------------------------------------------

function carriedRowToCheckInEntry(row: RailBoundTaskRow): CheckInEntry {
  return {
    taskId: row.task.id,
    railId: row.rail.id,
    railName: row.rail.name,
    taskTitle: row.task.title,
    ...(row.rail.subtitle && { subtitle: row.rail.subtitle }),
    color: row.rail.color as CheckInEntry['color'],
    start: row.plannedStart.slice(11, 16) || '00:00',
    end: row.plannedEnd.slice(11, 16) || '00:00',
  };
}

function isCurrentWindow(
  plannedStart: string,
  plannedEnd: string,
  now: Date,
): boolean {
  const startMs = Date.parse(plannedStart);
  const endMs = Date.parse(plannedEnd);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  const nowMs = now.getTime();
  return startMs <= nowMs && nowMs <= endMs;
}

function taskToTimelineTask(
  task: Task,
  row: TimelineRow,
  now: Date,
  shifts: ReturnType<typeof useStore.getState>['shifts'],
): TimelineTask {
  const subItems = task.subItems ?? [];
  let state: TimelineTask['state'];
  if (task.status === 'done') state = 'done';
  else if (task.status === 'deferred') state = 'deferred';
  else if (task.status === 'archived') state = 'archived';
  else {
    // pending / in-progress. Past-ended → unmarked, else pending.
    const endMs = Date.parse(row.plannedEnd);
    if (!Number.isNaN(endMs) && endMs < now.getTime()) state = 'unmarked';
    else state = 'pending';
  }
  const tags = latestTagsForTask(task.id, shifts);
  const trimmedNote = task.note?.trim() ?? '';
  return {
    id: task.id,
    title: task.title,
    state,
    hasNote: trimmedNote.length > 0,
    ...(trimmedNote.length > 0 && { note: trimmedNote }),
    subItemsDone: subItems.filter((s) => s.done).length,
    subItemsTotal: subItems.length,
    ...(task.milestonePercent != null && {
      milestonePercent: task.milestonePercent,
    }),
    isAutoTask: task.source === 'auto-habit',
    ...(tags.length > 0 && { tags }),
  };
}

// ------------------------------------------------------------------
// Presentational chrome.
// ------------------------------------------------------------------

function PageHeader({
  now,
  externalEvents,
  onResetDay,
}: {
  now: LiveNow;
  externalEvents: ExternalEvent[];
  onResetDay: () => void;
}) {
  const time = `${pad(now.hh)}:${pad(now.mm)}`;
  const dateStr = now.asDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const weekday = now.asDate.toLocaleDateString('en-GB', { weekday: 'short' });
  return (
    <header className="flex items-end justify-between gap-6 pt-2">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-ink-tertiary">
          Now
        </span>
        <div className="flex items-baseline gap-4">
          <h1 className="font-mono text-3xl text-ink-primary tabular-nums">
            {time}
          </h1>
          <span className="font-mono text-sm text-ink-secondary tabular-nums">
            {weekday} · {dateStr}
          </span>
        </div>
        {/* ERD §14 — today's external events (holidays + user notes).
            Renders below the date so the day's "what's special"
            doesn't compete with the time/date for the eye. */}
        {externalEvents.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {externalEvents.map((ev, i) => (
              <ExternalEventChip
                key={`${ev.sourceId}-${i}`}
                event={ev}
                shape="badge"
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-end gap-3">
        <DayProgressBar hh={now.hh} mm={now.mm} />
        <TodayMenu onResetDay={onResetDay} />
      </div>
    </header>
  );
}

function TodayMenu({ onResetDay }: { onResetDay: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Today actions"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[200px]">
        <DropdownMenuItem onSelect={onResetDay}>
          重置今日为模板
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A slim Mono-labelled progress slice — the day as a ruler.
 *  Treat this as a navigation echo, not a task-completion bar. */
function DayProgressBar({ hh, mm }: { hh: number; mm: number }) {
  const dayStartMin = 6 * 60;
  const dayEndMin = 24 * 60;
  const nowMin = hh * 60 + mm;
  const pct = Math.max(
    0,
    Math.min(100, ((nowMin - dayStartMin) / (dayEndMin - dayStartMin)) * 100),
  );
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Day · 06 → 24
      </span>
      <div className="relative h-[3px] w-[180px] overflow-hidden bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 bg-ink-secondary/70 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute -top-[3px] h-[9px] w-[1.5px] bg-cta transition-[left] duration-500"
          style={{ left: `calc(${pct}% - 0.75px)` }}
        />
      </div>
    </div>
  );
}

interface TimelineCard {
  rail: TimelineRow['rail'];
  isCurrent: boolean;
  start: string;
  end: string;
  tasks: TimelineTask[];
}

function Timeline({
  cards,
  onlyWithTasks,
  onToggleOnlyWithTasks,
  onTaskAction,
  onTaskUndo,
  onTaskOpenDetail,
}: {
  cards: TimelineCard[];
  onlyWithTasks: boolean;
  onToggleOnlyWithTasks: () => void;
  onTaskAction: (taskId: string, action: CheckInAction) => void;
  onTaskUndo: (taskId: string) => void;
  onTaskOpenDetail: (taskId: string) => void;
}) {
  const visibleCards = onlyWithTasks
    ? cards.filter((c) => c.tasks.length > 0)
    : cards;
  // Count label adapts when filtering: "M / N rails" makes it clear
  // some rails are hidden, vs the flat "N rails" when filter is off.
  const countLabel =
    onlyWithTasks && visibleCards.length !== cards.length
      ? `${visibleCards.length} / ${cards.length} rails`
      : `${cards.length} rails`;
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Today
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleOnlyWithTasks}
            aria-pressed={onlyWithTasks}
            title={
              onlyWithTasks
                ? '点击 · 显示所有 Rail（含没有 task 的）'
                : '点击 · 仅显示带 task 的 Rail'
            }
            className={clsx(
              'rounded-sm px-2 py-0.5 font-mono text-2xs uppercase tracking-widest transition',
              onlyWithTasks
                ? 'bg-cta text-cta-foreground'
                : 'bg-surface-1 text-ink-tertiary hover:bg-surface-2 hover:text-ink-secondary',
            )}
          >
            仅显示 Task
          </button>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {countLabel}
          </span>
        </div>
      </div>
      {visibleCards.length === 0 ? (
        <p className="text-sm text-ink-tertiary">
          {onlyWithTasks && cards.length > 0
            ? '今日没有带 task 的 Rail · 关掉「仅显示 Task」看全部。'
            : '今日没有需要显示的 Rail。'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visibleCards.map((c) => (
            <li key={c.rail.id}>
              <RailCard
                rail={{
                  id: c.rail.id,
                  name: c.rail.name,
                  ...(c.rail.subtitle && { subtitle: c.rail.subtitle }),
                  color: c.rail.color as RailColor,
                  start: c.start,
                  end: c.end,
                }}
                isCurrent={c.isCurrent}
                tasks={c.tasks}
                onTaskAction={onTaskAction}
                onTaskUndo={onTaskUndo}
                onTaskOpenDetail={onTaskOpenDetail}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Footnote() {
  return (
    <footer className="mt-4 flex justify-between font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>DayRail · v0.2</span>
    </footer>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
