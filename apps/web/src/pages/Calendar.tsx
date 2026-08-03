import { useCallback, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { pickTemplateForDate, toIsoDate } from './cycleFromStore';
import {
  INBOX_LINE_ID,
  resolveEnabledHolidayRegions,
  selectCalendarAgenda,
  selectExternalEventsOn,
  selectUserDayNotesOn,
  singleDateRuleId,
  useStore,
  type AdhocEvent,
  type CalendarAgendaItem,
  type RailColor as CoreRailColor,
} from '@dayrail/core';
import {
  CalendarDayCell,
  type DayCellAdhoc,
  type DayCellTemplateChoice,
} from '@/components/CalendarDayCell';
import { CalendarRulesDrawer } from '@/components/CalendarRulesDrawer';
import { buildMonthGrid, monthLabel } from '@/data/sampleCalendar';
import type { TemplateKey } from '@/data/sampleTemplate';
import type { RailColor } from '@/data/sample';
import { TaskDetailDrawer } from './Tasks';

// ERD §5.4 F4 — Calendar month view, live-data edition. Template
// resolution follows the same priority chain as Cycle View:
// `calendar-rule.upserted` (single-date) first, then the typed rule
// variants (date-range / cycle / weekday), with `weekday:0..6` as
// the base layer. The ⚙︎ button opens the CalendarRulesDrawer for
// editing all four variants.

// Suppress the unused-import warning since INBOX_LINE_ID is only used
// indirectly by the lib-pickTemplateForDate call chain.
void INBOX_LINE_ID;

// Persist the visible {year, month} in sessionStorage so navigating
// to another tab (Cycle / Today / Review) and back keeps the user's
// place. Without this, the component remounts and resets to current
// month — annoying when the user is browsing a different month.
// sessionStorage (not localStorage) so a fresh browser session lands
// on the current month again, which matches "open the app today =
// see today" expectations.
const CALENDAR_MONTH_STORAGE_KEY = 'dayrail.calendar.viewedMonth';
const CALENDAR_LAYERS_STORAGE_KEY = 'dayrail.calendar.layers';

interface CalendarLayers {
  tasks: boolean;
  habits: boolean;
}

function readCalendarLayers(): CalendarLayers {
  if (typeof window === 'undefined') return { tasks: true, habits: false };
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CALENDAR_LAYERS_STORAGE_KEY) ?? '{}',
    ) as Partial<CalendarLayers>;
    return {
      tasks: typeof parsed.tasks === 'boolean' ? parsed.tasks : true,
      habits: typeof parsed.habits === 'boolean' ? parsed.habits : false,
    };
  } catch {
    return { tasks: true, habits: false };
  }
}

function readPersistedMonth(): { year: number; month: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CALENDAR_MONTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { year?: unknown; month?: unknown };
    if (
      typeof parsed.year === 'number' &&
      typeof parsed.month === 'number' &&
      parsed.month >= 1 &&
      parsed.month <= 12
    ) {
      return { year: parsed.year, month: parsed.month };
    }
  } catch {
    /* corrupt → ignore */
  }
  return null;
}

function persistMonth(value: { year: number; month: number }): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      CALENDAR_MONTH_STORAGE_KEY,
      JSON.stringify(value),
    );
  } catch {
    /* private browsing — non-fatal */
  }
}

