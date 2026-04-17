import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  selectCheckinQueue,
  selectTodayTimeline,
  toIsoDate,
  useStore,
  type Rail,
  type RailInstance,
  type Shift,
} from '@dayrail/core';
import { CheckInStrip, type CheckInAction } from '@/components/CheckInStrip';
import { RailCard } from '@/components/RailCard';
import { ShiftSheet, type ShiftSubmission } from '@/components/ShiftSheet';
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
  const signals = useStore((s) => s.signals);
  const shifts = useStore((s) => s.shifts);
  const recordSignal = useStore((s) => s.recordSignal);
  const recordShift = useStore((s) => s.recordShift);
  const markRailInstance = useStore((s) => s.markRailInstance);

  // Shift sheet state. When open, `shiftTarget` identifies which instance
  // the user invoked Shift on. Resolved via the railInstances map at
  // render time so HMR / reducer updates don't leave stale refs.
  const [shiftTarget, setShiftTarget] = useState<string | null>(null);

  const handleCheckin = useCallback(
    (instanceId: string, action: CheckInAction) => {
      if (action === 'shift') {
        setShiftTarget(instanceId);
        return;
      }
      void recordSignal(instanceId, action, 'check-in-strip');
    },
    [recordSignal],
  );

  const targetInstance = shiftTarget ? railInstances[shiftTarget] : undefined;
  const targetRail = targetInstance ? rails[targetInstance.railId] : undefined;

  // Historical tags for the targeted Rail — top-3 by frequency across
  // past Shifts. Empty on first run, which the sheet falls back around.
  const recommendedTags = useMemo<string[]>(() => {
    if (!targetInstance) return [];
    const counts = new Map<string, number>();
    for (const shift of Object.values(shifts)) {
      // Same Rail (different days share the Rail id via instance) only.
      const inst = railInstances[shift.railInstanceId];
      if (!inst || inst.railId !== targetInstance.railId) continue;
      for (const tag of shift.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);
  }, [shifts, railInstances, targetInstance]);

  const handleShiftSubmit = useCallback(
    (sub: ShiftSubmission) => {
      if (!targetInstance) return;
      const id = targetInstance.id;
      const shift: Shift = {
        id: `shift-${id}-${Date.now().toString(36)}`,
        railInstanceId: id,
        type: sub.type,
        at: new Date().toISOString(),
        payload:
          sub.type === 'postpone' && sub.postponeMinutes
            ? { minutes: sub.postponeMinutes }
            : {},
        tags: sub.tags.length > 0 ? sub.tags : undefined,
        reason: sub.reason,
      };
      void (async () => {
        await recordShift(shift);
        if (sub.type === 'skip') {
          await markRailInstance(id, 'skipped');
          // Also log a signal so the instance leaves the strip.
          await recordSignal(id, 'skip', 'check-in-strip');
        }
        // Postpone mutates plannedStart/plannedEnd — slot the rail
        // later today (or tomorrow if it overflows). Time-shift is
        // its own event type so Review can show the delta without
        // scanning Shift payloads.
        if (sub.type === 'postpone' && sub.postponeMinutes) {
          await shiftPostpone(id, sub.postponeMinutes);
        }
        setShiftTarget(null);
      })();
    },
    [targetInstance, recordShift, markRailInstance, recordSignal],
  );

  const shiftInstanceTime = useStore((s) => s.shiftInstanceTime);
  const shiftPostpone = useCallback(
    async (instanceId: string, minutes: number): Promise<void> => {
      const state = useStore.getState();
      const inst = state.railInstances[instanceId];
      if (!inst) return;
      const shiftMs = minutes * 60_000;
      const fmt = (d: Date): string =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
          d.getHours(),
        )}:${pad(d.getMinutes())}`;
      const newStart = fmt(new Date(Date.parse(inst.plannedStart) + shiftMs));
      const newEnd = fmt(new Date(Date.parse(inst.plannedEnd) + shiftMs));
      await shiftInstanceTime(instanceId, newStart, newEnd);
    },
    [shiftInstanceTime],
  );

  const timeline = useMemo<SampleRail[]>(
    () =>
      selectTodayTimeline({ railInstances }, today)
        .map((inst) => adaptToSample(inst, rails[inst.railId], now.asDate))
        .filter((r): r is SampleRail => r !== null),
    [railInstances, rails, today, now.asDate],
  );

  const checkinQueue = useMemo<SampleRail[]>(
    () =>
      selectCheckinQueue({ railInstances, signals }, now.asDate)
        .map((inst) => adaptToSample(inst, rails[inst.railId], now.asDate))
        .filter((r): r is SampleRail => r !== null),
    [railInstances, signals, rails, now.asDate],
  );

  // Timeline hides the unmarked items — they already live in the strip.
  const timelineVisible = timeline.filter((r) => r.state !== 'unmarked');

  return (
    <div className="flex w-full max-w-[780px] flex-col gap-8 py-10 pl-10 pr-10 lg:pl-14 xl:pl-20">
      <PageHeader now={now} />
      <CheckInStrip queue={checkinQueue} onAction={handleCheckin} />
      <Timeline rails={timelineVisible} />
      <Footnote />
      <ShiftSheet
        open={shiftTarget != null && targetRail != null}
        railName={targetRail?.name ?? ''}
        recommendedTags={recommendedTags}
        onClose={() => setShiftTarget(null)}
        onSubmit={handleShiftSubmit}
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
  else if (inst.status === 'skipped') state = 'skipped';
  else if (inst.status === 'active') state = 'current';
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
