import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { INBOX_LINE_ID, useStore } from '@dayrail/core';
import type { TemplateKey } from '@/data/sampleTemplate';
import { CycleSummaryStrip } from '@/components/CycleSummaryStrip';
import {
  CycleSection,
  type TemplateChoice,
} from '@/components/CycleSection';
import { BacklogDrawer } from '@/components/BacklogDrawer';
import type { CycleDay, CycleSlot } from '@/data/sampleCycle';
import type { RailColor } from '@/data/sample';
import {
  deriveCycleFromStore,
  findOrphanTasksForTemplateSwitch,
  pickTemplateForDate,
  startOfWeekMonday,
  toIsoDate,
} from './cycleFromStore';

// ERD §5.3 Cycle View.
// Reads live store data (templates / rails / tasks / lines / calendarRules);
// renders a rolling 7-day window anchored on the Monday of the week
// `anchorDate` falls in. Per-day Template resolution goes through
// `pickTemplateForDate` — CalendarRule single-date overrides win,
// else a weekday heuristic picks workday / restday. Every mutation
// (drag-drop, template override, slot clear) is immediate-apply; the
// ERD §5.3.1 Edit Session stays out of scope for v0.2 (deferred to v0.3).

export function CycleView() {
  const navigate = useNavigate();
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [backlogOpen, setBacklogOpen] = useState(true);

  const templates = useStore((s) => s.templates);
  const rails = useStore((s) => s.rails);
  const tasks = useStore((s) => s.tasks);
  const lines = useStore((s) => s.lines);
  const calendarRules = useStore((s) => s.calendarRules);
  const railInstances = useStore((s) => s.railInstances);
  const scheduleTaskToRail = useStore((s) => s.scheduleTaskToRail);
  const unscheduleTask = useStore((s) => s.unscheduleTask);
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  const clearCycleDayOverride = useStore((s) => s.clearCycleDayOverride);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);

  const weekStart = useMemo(() => startOfWeekMonday(anchorDate), [anchorDate]);

  const { cycle, railsByTemplate } = useMemo(
    () =>
      deriveCycleFromStore(
        { templates, rails, tasks, lines, calendarRules, railInstances },
        weekStart,
      ),
    [templates, rails, tasks, lines, calendarRules, railInstances, weekStart],
  );

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

  // Compute orphans + gate a template switch behind a small confirm.
  // The switch itself is two steps: unschedule every orphan task, then
  // write the CalendarRule. If the user cancels we leave state
  // untouched.
  const applyTemplateSwitch = useCallback(
    async (
      date: string,
      nextTemplateKey: TemplateKey,
      apply: () => Promise<void>,
    ) => {
      const orphans = findOrphanTasksForTemplateSwitch(
        { tasks, rails },
        date,
        nextTemplateKey,
      );
      if (orphans.length > 0) {
        const templateName =
          templates[nextTemplateKey]?.name ?? nextTemplateKey;
        const msg = `切换到"${templateName}"会把这一天的 ${orphans.length} 个已排任务移出，可以随时从 Backlog 拖回来。继续？`;
        if (!window.confirm(msg)) return;
        for (const t of orphans) {
          await unscheduleTask(t.id);
        }
      }
      await apply();
    },
    [tasks, rails, templates, unscheduleTask],
  );

  const overrideDay = useCallback(
    (date: string, nextTemplate: TemplateKey) => {
      void applyTemplateSwitch(date, nextTemplate, () =>
        overrideCycleDay(date, nextTemplate),
      );
    },
    [applyTemplateSwitch, overrideCycleDay],
  );

  const clearOverride = useCallback(
    (date: string) => {
      // Resolve the heuristic pick (no rules) so orphan detection
      // runs against the template this day will fall back to.
      const target =
        pickTemplateForDate({ templates, calendarRules: {} }, date) ?? '';
      void applyTemplateSwitch(date, target, () =>
        clearCycleDayOverride(date),
      );
    },
    [applyTemplateSwitch, clearCycleDayOverride, templates],
  );

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

  const handleClearSlot = useCallback(
    (taskId: string) => {
      void unscheduleTask(taskId);
    },
    [unscheduleTask],
  );

  const handleMarkTaskDone = useCallback(
    (taskId: string) => {
      void updateTask(taskId, {
        status: 'done',
        doneAt: new Date().toISOString(),
      });
    },
    [updateTask],
  );

  const handleOpenTaskProject = useCallback(
    (taskId: string) => {
      const task = tasks[taskId];
      if (!task) return;
      // Inbox is its own nav entry in the Tasks view, so route it
      // specifically; everything else goes to /tasks/line/:lineId.
      const target =
        task.lineId === INBOX_LINE_ID
          ? '/tasks/inbox'
          : `/tasks/line/${task.lineId}`;
      navigate(target);
    },
    [navigate, tasks],
  );

  const lineLookup = useCallback(
    (taskId: string) => {
      const task = tasks[taskId];
      if (!task) return undefined;
      const line = lines[task.lineId];
      if (!line) return undefined;
      return { name: line.name, color: line.color };
    },
    [tasks, lines],
  );

  const handleQuickCreate = useCallback(
    (date: string, railId: string, title: string) => {
      // Default to the Rail's `defaultLineId` so the new task lands in
      // the Project the Rail's usually bound to (e.g. workday · code
      // slot → "DayRail 开发"). Falls back to Inbox.
      const rail = rails[railId];
      const lineId = rail?.defaultLineId ?? INBOX_LINE_ID;
      const maxOrder = Object.values(tasks)
        .filter((t) => t.lineId === lineId)
        .reduce((m, t) => Math.max(m, t.order), 0);
      void createTask({
        id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        lineId,
        title,
        order: maxOrder + 1,
        status: 'pending',
        slot: { cycleId: `cycle-${date}`, date, railId },
      });
    },
    [createTask, rails, tasks],
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
          onPrev={() => shiftWeek(-7)}
          onNext={() => shiftWeek(7)}
          onToday={() => setAnchorDate(new Date())}
        />

        <CycleSummaryStrip cycle={cycle} />

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
                templateChoices={templateChoices}
                onOverride={overrideDay}
                onClearOverride={clearOverride}
                onDropTask={handleDropTask}
                onClearSlot={handleClearSlot}
                onMarkTaskDone={handleMarkTaskDone}
                onOpenTaskProject={handleOpenTaskProject}
                onQuickCreate={handleQuickCreate}
                lineLookup={lineLookup}
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
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
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
