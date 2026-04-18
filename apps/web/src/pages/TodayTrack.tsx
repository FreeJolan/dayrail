import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  selectCheckinQueue,
  selectTodayTimeline,
  toIsoDate,
  useStore,
  type CarriedTaskRow,
  type Rail,
  type RailInstance,
  type Shift,
} from '@dayrail/core';
import {
  CheckInStrip,
  type CheckInAction,
  type CheckInEntry,
} from '@/components/CheckInStrip';
import { RailCard } from '@/components/RailCard';
import { ReasonToast } from '@/components/ReasonToast';
import { useReasonToast } from '@/components/useReasonToast';
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
  const railInstances = useStore((s) => s.railInstances);
  const tasks = useStore((s) => s.tasks);
  const shifts = useStore((s) => s.shifts);
  const markRailInstance = useStore((s) => s.markRailInstance);

  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'check-in-strip',
  );

  const handleCheckin = useCallback(
    (entry: CheckInEntry, action: CheckInAction) => {
      fire({
        taskId: entry.taskId,
        ...(entry.railInstanceId && { railInstanceId: entry.railInstanceId }),
        railId: entry.railId,
        railName: entry.railName,
        action,
      });
    },
    [fire],
  );

  // Timeline hover action bar: receives the RailInstance id. v0.4 we
  // look up the carrying Task so the write lands on `Task.status`; if
  // no Task exists for this (date, railId) we fall back to the legacy
  // RailInstance-only path (Stage 9 will remove the fallback).
  const handleTimelineAction = useCallback(
    (instanceId: string, action: CheckInAction) => {
      const inst = railInstances[instanceId];
      if (!inst) return;
      const rail = rails[inst.railId];
      if (!rail) return;
      const task = Object.values(tasks).find(
        (t) =>
          t.slot &&
          t.slot.date === inst.date &&
          t.slot.railId === inst.railId &&
          t.status !== 'deleted',
      );
      if (task) {
        fire({
          taskId: task.id,
          railInstanceId: instanceId,
          railId: rail.id,
          railName: rail.name,
          action,
        });
      } else {
        const nextStatus =
          action === 'done'
            ? 'done'
            : action === 'defer'
              ? 'deferred'
              : 'archived';
        void markRailInstance(instanceId, nextStatus);
      }
    },
    [tasks, rails, railInstances, fire, markRailInstance],
  );

  const timeline = useMemo<SampleRail[]>(
    () =>
      selectTodayTimeline({ railInstances }, today)
        .map((inst) => adaptToSample(inst, rails[inst.railId], now.asDate))
        .filter((r): r is SampleRail => r !== null),
    [railInstances, rails, today, now.asDate],
  );

  const checkinQueue = useMemo<CheckInEntry[]>(
    () =>
      selectCheckinQueue({ tasks, rails, railInstances }, now.asDate).map(
        (row) => carriedRowToCheckInEntry(row),
      ),
    [tasks, rails, railInstances, now.asDate],
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
      timeline
        .filter((r) => r.state === 'deferred')
        .map((r) => ({ ...r, tags: tagsForInstance(r.id, shifts) })),
    [timeline, shifts],
  );

  const handleRevert = useCallback(
    (instanceId: string) => {
      void markRailInstance(instanceId, 'pending');
    },
    [markRailInstance],
  );

  const handleResetDay = useCallback(() => {
    const todayInstances = Object.values(railInstances).filter(
      (i) => i.date === today && i.status !== 'pending',
    );
    if (todayInstances.length === 0) {
      window.alert('今日暂无需要重置的 Rail —— 所有实例都是 pending 状态。');
      return;
    }
    const msg = `把今日 ${todayInstances.length} 条已操作的 Rail 重置回模板状态（全部设为 pending）？此操作本身可通过再次 check-in 回复。`;
    if (!window.confirm(msg)) return;
    for (const inst of todayInstances) {
      void markRailInstance(inst.id, 'pending');
    }
  }, [railInstances, today, markRailInstance]);

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

// Pulled out so both the "Later" (deferred) strip and (in v0.3) the
// Pending page can share the same lookup rule: tags from the *most
// recent* Shift for this instance, capped at whatever the caller
// renders.
function tagsForInstance(
  instanceId: string,
  shifts: Record<string, { railInstanceId: string; at: string; tags?: string[] }>,
): string[] {
  let latest: { at: string; tags?: string[] } | undefined;
  for (const shift of Object.values(shifts)) {
    if (shift.railInstanceId !== instanceId) continue;
    if (!latest || shift.at > latest.at) latest = shift;
  }
  return latest?.tags ?? [];
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
// Domain → display adapter. RailInstance + Rail + wall-clock now give
// the 5-state SampleRail shape the existing components were built
// around. Encapsulated here so the component layer doesn't need to
// know about HLC / instance status rules.
// ------------------------------------------------------------------

function carriedRowToCheckInEntry(row: CarriedTaskRow): CheckInEntry {
  return {
    taskId: row.task.id,
    ...(row.railInstance && { railInstanceId: row.railInstance.id }),
    railId: row.rail.id,
    railName: row.rail.name,
    ...(row.rail.subtitle && { subtitle: row.rail.subtitle }),
    color: row.rail.color as CheckInEntry['color'],
    start: row.plannedStart.slice(11, 16) || '00:00',
    end: row.plannedEnd.slice(11, 16) || '00:00',
  };
}

function adaptToSample(
  inst: RailInstance,
  rail: Rail | undefined,
  now: Date,
): SampleRail | null {
  if (!rail) return null;
  const startMs = Date.parse(inst.plannedStart);
  const endMs = Date.parse(inst.plannedEnd);
  const nowMs = now.getTime();

  let state: RailState;
  if (inst.status === 'done') state = 'done';
  else if (inst.status === 'deferred') state = 'deferred';
  else if (inst.status === 'archived') state = 'archived';
  else if (!Number.isNaN(startMs) && startMs <= nowMs && nowMs <= endMs)
    state = 'current';
  else if (!Number.isNaN(endMs) && endMs < nowMs) state = 'unmarked';
  else state = 'pending';

  return {
    id: inst.id,
    name: rail.name,
    subtitle: rail.subtitle,
    start: inst.plannedStart.slice(11, 16) || '00:00',
    end: inst.plannedEnd.slice(11, 16) || '00:00',
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
