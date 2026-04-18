import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  pickTemplateForDate,
  toIsoDate,
} from './cycleFromStore';
import { findOrphanTasksForTemplateSwitch } from './cycleFromStore';
import {
  INBOX_LINE_ID,
  singleDateRuleId,
  useStore,
  type AdhocEvent,
} from '@dayrail/core';
import {
  CalendarDayCell,
  type DayCellAdhoc,
  type DayCellTemplateChoice,
} from '@/components/CalendarDayCell';
import { buildMonthGrid, monthLabel } from '@/data/sampleCalendar';
import type { TemplateKey } from '@/data/sampleTemplate';
import type { RailColor } from '@/data/sample';

// ERD §5.4 F4 — Calendar month view, live-data edition. Template
// resolution follows the same priority chain as Cycle View:
// `calendar-rule.upserted` (single-date) first, then the weekday
// heuristic. Advanced rules (weekday / cycle / date-range editable
// via a drawer) are v0.3 — the drawer button is off for v0.2 so the
// UI doesn't promise something it can't deliver.

// Suppress the unused-import warning since INBOX_LINE_ID is only used
// indirectly by the lib-pickTemplateForDate call chain.
void INBOX_LINE_ID;

export function Calendar() {
  const now = useMemo(() => new Date(), []);
  const [{ year, month }, setMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const todayIso = toIsoDate(now);

  const templates = useStore((s) => s.templates);
  const tasks = useStore((s) => s.tasks);
  const rails = useStore((s) => s.rails);
  const calendarRules = useStore((s) => s.calendarRules);
  const adhocEvents = useStore((s) => s.adhocEvents);
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  const clearCycleDayOverride = useStore((s) => s.clearCycleDayOverride);
  const unscheduleTask = useStore((s) => s.unscheduleTask);

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const templateChoices = useMemo<DayCellTemplateChoice[]>(
    () =>
      Object.values(templates).map((t) => ({
        key: t.key,
        label: t.name,
        color: (t.color ?? 'slate') as RailColor,
      })),
    [templates],
  );

  // Bucket active ad-hoc events by date so each cell pulls its own
  // slice in O(1). Deleted events are filtered; task-backed (free-
  // time scheduled) and standalone ad-hocs both render here.
  const adhocByDate = useMemo(() => {
    const m = new Map<string, DayCellAdhoc[]>();
    for (const ev of Object.values(adhocEvents)) {
      if (ev.status !== 'active') continue;
      const list = m.get(ev.date) ?? [];
      list.push(adhocToCell(ev));
      m.set(ev.date, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.startLabel.localeCompare(b.startLabel));
    return m;
  }, [adhocEvents]);

  const gotoPrev = () =>
    setMonth(({ year, month }) =>
      month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    );
  const gotoNext = () =>
    setMonth(({ year, month }) =>
      month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
    );
  const gotoToday = () =>
    setMonth({ year: now.getFullYear(), month: now.getMonth() + 1 });

  // Orphan-guarded switch — same logic as CycleView. Shared behavior
  // kept inline here (not re-exported) since there's no third caller
  // yet; promote to a hook if a fourth shows up.
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
        const templateName = templates[nextTemplateKey]?.name ?? nextTemplateKey;
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

  const handleOverride = useCallback(
    (date: string, nextTemplate: TemplateKey) => {
      void applyTemplateSwitch(date, nextTemplate, () =>
        overrideCycleDay(date, nextTemplate),
      );
    },
    [applyTemplateSwitch, overrideCycleDay],
  );

  const handleClearOverride = useCallback(
    (date: string) => {
      const target =
        pickTemplateForDate({ templates, calendarRules: {} }, date) ?? '';
      void applyTemplateSwitch(date, target, () =>
        clearCycleDayOverride(date),
      );
    },
    [applyTemplateSwitch, clearCycleDayOverride, templates],
  );

  return (
    <div className="flex w-full flex-col pl-10 pr-10 xl:pl-14">
      <TopBar
        year={year}
        month={month}
        onPrev={gotoPrev}
        onNext={gotoNext}
        onToday={gotoToday}
      />

      <WeekdayHeader />

      <div className="grid grid-cols-7 gap-1 pb-10">
        {cells.map((cell) => {
          const templateKey =
            pickTemplateForDate(
              { templates, calendarRules },
              cell.date,
            ) ?? null;
          const overridden = Boolean(
            calendarRules[singleDateRuleId(cell.date)],
          );
          return (
            <CalendarDayCell
              key={cell.date}
              date={cell.date}
              inMonth={cell.inMonth}
              weekday={cell.weekday}
              dayNum={cell.dayNum}
              isToday={cell.date === todayIso}
              templateKey={templateKey}
              overridden={overridden}
              templateChoices={templateChoices}
              adhocs={adhocByDate.get(cell.date) ?? []}
              onOverride={handleOverride}
              onClearOverride={handleClearOverride}
            />
          );
        })}
      </div>

      <Footer />
    </div>
  );
}

function adhocToCell(ev: AdhocEvent): DayCellAdhoc {
  const start = fmtHHMM(ev.startMinutes);
  const end = fmtHHMM(ev.startMinutes + ev.durationMinutes);
  return {
    id: ev.id,
    startLabel: start,
    rangeLabel: `${start}–${end}`,
    name: ev.name,
    color: (ev.color ?? 'slate') as RailColor,
  };
}

function fmtHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function TopBar({
  year,
  month,
  onPrev,
  onNext,
  onToday,
}: {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-[56px] items-center justify-between gap-4 bg-surface-0 pt-6">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-medium tracking-wide text-ink-primary">
          Calendar
        </span>
        <span aria-hidden className="h-4 w-px bg-hairline" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous month"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <span className="w-[140px] text-center font-mono text-sm tabular-nums text-ink-primary">
            {monthLabel(year, month)}
          </span>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next month"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="ml-2 rounded-md px-2 py-1 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            Today
          </button>
        </div>
      </div>
    </header>
  );
}

function WeekdayHeader() {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="hairline-b grid grid-cols-7 gap-1 py-3">
      {labels.map((w) => (
        <span
          key={w}
          className="pl-2 font-mono text-2xs uppercase tracking-widest text-ink-tertiary"
        >
          {w}
        </span>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex items-center justify-between font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>
        优先级 · 单日覆盖 → 星期启发
      </span>
      <span>ERD §5.4 · v0.2 live</span>
    </footer>
  );
}
