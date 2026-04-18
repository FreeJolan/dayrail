import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  selectCheckinQueue,
  selectTodayTimeline,
  toIsoDate,
  useStore,
  type CarriedTaskRow,
  type Rail,
  type Task,
  type TimelineRow,
} from '@dayrail/core';
import {
  CheckInStrip,
  type CheckInAction,
  type CheckInEntry,
} from '@/components/CheckInStrip';
import { RailCard } from '@/components/RailCard';
import { ReasonToast } from '@/components/ReasonToast';
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
import type { RailColor, RailState, SampleRail } from '@/data/sample';

// Page layout — ERD A/B/C decisions:
//   • left sidebar nav (provided by App.tsx)
//   • simple `NOW` header, Mono date subtitle
//   • §5.6 check-in strip at top when queue is non-empty
//   • single vertical timeline of Rail cards (no bento, no side visualizer)

export function TodayTrack() {
  const now = useLiveNow();
  const today = toIsoDate(now.asDate);

  const rails = useStore((s) => s.rails);
  const tasks = useStore((s) => s.tasks);
  const templates = useStore((s) => s.templates);
  const calendarRules = useStore((s) => s.calendarRules);
  const shifts = useStore((s) => s.shifts);
  const updateTask = useStore((s) => s.updateTask);

  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'check-in-strip',
  );

  const handleCheckin = useCallback(
    (entry: CheckInEntry, action: CheckInAction) => {
      fire({
        taskId: entry.taskId,
        railId: entry.railId,
        railName: entry.railName,
        action,
      });
    },
    [fire],
  );

  // Timeline hover action bar. The `railId` identifies the row on
  // today's timeline. If the row has a carrying Task we fire on it;
  // bare rails (no Task) are no-op per ERD §5.6.
  const handleTimelineAction = useCallback(
    (railId: string, action: CheckInAction) => {
      const rail = rails[railId];
      if (!rail) return;
      const task = Object.values(tasks).find(
        (t) =>
          t.slot &&
          t.slot.date === today &&
          t.slot.railId === railId &&
          t.status !== 'deleted',
      );
      if (!task) return;
      fire({
        taskId: task.id,
        railId: rail.id,
        railName: rail.name,
        action,
      });
    },
    [tasks, rails, today, fire],
  );

  const timelineRows = useMemo<TimelineRow[]>(
    () =>
      selectTodayTimeline({ rails, tasks, templates, calendarRules }, today),
    [rails, tasks, templates, calendarRules, today],
  );

  const timeline = useMemo<SampleRail[]>(
    () => timelineRows.map((r) => adaptToSample(r, now.asDate)),
    [timelineRows, now.asDate],
  );

  const checkinQueue = useMemo<CheckInEntry[]>(
    () =>
      selectCheckinQueue({ tasks, rails }, now.asDate).map((row) =>
        carriedRowToCheckInEntry(row),
      ),
    [tasks, rails, now.asDate],
  );

  // Timeline hides two states:
  //   - 'unmarked' (past-ended pending) — lives in the check-in strip.
  //   - 'deferred' — "move me somewhere else" is explicit; keeping it
  //     on today's timeline would confuse "this is today" with "this
  //     needs re-scheduling". Deferred rails get their own section
  //     below check-in but above today's main list.
  //   'done' / 'archived' stay on the timeline so the user can see the
  //   full shape of today (including dropped items).
  const timelineVisible = timeline.filter(
    (r) => r.state !== 'unmarked' && r.state !== 'deferred',
  );
  const deferredToday = useMemo<DeferredRow[]>(
    () =>
      timelineRows
        .filter((r) => r.task?.status === 'deferred')
        .map((r) => ({
          ...adaptToSample(r, now.asDate),
          tags: r.task ? latestTagsForTask(r.task.id, shifts) : [],
        })),
    [timelineRows, shifts, now.asDate],
  );

  // Undefer / "put it back on today". DeferredSection keys rows on
  // railId (we're always today). Finds the carrying Task and resets
  // its status back to `pending`.
  const handleRevert = useCallback(
    (railId: string) => {
      const task = Object.values(tasks).find(
        (t) =>
          t.slot &&
          t.slot.date === today &&
          t.slot.railId === railId &&
          t.status !== 'deleted',
      );
      if (!task) return;
      void updateTask(task.id, {
        status: 'pending',
        doneAt: undefined,
        deferredAt: undefined,
        archivedAt: undefined,
      });
    },
    [tasks, today, updateTask],
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

  return (
    <div className="flex w-full max-w-[780px] flex-col gap-8 py-10 pl-10 pr-10 lg:pl-14 xl:pl-20">
      <PageHeader now={now} onResetDay={handleResetDay} />
      <CheckInStrip queue={checkinQueue} onAction={handleCheckin} />
      <DeferredSection rails={deferredToday} onUndefer={handleRevert} />
      <Timeline
        rails={timelineVisible}
        onAction={handleTimelineAction}
        onUndo={handleRevert}
      />
      <Footnote />
      <ReasonToast
        state={toast}
        onAddTag={handleAddTag}
        onUndo={handleUndo}
        onClose={handleClose}
      />
    </div>
  );
}