export function Calendar() {
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const [{ year, month }, setMonthState] = useState(() =>
    readPersistedMonth() ?? {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    },
  );
  const setMonth = (
    updater:
      | { year: number; month: number }
      | ((prev: { year: number; month: number }) => {
          year: number;
          month: number;
        }),
  ) => {
    setMonthState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      persistMonth(next);
      return next;
    });
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [layers, setLayersState] = useState<CalendarLayers>(readCalendarLayers);
  const [detailTarget, setDetailTarget] = useState<{
    taskId: string;
    occurrenceId?: string;
    adhocId?: string;
    requestId: number;
  } | null>(null);
  const todayIso = toIsoDate(now);

  const templates = useStore((s) => s.templates);
  const calendarRules = useStore((s) => s.calendarRules);
  const calendarRuleRevisions = useStore((s) => s.calendarRuleRevisions);
  const calendarRuleTombstones = useStore((s) => s.calendarRuleTombstones);
  const adhocEvents = useStore((s) => s.adhocEvents);
  const lines = useStore((s) => s.lines);
  const tasks = useStore((s) => s.tasks);
  const taskOccurrences = useStore((s) => s.taskOccurrences);
  const rails = useStore((s) => s.rails);
  const railRevisions = useStore((s) => s.railRevisions);
  const railTombstones = useStore((s) => s.railTombstones);
  const habitBindings = useStore((s) => s.habitBindings);
  const habitBindingRevisions = useStore((s) => s.habitBindingRevisions);
  const habitBindingTombstones = useStore((s) => s.habitBindingTombstones);
  const userDayNotes = useStore((s) => s.userDayNotes);
  const userProfile = useStore((s) => s.userProfile);
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  const clearCycleDayOverride = useStore((s) => s.clearCycleDayOverride);
  const createAdhocEvent = useStore((s) => s.createAdhocEvent);
  const deleteAdhocEvent = useStore((s) => s.deleteAdhocEvent);
  const upsertUserDayNote = useStore((s) => s.upsertUserDayNote);
  const removeUserDayNote = useStore((s) => s.removeUserDayNote);
  const enabledHolidayRegions = useMemo(
    () => resolveEnabledHolidayRegions(userProfile),
    [userProfile],
  );

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const setLayers = (next: CalendarLayers) => {
    setLayersState(next);
    try {
      window.localStorage.setItem(CALENDAR_LAYERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The layer preference is optional in private browsing contexts.
    }
  };

  const templateChoices = useMemo<DayCellTemplateChoice[]>(
    () =>
      Object.values(templates).map((t) => ({
        key: t.key,
        label: t.name,
        color: (t.color ?? 'slate') as RailColor,
      })),
    [templates],
  );

  // Independent Ad-hoc rows keep their existing editable surface.
  // Task-backed Ad-hoc rows are projected through the Tasks layer so
  // they follow the toggle and never render twice.
  const adhocByDate = useMemo(() => {
    const m = new Map<string, DayCellAdhoc[]>();
    for (const ev of Object.values(adhocEvents)) {
      if (ev.status !== 'active' || ev.taskId) continue;
      const list = m.get(ev.date) ?? [];
      list.push(adhocToCell(ev));
      m.set(ev.date, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.startLabel.localeCompare(b.startLabel));
    return m;
  }, [adhocEvents]);

  const agendaByDate = useMemo(() => {
    const first = cells[0]?.date;
    const last = cells[cells.length - 1]?.date;
    const map = new Map<string, CalendarAgendaItem[]>();
    if (!first || !last) return map;
    const agenda = selectCalendarAgenda(
      {
        lines,
        tasks,
        taskOccurrences,
        adhocEvents,
        templates,
        calendarRules,
        calendarRuleRevisions,
        calendarRuleTombstones,
        habitBindings,
        habitBindingRevisions,
        habitBindingTombstones,
        rails,
        railRevisions,
        railTombstones,
        userDayNotes,
        userProfile,
      },
      {
        startDate: first,
        endDate: last,
        includeTasks: layers.tasks,
        includeHabits: layers.habits,
      },
    );
    for (const item of agenda) {
      const rows = map.get(item.date) ?? [];
      rows.push(item);
      map.set(item.date, rows);
    }
    return map;
  }, [
    cells,
    lines,
    tasks,
    taskOccurrences,
    adhocEvents,
    templates,
    calendarRules,
    calendarRuleRevisions,
    calendarRuleTombstones,
    habitBindings,
    habitBindingRevisions,
    habitBindingTombstones,
    rails,
    railRevisions,
    railTombstones,
    userDayNotes,
    userProfile,
    layers.tasks,
    layers.habits,
  ]);

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

  // Template switches no longer unschedule tasks whose rails don't
  // belong to the new template — those orphan tasks surface in the
  // Cycle view's Off-rail row, where the user can drag them back onto
  // any rail to recover. See CycleView for the rendering side.
  const handleOverride = useCallback(
    (date: string, nextTemplate: TemplateKey) => {
      void overrideCycleDay(date, nextTemplate);
    },
    [overrideCycleDay],
  );

  const handleClearOverride = useCallback(
    (date: string) => {
      void clearCycleDayOverride(date);
    },
    [clearCycleDayOverride],
  );

  const handleCreateAdhoc = useCallback(
    (
      date: string,
      opts: { name: string; startMinutes: number; durationMinutes: number },
    ) => {
      void createAdhocEvent({
        date,
        name: opts.name,
        startMinutes: opts.startMinutes,
        durationMinutes: opts.durationMinutes,
      });
    },
    [createAdhocEvent],
  );

  const handleDeleteAdhoc = useCallback(
    (id: string) => {
      void deleteAdhocEvent(id).catch((err: unknown) => {
        window.alert(err instanceof Error ? err.message : String(err));
      });
    },
    [deleteAdhocEvent],
  );

  const handleUpsertNote = useCallback(
    (
      date: string,
      opts: { id?: string; label: string; color?: CoreRailColor },
    ) => {
      void upsertUserDayNote({ date, ...opts });
    },
    [upsertUserDayNote],
  );

  const handleDeleteNote = useCallback(
    (id: string) => {
      void removeUserDayNote(id);
    },
    [removeUserDayNote],
  );

  return (
    <div className="flex w-full flex-col pl-10 pr-10 xl:pl-14">
      <TopBar
        year={year}
        month={month}
        onPrev={gotoPrev}
        onNext={gotoNext}
        onToday={gotoToday}
        onOpenDrawer={() => setDrawerOpen(true)}
        layers={layers}
        onLayersChange={setLayers}
      />

      <WeekdayHeader />

      <div className="grid grid-cols-7 gap-1 pb-10">
        {cells.map((cell) => {
          const templateKey =
            pickTemplateForDate(
              {
                templates,
                calendarRules,
                calendarRuleRevisions,
                calendarRuleTombstones,
                userDayNotes,
                userProfile,
              },
              cell.date,
            ) ?? null;
          const overridden = Boolean(
            calendarRules[singleDateRuleId(cell.date)],
          );
          const externalEvents = selectExternalEventsOn(cell.date, {
            enabledHolidayRegions,
            userDayNotes,
          });
          const userNotesOnDate = selectUserDayNotesOn(cell.date, userDayNotes);
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
              agendaItems={agendaByDate.get(cell.date) ?? []}
              externalEvents={externalEvents}
              userNotes={userNotesOnDate}
              onOverride={handleOverride}
              onClearOverride={handleClearOverride}
              onCreateAdhoc={handleCreateAdhoc}
              onDeleteAdhoc={handleDeleteAdhoc}
              onUpsertNote={handleUpsertNote}
              onDeleteNote={handleDeleteNote}
              onOpenAgendaItem={(item) => {
                if (item.kind === 'habit' && item.lineId) {
                  navigate(`/tasks/line/${item.lineId}`);
                  return;
                }
                if (!item.taskId) return;
                setDetailTarget((previous) => ({
                  taskId: item.taskId!,
                  ...(item.occurrenceId && { occurrenceId: item.occurrenceId }),
                  ...(item.adhocId && { adhocId: item.adhocId }),
                  requestId: (previous?.requestId ?? 0) + 1,
                }));
              }}
            />
          );
        })}
      </div>

      <CalendarRulesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      {detailTarget && tasks[detailTarget.taskId] && (
        <TaskDetailDrawer
          task={tasks[detailTarget.taskId]!}
          line={lines[tasks[detailTarget.taskId]!.lineId]}
          highlightOccurrenceId={detailTarget.occurrenceId}
          highlightRequestId={detailTarget.requestId}
          onClose={() => setDetailTarget(null)}
        />
      )}
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
    isTaskBacked: ev.taskId != null,
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
  onOpenDrawer,
  layers,
  onLayersChange,
}: {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpenDrawer: () => void;
  layers: CalendarLayers;
  onLayersChange: (layers: CalendarLayers) => void;
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

      <div className="flex items-center gap-2">
        <CalendarLayerToggle
          checked={layers.tasks}
          label="Tasks"
          onChange={(checked) => onLayersChange({ ...layers, tasks: checked })}
        />
        <CalendarLayerToggle
          checked={layers.habits}
          label="Habits"
          onChange={(checked) => onLayersChange({ ...layers, habits: checked })}
        />
        <button
          type="button"
          onClick={onOpenDrawer}
          className="inline-flex items-center gap-2 rounded-md bg-surface-1 px-3 py-1.5 text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Settings2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          规则
        </button>
      </div>
    </header>
  );
}

function CalendarLayerToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition',
        checked
          ? 'bg-surface-2 text-ink-primary'
          : 'bg-surface-1 text-ink-tertiary hover:text-ink-primary',
      )}
    >
      <span
        className={clsx(
          'inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border',
          checked ? 'border-ink-primary bg-ink-primary' : 'border-hairline',
        )}
      >
        {checked && <Check className="h-2.5 w-2.5 text-surface-0" strokeWidth={2.4} />}
      </span>
      {label}
    </button>
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
