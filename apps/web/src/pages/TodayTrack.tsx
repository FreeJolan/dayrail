import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  selectCheckinQueue,
  selectTodayTimeline,
  toIsoDate,
  useStore,
  type Rail,
  type RailInstance,
  type ShiftType,
} from '@dayrail/core';
import { CheckInStrip, type CheckInAction } from '@/components/CheckInStrip';
import { RailCard } from '@/components/RailCard';
import {
  ReasonToast,
  type ReasonToastState,
  type ToastAction,
} from '@/components/ReasonToast';
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
  const shifts = useStore((s) => s.shifts);
  const recordSignal = useStore((s) => s.recordSignal);
  const recordShift = useStore((s) => s.recordShift);
  const markRailInstance = useStore((s) => s.markRailInstance);

  // Reason toast — shown for ~6s after every check-in action. Chips
  // accumulate here; we only persist a Shift record when the toast
  // closes (user is still allowed to Undo, which discards them).
  const [toast, setToast] = useState<ReasonToastState | null>(null);
  const toastTagsRef = useRef<string[]>([]);
  // Tracks which instance was just acted on — used by Undo to roll
  // the status back to 'pending' via a compensating status-change
  // event (the signal remains as audit).
  const toastInstanceRef = useRef<string | null>(null);

  const handleCheckin = useCallback(
    (instanceId: string, action: CheckInAction) => {
      const inst = railInstances[instanceId];
      const rail = inst ? rails[inst.railId] : undefined;
      if (!inst || !rail) return;

      void recordSignal(instanceId, action, 'check-in-strip');

      toastTagsRef.current = [];
      toastInstanceRef.current = instanceId;
      // In v0.2 every Rail has a `recurrence` (one-shot Rails aren't a
      // concept yet), so archiving today's instance is always the
      // "only today" case — that's what the toast hint is for.
      setToast({
        action: action as ToastAction,
        instanceId,
        railName: rail.name,
        isRecurring: true,
        recommendedTags: recommendedTagsFor(rail.id, railInstances, shifts),
      });
    },
    [railInstances, rails, recordSignal, shifts],
  );

  const handleToastAddTag = useCallback((tag: string) => {
    if (!toastTagsRef.current.includes(tag)) {
      toastTagsRef.current = [...toastTagsRef.current, tag];
    }
  }, []);

  const handleToastUndo = useCallback(() => {
    const id = toastInstanceRef.current;
    if (id) {
      void markRailInstance(id, 'pending');
    }
    toastTagsRef.current = [];
    toastInstanceRef.current = null;
  }, [markRailInstance]);

  const handleToastClose = useCallback(() => {
    const tags = toastTagsRef.current;
    const id = toastInstanceRef.current;
    const currentToast = toast;
    setToast(null);
    toastTagsRef.current = [];
    toastInstanceRef.current = null;
    // Only defer / archive produce Shift records. Done isn't a
    // deviation, and the ShiftType union refuses 'done' anyway.
    if (!id || !currentToast) return;
    if (currentToast.action === 'done') return;
    if (tags.length === 0) return;
    const shiftType: ShiftType = currentToast.action === 'defer' ? 'defer' : 'archive';
    void recordShift({
      id: `shift-${id}-${Date.now().toString(36)}`,
      railInstanceId: id,
      type: shiftType,
      at: new Date().toISOString(),
      payload: {},
      tags,
    });
  }, [recordShift, toast]);

  const timeline = useMemo<SampleRail[]>(
    () =>
      selectTodayTimeline({ railInstances }, today)
        .map((inst) => adaptToSample(inst, rails[inst.railId], now.asDate))
        .filter((r): r is SampleRail => r !== null),
    [railInstances, rails, today, now.asDate],
  );

  const checkinQueue = useMemo<SampleRail[]>(
    () =>
      selectCheckinQueue({ railInstances }, now.asDate)
        .map((inst) => adaptToSample(inst, rails[inst.railId], now.asDate))
        .filter((r): r is SampleRail => r !== null),
    [railInstances, rails, now.asDate],
  );

  // Timeline hides past-unmarked rails — those live in the strip. Done
  // / deferred / archived stay on the timeline so the user can see the
  // shape of today.
  const timelineVisible = timeline.filter((r) => r.state !== 'unmarked');

  return (
    <div className="flex w-full max-w-[780px] flex-col gap-8 py-10 pl-10 pr-10 lg:pl-14 xl:pl-20">
      <PageHeader now={now} />
      <CheckInStrip queue={checkinQueue} onAction={handleCheckin} />
      <Timeline rails={timelineVisible} />
      <Footnote />
      <ReasonToast
        state={toast}
        onAddTag={handleToastAddTag}
        onUndo={handleToastUndo}
        onClose={handleToastClose}
      />
    </div>
  );
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
// Recommended-tag picker — top 3 by frequency across this Rail's past
// Shifts. Runs inline at handler time (not a memo) because a toast
// firing isn't a render-driven event.
// ------------------------------------------------------------------

function recommendedTagsFor(
  railId: string,
  railInstances: Record<string, RailInstance>,
  shifts: Record<string, { railInstanceId: string; tags?: string[] }>,
): string[] {
  const counts = new Map<string, number>();
  for (const shift of Object.values(shifts)) {
    const inst = railInstances[shift.railInstanceId];
    if (!inst || inst.railId !== railId) continue;
    for (const tag of shift.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
}

// ------------------------------------------------------------------
// Domain → display adapter. RailInstance + Rail + wall-clock now give
// the 5-state SampleRail shape the existing components were built
// around. Encapsulated here so the component layer doesn't need to
// know about HLC / instance status rules.
// ------------------------------------------------------------------

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

function PageHeader({ now }: { now: LiveNow }) {
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
      <DayProgressBar hh={now.hh} mm={now.mm} />
    </header>
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

function Timeline({ rails }: { rails: SampleRail[] }) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel text="Today" right={`${rails.length} rails`} />
      {rails.length === 0 ? (
        <p className="text-sm text-ink-tertiary">今日没有需要显示的 Rail。</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rails.map((r) => (
            <li key={r.id}>
              <RailCard rail={r} />
            </li>
          ))}
        </ul>
      )}
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