interface DeferredRow extends SampleRail {
  tags: string[];
}

// ------------------------------------------------------------------
// Live-now tick — updates every 30 s so "current rail" detection
// and the check-in strip refresh without the user touching anything.
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
// Domain → display adapter. v0.4: TimelineRow (rail + optional task +
// planned window) maps to the 5-state SampleRail the RailCard renders.
// Completion status comes from the carrying Task (ERD §10.1).
// ------------------------------------------------------------------

function carriedRowToCheckInEntry(row: CarriedTaskRow): CheckInEntry {
  return {
    taskId: row.task.id,
    railId: row.rail.id,
    railName: row.rail.name,
    ...(row.rail.subtitle && { subtitle: row.rail.subtitle }),
    color: row.rail.color as CheckInEntry['color'],
    start: row.plannedStart.slice(11, 16) || '00:00',
    end: row.plannedEnd.slice(11, 16) || '00:00',
  };
}

function adaptToSample(row: TimelineRow, now: Date): SampleRail {
  const { rail, task } = row;
  const startMs = Date.parse(row.plannedStart);
  const endMs = Date.parse(row.plannedEnd);
  const nowMs = now.getTime();

  let state: RailState;
  if (task?.status === 'done') state = 'done';
  else if (task?.status === 'deferred') state = 'deferred';
  else if (task?.status === 'archived') state = 'archived';
  else if (!Number.isNaN(startMs) && startMs <= nowMs && nowMs <= endMs)
    state = 'current';
  else if (!Number.isNaN(endMs) && endMs < nowMs) state = 'unmarked';
  else state = 'pending';

  return {
    // v0.4: SampleRail.id carries the rail id (was RailInstance.id in v0.3).
    // Timeline is always one date so this is collision-free.
    id: rail.id,
    name: rail.name,
    subtitle: rail.subtitle,
    start: row.plannedStart.slice(11, 16) || '00:00',
    end: row.plannedEnd.slice(11, 16) || '00:00',
    color: rail.color as RailColor,
    state,
    showInCheckin: rail.showInCheckin,
  };
}

// ------------------------------------------------------------------
// Presentational chrome.
// ------------------------------------------------------------------

function PageHeader({
  now,
  onResetDay,
}: {
  now: LiveNow;
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

function Timeline({
  rails,
  onAction,
  onUndo,
}: {
  rails: SampleRail[];
  onAction: (instanceId: string, action: CheckInAction) => void;
  onUndo: (instanceId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel text="Today" right={`${rails.length} rails`} />
      {rails.length === 0 ? (
        <p className="text-sm text-ink-tertiary">今日没有需要显示的 Rail。</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rails.map((r) => (
            <li key={r.id}>
              <RailCard
                rail={r}
                onAction={(a) => onAction(r.id, a)}
                onUndo={() => onUndo(r.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// "Later" strip — today's deferred rails. Separate from the main
// timeline because they no longer belong to *today* (the user has
// said "I want to do this, but not now"). Grouped here so the user
// sees the pile they've accumulated + can undo in one click.
//
// v0.3 will add a "re-schedule" affordance that opens Cycle View
// pre-targeted at this rail; for v0.2 the only explicit re-schedule
// path is Undefer → rail goes back to `pending` on today's timeline.
function DeferredSection({
  rails,
  onUndefer,
}: {
  rails: DeferredRow[];
  onUndefer: (instanceId: string) => void;
}) {
  if (rails.length === 0) return null;
  return (
    <section
      aria-label="今日以后再说的 Rail"
      className="flex flex-col gap-2.5 rounded-md border border-hairline/40 bg-surface-1 p-4"
    >
      <SectionLabel text="以后再说" right={`${rails.length}`} />
      <ul className="flex flex-col divide-y divide-hairline/40">
        {rails.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
          >
            <span className="font-mono text-xs tabular-nums text-ink-tertiary">
              {r.start}–{r.end}
            </span>
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-sm text-ink-secondary">
                {r.name}
                {r.subtitle && (
                  <span className="ml-1 text-ink-tertiary">· {r.subtitle}</span>
                )}
              </span>
              {r.tags.length > 0 && (
                <span className="flex shrink-0 items-center gap-1">
                  {r.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-ink-tertiary"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onUndefer(r.id)}
              className="rounded-sm px-2 py-0.5 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              取消
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionLabel({ text, right }: { text: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {text}
      </span>
      {right && (
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {right}
        </span>
      )}
    </div>
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
