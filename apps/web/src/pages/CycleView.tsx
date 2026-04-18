import { useCallback, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useStore } from '@dayrail/core';
import type { TemplateKey } from '@/data/sampleTemplate';
import { EditSessionIndicator } from '@/components/EditSessionIndicator';
import { CycleSummaryStrip } from '@/components/CycleSummaryStrip';
import {
  CycleMasterDayHeader,
  type TemplateChoice,
} from '@/components/CycleMasterDayHeader';
import { CycleSection } from '@/components/CycleSection';
import { BacklogDrawer } from '@/components/BacklogDrawer';
import type { CycleDay, CycleSlot } from '@/data/sampleCycle';
import type { RailColor } from '@/data/sample';
import {
  deriveCycleFromStore,
  startOfWeekMonday,
  toIsoDate,
} from './cycleFromStore';

// ERD §5.3 Cycle View, first live-data pass.
//
// Scope of this commit:
//   - Reads templates / rails / tasks from the store.
//   - Renders a rolling 7-day window anchored on the Monday of the
//     week `anchorDate` falls in.
//   - Per-day Template is picked by a weekday heuristic
//     (pickTemplateForDate) — CalendarRule is not wired, so user
//     "override" clicks currently only update local state. Persisting
//     overrides + the Cycle picker popover come in later chunks.
//   - Backlog drawer still reads from sample data (chunk 2).
//   - Drag-drop to schedule lands in chunk 3.

