import { clsx } from 'clsx';
import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, NotebookPen } from 'lucide-react';
import * as RadixHoverCard from '@radix-ui/react-hover-card';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { ExternalEvent, TaskPriority } from '@dayrail/core';
import { ExternalEventChip } from './ExternalEventChip';
import {
  type CycleDay,
  type CycleSlot,
  type SlotTaskSummary,
  formatDayLabel,
} from '@/data/sampleCycle';
import {
  fmtHHMM,
  type EditableRail,
  type TemplateKey,
} from '@/data/sampleTemplate';
import type { RailColor } from '@/data/sample';
import { RAIL_COLOR_HEX } from './railColors';
import { CycleCell } from './CycleCell';
import { OFF_RAIL_RAIL_ID } from '@/lib/dndContext';
import { useDragMirror } from '@/lib/dragMirror';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';

// ERD §5.3 D1-1B — per-template stacked section. Cells own their own
// popovers now (per-pill action popover + cell-level add-bar popover);
// this component only handles the table frame, the day headers, and
// drag-drop routing onto (rail, date).

export interface TemplateChoice {
  key: TemplateKey;
  label: string;
  color: RailColor;
}

interface Props {
  templateKey: TemplateKey;
  templateLabel: string;
  templateColor: EditableRail['color'];
  rails: EditableRail[];
  days: CycleDay[];
  slotsByKey: Map<string, CycleSlot>; // key = `${railId}|${date}`
  /** Tasks scheduled to a rail that isn't active on their day (rail
   *  tombstoned / removed from the day's template / template flipped).
   *  Surfaced in a single "Off-rail" row at the bottom of the section
   *  so a scheduled task is never silently invisible. The row only
   *  renders when at least one of `days` has entries; pills inside
   *  remain draggable so the user can drop them back onto any rail. */
  offRailByDate?: Record<string, SlotTaskSummary[]>;
  todayISO: string;
  templateChoices: TemplateChoice[];
  /** Dates in this section's `days` slice that already have a written
   *  Daily Reflection (§4.1). Drives the filled vs outlined chip — a
   *  Set keeps the per-day lookup O(1). */
  reflectedDates: ReadonlySet<string>;
  /** ERD §14 — external events (holidays + user day notes) per date.
   *  CycleView pre-computes this so each cell does an O(1) lookup. */
  externalEventsByDate: Record<string, ExternalEvent[]>;
  /** Open the Daily Reflection editor for a specific date. Cycle View
   *  delegates the deep-link to the parent so we don't import
   *  react-router here. */
  onOpenReflection: (date: string) => void;
  onOverride: (date: string, nextTemplate: TemplateKey) => void;
  onClearOverride: (date: string) => void;
  /** Whether drag-drop is wired (i.e. CycleView is mounted). When
   *  false, cells render without useDroppable so other surfaces using
   *  CycleSection (none currently, but kept as an opt-in for future
   *  read-only views) don't accidentally accept drops. */
  draggable?: boolean;
  onClearSlot?: (taskId: string) => void;
  onMarkTaskDone?: (taskId: string) => void;
  onUndoTaskDone?: (taskId: string) => void;
  onArchiveTask?: (taskId: string) => void;
  onUnarchiveTask?: (taskId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenTaskProject?: (taskId: string) => void;
  onSetTaskPriority?: (taskId: string, priority: TaskPriority | null) => void;
  onToggleSubItem?: (taskId: string, subItemId: string) => void;
  onQuickCreate?: (date: string, railId: string, title: string) => void;
  /** Resolve the Line a task belongs to so the cell can render a small
   *  coloured chip per row without each cell subscribing to the store
   *  directly. */
  lineLookup?: (taskId: string) => { name: string; color?: RailColor } | undefined;
}

export function CycleSection({
  templateLabel,
  templateColor,
  rails,
  days,
  slotsByKey,
  offRailByDate,
  todayISO,
  templateChoices,
  reflectedDates,
  externalEventsByDate,
  onOpenReflection,
  onOverride,
  onClearOverride,
  draggable = true,
  onClearSlot,
  onMarkTaskDone,
  onUndoTaskDone,
  onArchiveTask,
  onUnarchiveTask,
  onOpenTaskDetail,
  onOpenTaskProject,
  onSetTaskPriority,
  onToggleSubItem,
  onQuickCreate,
  lineLookup,
}: Props) {
  const stripColor = RAIL_COLOR_HEX[templateColor];
  // The Off-rail row only renders when at least one day in this
  // section has a scheduled task whose rail isn't active that day.
  // No orphans → no row; the section stays as compact as before.
  const sectionOffRail = useMemo(() => {
    if (!offRailByDate) return null;
    const perDay = new Map<string, SlotTaskSummary[]>();
    let any = false;
    for (const d of days) {
      const arr = offRailByDate[d.date] ?? [];
      if (arr.length > 0) any = true;
      perDay.set(d.date, arr);
    }
    return any ? perDay : null;
  }, [offRailByDate, days]);
  // `hoverRailId` derives from dnd-kit's current `over` element. When
  // the user is dragging a task and `over` points at one of this
  // section's cells (or a sortable pill inside one), highlight the
  // rail across this section's days. The date-belongs-to-this-section
  // check is critical: contiguous-run grouping means the same template
  // can produce multiple sections rendering the same rail.id, and a
  // bare railId match would light up every clone across all A sections.
  const dndCtx = useDndContext();
  // Multi-container drag mirror — overrides per-cell taskId order
  // during an active drag so the source cell shrinks and the target
  // cell expands as the cursor moves. See `apps/web/src/lib/dragMirror.tsx`.
  const { mirror } = useDragMirror();
  const hoverRailId = useMemo(() => {
    const over = dndCtx.over;
    if (!over) return null;
    const data = over.data.current as
      | { railId?: string; date?: string }
      | null
      | undefined;
    if (!data?.railId || !data.date) return null;
    return days.some((d) => d.date === data.date) ? data.railId : null;
  }, [dndCtx.over, days]);

  return (
    <section
      aria-label={`${templateLabel} section`}
      className="relative overflow-hidden rounded-md bg-surface-1"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-2"
        style={{ background: stripColor }}
      />

      <div className="overflow-x-auto pl-5">
        <SectionMiniHeader
          templateLabel={templateLabel}
          days={days}
          stripColor={stripColor}
          todayISO={todayISO}
          templateChoices={templateChoices}
          reflectedDates={reflectedDates}
          externalEventsByDate={externalEventsByDate}
          onOpenReflection={onOpenReflection}
          onOverride={onOverride}
          onClearOverride={onClearOverride}
        />

        <table className="table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-[220px]" />
            {days.map((d) => (
              <col key={d.date} className="w-[180px]" />
            ))}
          </colgroup>

          <tbody>
            {rails.map((rail) => {
              const railIsDropTarget = hoverRailId === rail.id;
              return (
              <tr key={rail.id}>
                <th
                  scope="row"
                  // No CSS transition on the highlight: the bg fades
                  // over ~150ms by default, and 60Hz dragover events
                  // outpace the fade, so a fast drag leaves every
                  // rail it touched mid-fade — visually "all rails
                  // I passed over stay highlighted". State is correct;
                  // we just need it to snap.
                  className={clsx(
                    'pr-3 py-1 text-left align-top',
                    railIsDropTarget && 'bg-cta-soft/25',
                  )}
                >
                  <RailRowLabel rail={rail} isDropTarget={railIsDropTarget} />
                </th>
                {days.map((d) => {
                  const slot = slotsByKey.get(`${rail.id}|${d.date}`);
                  const cellKey = `${rail.id}|${d.date}`;
                  const rawTasks = slot?.tasks ?? [];
                  // CycleSlot doesn't carry a cycleId field; the
                  // store layer uses date-derived synthetic IDs of
                  // the form `cycle-${date}`, matching what CycleView's
                  // legacy handleDropTask used as fallback.
                  const cycleId = `cycle-${d.date}`;
                  // Mirror override: during drag, replace the slot's
                  // store-derived order with the mirror's ordering for
                  // this cell. Foreign tasks (active dragged in from
                  // elsewhere) get their summary from mirror.taskData.
                  const override = mirror?.orders[cellKey];
                  // ERD §7.9 drag UX — track "foreign" rowIds (rows
                  // routed into this cell by dragMirror, native to
                  // some other cell or the backlog). These render as
                  // a thin indicator line during drag instead of a
                  // full pill, so the cell barely grows as the active
                  // crosses cells. Native pills (including the
                  // dimmed source) render normally.
                  const { tasks, foreignRowIds } = override
                    ? (() => {
                        // ERD §10.6 v0.11 — index by `rowId` (occurrence
                        // id when present, else task id) so the dnd
                        // mirror's reorder works for occurrence pills too.
                        const bySlotId = new Map(
                          rawTasks.map((t) => [t.rowId, t] as const),
                        );
                        const foreign = new Set<string>();
                        const list = override
                          .map((id) => {
                            const native = bySlotId.get(id);
                            if (native) return native;
                            const phantom = mirror.taskData[id];
                            if (phantom) foreign.add(id);
                            return phantom;
                          })
                          .filter((t): t is SlotTaskSummary => !!t);
                        return { tasks: list, foreignRowIds: foreign };
                      })()
                    : { tasks: rawTasks, foreignRowIds: undefined };
                  const taskIds = tasks.map((t) => t.rowId);
                  return (
                    <DroppableCellTd
                      key={d.date}
                      enabled={draggable}
                      cellKey={cellKey}
                      cycleId={cycleId}
                      date={d.date}
                      railId={rail.id}
                      slotTaskIds={taskIds}
                      railSoftHover={railIsDropTarget}
                      isToday={d.date === todayISO}
                    >
                      <SortableContext
                        id={cellKey}
                        items={taskIds}
                        strategy={verticalListSortingStrategy}
                      >
                        <CycleCell
                          tasks={tasks}
                          {...(foreignRowIds && { foreignRowIds })}
                          color={rail.color}
                          date={d.date}
                          cellKey={cellKey}
                          cycleId={cycleId}
                          railId={rail.id}
                          railName={rail.name}
                          slotTaskIds={taskIds}
                          {...(onClearSlot && { onClearTask: onClearSlot })}
                          {...(onMarkTaskDone && { onMarkTaskDone })}
                          {...(onUndoTaskDone && { onUndoTaskDone })}
                          {...(onArchiveTask && { onArchiveTask })}
                          {...(onUnarchiveTask && { onUnarchiveTask })}
                          {...(onOpenTaskDetail && { onOpenTaskDetail })}
                          {...(onOpenTaskProject && { onOpenTaskProject })}
                          {...(onSetTaskPriority && { onSetTaskPriority })}
                          {...(onToggleSubItem && { onToggleSubItem })}
                          {...(onQuickCreate && { onQuickCreate })}
                          {...(lineLookup && { lineLookup })}
                        />
                      </SortableContext>
                    </DroppableCellTd>
                  );
                })}
              </tr>
              );
            })}
            {sectionOffRail && (
              <tr>
                <th
                  scope="row"
                  className="pr-3 py-1 text-left align-top"
                >
                  <OffRailRowLabel />
                </th>
                {days.map((d) => {
                  const offRailCellKey = `${OFF_RAIL_RAIL_ID}|${d.date}`;
                  const rawOffRailTasks = sectionOffRail.get(d.date) ?? [];
                  // Off-rail rows participate in the same mirror so
                  // pills dragged out of an off-rail cell visually
                  // leave it just like real rails do.
                  const override = mirror?.orders[offRailCellKey];
                  const offRailTasks = override
                    ? (() => {
                        const bySlotId = new Map(
                          rawOffRailTasks.map(
                            (t) => [t.rowId, t] as const,
                          ),
                        );
                        return override
                          .map(
                            (id) =>
                              bySlotId.get(id) ?? mirror.taskData[id],
                          )
                          .filter((t): t is SlotTaskSummary => !!t);
                      })()
                    : rawOffRailTasks;
                  const offRailTaskIds = offRailTasks.map((t) => t.rowId);
                  return (
                    <td
                      key={d.date}
                      className={clsx(
                        'p-1 align-top',
                        d.date === todayISO && 'bg-surface-2/40',
                      )}
                    >
                      {/* Off-rail pills are draggable BACK onto real
                          rails (the source-side data is bogus, but
                          handleDragEnd only reads the *over* data for
                          destination — source railId can be __offrail__
                          freely). No useDroppable on the td: off-rail
                          isn't a drop target, only a source surface. */}
                      <SortableContext
                        id={offRailCellKey}
                        items={offRailTaskIds}
                        strategy={verticalListSortingStrategy}
                      >
                        <CycleCell
                          tasks={offRailTasks}
                          color="slate"
                          date={d.date}
                          cellKey={offRailCellKey}
                          cycleId={`cycle-${d.date}`}
                          railId={OFF_RAIL_RAIL_ID}
                          railName="未归属"
                          slotTaskIds={offRailTaskIds}
                          {...(onClearSlot && { onClearTask: onClearSlot })}
                          {...(onMarkTaskDone && { onMarkTaskDone })}
                          {...(onUndoTaskDone && { onUndoTaskDone })}
                          {...(onArchiveTask && { onArchiveTask })}
                          {...(onUnarchiveTask && { onUnarchiveTask })}
                          {...(onOpenTaskDetail && { onOpenTaskDetail })}
                          {...(onOpenTaskProject && { onOpenTaskProject })}
                          {...(onSetTaskPriority && { onSetTaskPriority })}
                          {...(onToggleSubItem && { onToggleSubItem })}
                          {...(lineLookup && { lineLookup })}
                        />
                      </SortableContext>
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// DroppableCellTd · `useDroppable` wrapper for a single (rail × date)
// cell. When a task is being dragged and dnd-kit's collision detection
// picks this cell as the `over`, isOver lights up the ring + tint.
// railSoftHover is the section-derived "any cell of this rail is over"
// state, used for the lower-saturation rail-row tint.
function DroppableCellTd({
  enabled,
  cellKey,
  cycleId,
  date,
  railId,
  slotTaskIds,
  railSoftHover,
  isToday,
  children,
}: {
  enabled: boolean;
  cellKey: string;
  cycleId: string;
  date: string;
  railId: string;
  slotTaskIds: string[];
  railSoftHover: boolean;
  isToday: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: cellKey,
    disabled: !enabled,
    data: { type: 'cell', cellKey, cycleId, date, railId, slotTaskIds },
  });
  const showOver = enabled && isOver;
  const showSoftRail = enabled && railSoftHover && !showOver;
  return (
    <td
      ref={setNodeRef}
      className={clsx(
        // Snap, don't fade — 60Hz pointer events outpace any CSS
        // transition; mid-fade trails look like stale highlights.
        'p-1 align-top',
        isToday && 'bg-surface-2/40',
        showSoftRail && 'bg-cta-soft/15',
        showOver && 'bg-cta-soft/30 ring-1 ring-inset ring-cta/60',
      )}
    >
      {children}
    </td>
  );
}

function SectionMiniHeader({
  templateLabel,
  days,
  stripColor,
  todayISO,
  templateChoices,
  reflectedDates,
  externalEventsByDate,
  onOpenReflection,
  onOverride,
  onClearOverride,
}: {
  templateLabel: string;
  days: CycleDay[];
  stripColor: string;
  todayISO: string;
  templateChoices: TemplateChoice[];
  reflectedDates: ReadonlySet<string>;
  externalEventsByDate: Record<string, ExternalEvent[]>;
  onOpenReflection: (date: string) => void;
  onOverride: (date: string, nextTemplate: TemplateKey) => void;
  onClearOverride: (date: string) => void;
}) {
  return (
    <div className="flex min-h-[48px] items-center gap-0 border-b border-transparent py-2">
      <table className="table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[220px]" />
          {days.map((d) => (
            <col key={d.date} className="w-[180px]" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="pr-3 text-left align-middle">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-[3px] shrink-0 rounded-sm"
                  style={{ background: stripColor }}
                />
                <span className="min-w-0 truncate font-mono text-2xs uppercase tracking-widest text-ink-primary">
                  {templateLabel}
                </span>
                <span className="shrink-0 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  · {days.length} days
                </span>
              </div>
            </th>
            {days.map((d) => (
              <th key={d.date} className="px-1 text-left align-middle">
                <DayCellButton
                  day={d}
                  isToday={d.date === todayISO}
                  hasReflection={reflectedDates.has(d.date)}
                  externalEvents={externalEventsByDate[d.date] ?? []}
                  templateChoices={templateChoices}
                  onOverride={(tpl) => onOverride(d.date, tpl)}
                  onClearOverride={() => onClearOverride(d.date)}
                  onOpenReflection={() => onOpenReflection(d.date)}
                />
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </div>
  );
}

/** Inline external-event chips for a Cycle View date cell. Earlier
 *  iterations used 6-8px dots to keep the day-header tight, but they
 *  read as decorative noise on tinted cells. Badge chips (mirroring
 *  Calendar's footer) give the events a real label, and capping at
 *  1 chip + `+N` keeps the day column from stretching. The wrapper's
 *  `title` carries the full list as a native tooltip; clicking the
 *  date opens the day popover whose NonEditableContextRow lists
 *  everything in full. */
function ExternalEventsInline({ events }: { events: ExternalEvent[] }) {
  if (events.length === 0 || !events[0]) return null;
  const overflow = events.length - 1;
  // No `title=` on the wrapper either — the parent DayCellButton wraps
  // the entire row in a RadixHoverCard that surfaces the full event
  // list with our custom styling. A native title here would stack a
  // grey browser tooltip under the custom popover.
  return (
    <span className="ml-1 inline-flex min-w-0 max-w-[110px] items-center gap-1">
      <ExternalEventChip
        event={events[0]}
        shape="badge"
        className="min-w-0 max-w-full truncate"
      />
      {overflow > 0 && (
        <span className="shrink-0 font-mono text-2xs text-ink-tertiary">
          +{overflow}
        </span>
      )}
    </span>
  );
}

function DayCellButton({
  day,
  isToday,
  hasReflection,
  externalEvents,
  templateChoices,
  onOverride,
  onClearOverride,
  onOpenReflection,
}: {
  day: CycleDay;
  isToday: boolean;
  hasReflection: boolean;
  externalEvents: ExternalEvent[];
  templateChoices: TemplateChoice[];
  onOverride: (tpl: TemplateKey) => void;
  onClearOverride: () => void;
  onOpenReflection: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { weekday, dayNum } = formatDayLabel(day);
  // ERD §14 — hover preview when the day carries external events.
  // Mirrors Calendar's HoverCard treatment so users get a quick
  // glance at the full list (chip is truncated to ~110px in-cell).
  // Cycle View shows the hover even with a single event — the cell's
  // chip is so width-constrained that long labels (`调休·春节`) get
  // ellipsized; hover restores the full label. Calendar caps it
  // differently (only when overflow > 0) since its inline chips have
  // more horizontal room.
  const hasEvents = externalEvents.length > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <RadixHoverCard.Root
        openDelay={300}
        closeDelay={120}
        open={!hasEvents || open ? false : undefined}
      >
      <RadixHoverCard.Trigger asChild>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'group flex w-full items-baseline gap-1 rounded-sm px-1 py-0.5 text-left transition',
            isToday ? 'bg-surface-2/60' : 'hover:bg-surface-2/50',
          )}
        >
          <span
            className={clsx(
              'font-mono text-2xs uppercase tracking-widest',
              isToday ? 'text-ink-primary' : 'text-ink-tertiary',
            )}
          >
            {weekday}
          </span>
          <span
            className={clsx(
              'font-mono text-sm tabular-nums',
              isToday
                ? 'text-ink-primary font-medium'
                : 'text-ink-secondary',
            )}
          >
            {dayNum}
          </span>
          {day.overridden && (
            <span
              aria-hidden
              title="overridden from the weekday default"
              className="h-1 w-1 rounded-full bg-cta"
            />
          )}
          {/* Reflection-state indicator — purely visual; opening the
              editor goes through the popover entry below so this stays
              part of the day-cell's natural left-aligned content and
              doesn't shift column geometry. */}
          {hasReflection && (
            <NotebookPen
              aria-label="今日复盘 · 已写"
              className="ml-1 h-3 w-3 text-ink-secondary"
              strokeWidth={2}
            />
          )}
          {/* ERD §14 — external events (holidays + user notes) as
              compact dots inline with the day label. Up to 3 visible
              + `+N` overflow; hover shows the full list. */}
          {externalEvents.length > 0 && (
            <ExternalEventsInline events={externalEvents} />
          )}
          <ChevronDown
            aria-hidden
            className="ml-auto h-3 w-3 text-ink-tertiary opacity-0 transition group-hover:opacity-100"
            strokeWidth={1.8}
          />
        </button>
      </PopoverTrigger>
      </RadixHoverCard.Trigger>

      {/* Hover preview — full event list (no truncation), mirrors
          Calendar's HoverCard. Click still opens the editor popover. */}
      <RadixHoverCard.Portal>
        <RadixHoverCard.Content
          side="top"
          align="start"
          sideOffset={6}
          className={clsx(
            'z-50 flex flex-col gap-2 rounded-md bg-surface-1 p-3 text-ink-primary',
            'shadow-[0_0_0_0.5px_theme(colors.hairline),0_8px_24px_-12px_rgba(0,0,0,0.18)]',
            'outline-none',
            'data-[state=open]:animate-[popoverIn_160ms_cubic-bezier(0.22,0.61,0.36,1)]',
          )}
          style={{ maxWidth: 280 }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {day.date}
            </span>
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {weekday}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {externalEvents.map((ev, i) => (
              <ExternalEventChip
                key={`hover-${ev.sourceId}-${i}`}
                event={ev}
                shape="badge"
              />
            ))}
          </div>
        </RadixHoverCard.Content>
      </RadixHoverCard.Portal>
      </RadixHoverCard.Root>

      <PopoverContent align="start" sideOffset={6} className="w-[220px] p-1">
        {/* ERD §14 — read-only context row. Mirrors Calendar's day
            popover so users see holidays / observances / makeup
            workdays without leaving Cycle View for the Calendar tab. */}
        {externalEvents.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1 px-3 pb-1 pt-1.5">
              {externalEvents.map((ev, i) => (
                <ExternalEventChip
                  key={`ctx-${ev.sourceId}-${i}`}
                  event={ev}
                  shape="badge"
                  className="max-w-full truncate"
                />
              ))}
            </div>
            <div className="mx-3 my-1 h-px bg-surface-3" />
          </>
        )}
        <div className="px-3 pb-1 pt-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Day template
          </span>
        </div>
        <ul className="flex flex-col">
          {templateChoices.map((t) => {
            const active = t.key === day.templateKey;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => {
                    onOverride(t.key);
                    setOpen(false);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition',
                    active ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-3 w-[3px] rounded-sm"
                    style={{ background: RAIL_COLOR_HEX[t.color] }}
                  />
                  <span className="flex-1">{t.label}</span>
                  {active && (
                    <Check
                      className="h-3.5 w-3.5 text-ink-tertiary"
                      strokeWidth={2}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {day.overridden && (
          <>
            <div className="mx-3 my-1 h-px bg-surface-3" />
            <button
              type="button"
              onClick={() => {
                onClearOverride();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              恢复默认
            </button>
          </>
        )}
        <div className="mx-3 my-1 h-px bg-surface-3" />
        <button
          type="button"
          onClick={() => {
            onOpenReflection();
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <NotebookPen className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span className="flex-1">{hasReflection ? '查看复盘' : '写复盘'}</span>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            ↗
          </span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

function RailRowLabel({
  rail,
  isDropTarget,
}: {
  rail: EditableRail;
  isDropTarget: boolean;
}) {
  // All drop-target affordances here must be layout-neutral: earlier
  // versions bumped the color-bar size and conditionally rendered an
  // arrow glyph, both of which shifted the row height or width. That
  // nudged the cursor onto a different `<td>`, which re-fired
  // `dragover` on a new cell, which flipped the state back → the
  // "frantic shaking" bug. So: fixed bar dimensions, arrow always
  // rendered but opacity-animated. All indication comes from
  // box-shadow / color, never layout.
  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-sm pl-0.5 pr-1.5 transition-colors',
        isDropTarget && 'ring-1 ring-inset ring-cta/60',
      )}
    >
      <span
        aria-hidden
        className="h-6 w-1 shrink-0 rounded-sm"
        style={{ background: RAIL_COLOR_HEX[rail.color] }}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-ink-primary">
          {rail.name}
        </span>
        <span className="truncate font-mono text-2xs tabular-nums text-ink-tertiary">
          {fmtHHMM(rail.startMin)} → {fmtHHMM(rail.endMin)}
        </span>
      </span>
      <span
        aria-hidden
        className={clsx(
          // No transition: opacity used to fade in/out over ~150ms,
          // and 60Hz dragover races the fade — every rail the cursor
          // touched stayed mid-fade-out, painting a `→` trail. The
          // arrow is opacity-animated for layout neutrality (always
          // rendered so its presence doesn't shift cell width); just
          // snap the opacity instead of animating it.
          'font-mono text-[9px] uppercase tracking-widest text-cta',
          isDropTarget ? 'opacity-100' : 'opacity-0',
        )}
      >
        →
      </span>
    </div>
  );
}

function OffRailRowLabel() {
  // Visually distinct from a real rail row: no color bar, dashed
  // outline, italic copy. Communicates "these tasks lost their rail"
  // without pretending to be a peer of the user's own rails.
  //
  // The "off-rail · 拖回任意 rail 即可恢复" subtitle used to render
  // here as a second line, but at font-mono size + the dashed border
  // padding it overflowed the table's 220px label column under
  // `table-fixed`, pushing every day cell in the off-rail row out of
  // alignment with the rail rows above. Demoted to a `title=`
  // tooltip — the main label alone reads cleanly enough, and the
  // recovery hint is a one-time learning moment.
  return (
    <div
      title="未归属 · 拖回任意 rail 即可恢复"
      className="flex max-w-full items-center gap-2 overflow-hidden rounded-sm border border-dashed border-hairline/60 bg-surface-0/40 px-1.5 py-1"
    >
      <span className="truncate text-sm italic text-ink-secondary">
        未归属
      </span>
    </div>
  );
}