export function CycleView() {
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [backlogOpen, setBacklogOpen] = useState(false);
  // Local-only override map until we wire the CalendarRule persistence
  // path in a subsequent chunk.
  const [overrides, setOverrides] = useState<Record<string, TemplateKey>>({});

  const templates = useStore((s) => s.templates);
  const rails = useStore((s) => s.rails);
  const tasks = useStore((s) => s.tasks);
  const scheduleTaskToRail = useStore((s) => s.scheduleTaskToRail);

  const weekStart = useMemo(() => startOfWeekMonday(anchorDate), [anchorDate]);

  const { cycle: baseCycle, railsByTemplate } = useMemo(
    () =>
      deriveCycleFromStore({ templates, rails, tasks }, weekStart),
    [templates, rails, tasks, weekStart],
  );

  // Fold local overrides into the derived cycle's days so the header
  // reacts immediately to user template switching.
  const cycle = useMemo(() => {
    if (Object.keys(overrides).length === 0) return baseCycle;
    return {
      ...baseCycle,
      days: baseCycle.days.map((d) => {
        const nextKey = overrides[d.date];
        if (!nextKey || nextKey === d.templateKey) return d;
        return { ...d, templateKey: nextKey, overridden: true };
      }),
    };
  }, [baseCycle, overrides]);

  const todayISO = toIsoDate(new Date());

  const templateChoices = useMemo<TemplateChoice[]>(
    () =>
      Object.values(templates).map((t) => ({
        key: t.key,
        label: t.name,
        color: (t.color ?? 'slate') as RailColor,
      })),
    [templates],
  );

  const overrideDay = useCallback(
    (date: string, nextTemplate: TemplateKey) => {
      setOverrides((prev) => ({ ...prev, [date]: nextTemplate }));
    },
    [],
  );

  const clearOverride = useCallback((date: string) => {
    setOverrides((prev) => {
      if (!(date in prev)) return prev;
      const { [date]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Group days by templateKey preserving first-appearance order.
  const groups = useMemo(() => {
    const seen = new Map<TemplateKey, CycleDay[]>();
    for (const d of cycle.days) {
      if (!seen.has(d.templateKey)) seen.set(d.templateKey, []);
      seen.get(d.templateKey)!.push(d);
    }
    return [...seen.entries()].map(([templateKey, days]) => ({ templateKey, days }));
  }, [cycle]);

  const slotMap = useMemo(() => {
    const m = new Map<string, CycleSlot>();
    for (const s of cycle.slots) m.set(`${s.railId}|${s.date}`, s);
    return m;
  }, [cycle]);

  // Unsaved-changes indicator — v0.2 just mirrors the override map size.
  // When the Cycle-View Edit Session is wired (a later chunk), this
  // reads session.changeCount instead.
  const changeCount = Object.keys(overrides).length;

  const handleDropTask = useCallback(
    (taskId: string, date: string, railId: string) => {
      void scheduleTaskToRail(taskId, {
        cycleId: `cycle-${date}`,
        date,
        railId,
      });
    },
    [scheduleTaskToRail],
  );

  const shiftWeek = useCallback((deltaDays: number) => {
    setAnchorDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + deltaDays);
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-screen w-full">
      <div className="flex min-w-0 flex-1 flex-col pl-10 pr-6 xl:pl-14">
        <TopBar
          label={formatWeekLabel(cycle.startDate, cycle.endDate)}
          changeCount={changeCount}
          onPrev={() => shiftWeek(-7)}
          onNext={() => shiftWeek(7)}
          onToday={() => setAnchorDate(new Date())}
        />

        <CycleSummaryStrip cycle={cycle} />

        <section
          aria-label="Cycle days overview"
          className="mt-6 rounded-md bg-surface-1 px-4 py-3"
        >
          <CycleMasterDayHeader
            days={cycle.days}
            todayISO={todayISO}
            templates={templateChoices}
            onOverride={overrideDay}
            onClearOverride={clearOverride}
          />
        </section>

        <div className="flex flex-col gap-5 pt-6 pb-16">
          {groups.map(({ templateKey, days }) => {
            const tmpl = templateChoices.find((t) => t.key === templateKey);
            const sectionRails = railsByTemplate[templateKey] ?? [];
            return (
              <CycleSection
                key={templateKey}
                templateKey={templateKey}
                templateLabel={tmpl?.label ?? templateKey}
                templateColor={tmpl?.color ?? 'slate'}
                rails={sectionRails}
                days={days}
                slotsByKey={slotMap}
                todayISO={todayISO}
                onDropTask={handleDropTask}
              />
            );
          })}

          {groups.length === 0 && (
            <section className="rounded-md border border-dashed border-hairline/60 bg-surface-1 px-6 py-8 text-sm text-ink-tertiary">
              没有 Template —— 去 Template Editor 建一条，这里会按日期自动分段。
            </section>
          )}

          <CycleFooter cycle={cycle} groupCount={groups.length} />
        </div>
      </div>

      <BacklogDrawer
        open={backlogOpen}
        onToggle={() => setBacklogOpen((v) => !v)}
      />
    </div>
  );
}

function TopBar({
  label,
  changeCount,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  changeCount: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 -mx-10 flex h-[52px] items-center justify-between gap-4 bg-surface-0 px-10">
      <div className="flex items-center gap-2">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Cycle
        </span>
        <div className="inline-flex items-center gap-1 rounded-md bg-surface-1 px-2 py-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous week"
            className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <Calendar className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.6} />
          <span className="font-mono text-sm tabular-nums text-ink-primary">
            {label}
          </span>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next week"
            className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
        <button
          type="button"
          onClick={onToday}
          className="rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          Today
        </button>
      </div>

      <div className="flex items-center gap-3">
        <EditSessionIndicator changeCount={changeCount} />
        <button
          type="button"
          aria-label="Cycle menu"
          className="rounded-sm p-1 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}

function CycleFooter({
  cycle,
  groupCount,
}: {
  cycle: { days: CycleDay[]; slots: CycleSlot[] };
  groupCount: number;
}) {
  return (
    <footer className="flex items-center justify-between pt-3 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>
        {cycle.days.length} days · {groupCount} sections · {cycle.slots.length} scheduled
      </span>
      <span>ERD §5.3 · live</span>
    </footer>
  );
}

function formatWeekLabel(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}
