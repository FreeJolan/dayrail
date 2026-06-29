import { clsx } from 'clsx';
import { forwardRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowUpRight,
  Check,
  Circle,
  ExternalLink,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskPriority } from '@dayrail/core';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from './primitives/Tooltip';
import { NoteHoverPopover } from './NoteHoverPopover';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_3,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
  RAIL_COLOR_STEP_7,
} from './railColors';
import type { RailColor } from '@/data/sample';
import type { SlotTaskState, SlotTaskSummary } from '@/data/sampleCycle';
import { useIme } from '@/lib/ime';

// ERD §5.3 — cell = stack of per-task pills. Each pill owns its own
// Radix popover (actions) and Radix tooltip (details on hover). The
// cell also exposes a hover-reveal "+ add" bar at the bottom that
// spawns an inline QuickCreate input — the sole same-spot entry for
// "add one more task to this (date, rail)" now that the old cell-
// level popover was retired.

interface Props {
  tasks: SlotTaskSummary[];
  /** Set of rowIds that are "foreign" to this cell — pills the
   *  dragMirror routed in from another cell or the backlog. These
   *  render as a thin indicator line during drag instead of a full
   *  pill, so the cell's height doesn't jump as the active moves
   *  between cells (Notion-style insertion-line UX). Native tasks
   *  that originated in this cell render as the normal dimmed pill
   *  during drag so the user can see the original position. */
  foreignRowIds?: ReadonlySet<string>;
  color: RailColor;
  date: string;
  /** Cell identity for dnd-kit. Pills inside use these to populate
   *  their useSortable data — the App-level drag-end handler reads
   *  those to compute the destination cell + position. Off-rail cells
   *  pass synthetic values (railId='__offrail__'); they're never the
   *  destination of a drop, only sources. */
  cellKey: string;
  cycleId: string;
  railId: string;
  railName: string;
  /** Snapshot of task IDs in the slot, in current visual order.
   *  Passed to each pill's useSortable so the drag-end handler has
   *  the slot's order without re-deriving from store state. */
  slotTaskIds: string[];
  onClearTask?: (taskId: string) => void;
  onMarkTaskDone?: (taskId: string) => void;
  onUndoTaskDone?: (taskId: string) => void;
  onArchiveTask?: (taskId: string) => void;
  onUnarchiveTask?: (taskId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenTaskProject?: (taskId: string) => void;
  /** Priority is intentionally NOT editable from the cell popover —
   *  it's a task-config operation and belongs to the detail drawer.
   *  Kept on `Props` only so the caller could still pass it if a
   *  future surface wants it inline; the popover itself ignores it. */
  onSetTaskPriority?: (taskId: string, priority: TaskPriority | null) => void;
  onToggleSubItem?: (taskId: string, subItemId: string) => void;
  onQuickCreate?: (date: string, railId: string, title: string) => void;
  lineLookup?: (taskId: string) => { name: string; color?: RailColor } | undefined;
  /** §4.1 v0.4.4 · per-slot reorder. Fires when a task pill is dropped
   *  on a between-pill insertion line. The callback receives the
   *  **final desired visual order** for the destination slot — the UI
   *  is the only layer that knows the slot's current visual order,
   *  so we resolve the drop position into a concrete ordered list
   *  here rather than asking the store to guess. The td-level drop
   *  (`CycleSection`'s onDropTask) handles end-of-slot drops without
   *  a position (legacy append behavior). */
}

export function CycleCell({
  tasks,
  foreignRowIds,
  color,
  date,
  cellKey,
  cycleId,
  railId,
  railName,
  slotTaskIds,
  onClearTask,
  onMarkTaskDone,
  onUndoTaskDone,
  onArchiveTask,
  onUnarchiveTask,
  onOpenTaskDetail,
  onOpenTaskProject,
  onToggleSubItem,
  onQuickCreate,
  lineLookup,
}: Props) {
  if (tasks.length === 0) {
    return (
      <EmptyCell
        date={date}
        railId={railId}
        railName={railName}
        {...(onQuickCreate && { onQuickCreate })}
      />
    );
  }
  return (
    <div className="group/cell relative flex h-full min-h-[44px] w-full max-w-full min-w-0 flex-col gap-1 overflow-hidden rounded-sm bg-surface-1 px-1 py-1 transition hover:bg-surface-2">
      {tasks.map((t, i) => (
        // ERD §10.6 v0.11 — pill identity is `rowId` (occurrence id when
        // present, else task id). All handler dispatches send `rowId`
        // upstream so the consumer can route via `taskOccurrences` lookup.
        <SortableTaskPillRow
          key={t.rowId}
          task={t}
          color={color}
          cellKey={cellKey}
          cycleId={cycleId}
          date={date}
          railId={railId}
          index={i}
          slotTaskIds={slotTaskIds}
          isPhantom={foreignRowIds?.has(t.rowId) ?? false}
          line={lineLookup?.(t.rowId)}
          {...(onClearTask && { onClear: () => onClearTask(t.rowId) })}
          {...(onMarkTaskDone && {
            onMarkDone: () => onMarkTaskDone(t.rowId),
          })}
          {...(onUndoTaskDone && {
            onUndoDone: () => onUndoTaskDone(t.rowId),
          })}
          {...(onArchiveTask && {
            onArchive: () => onArchiveTask(t.rowId),
          })}
          {...(onUnarchiveTask && {
            onUnarchive: () => onUnarchiveTask(t.rowId),
          })}
          {...(onOpenTaskDetail && {
            onOpenDetail: () => onOpenTaskDetail(t.rowId),
          })}
          {...(onOpenTaskProject && {
            onOpenProject: () => onOpenTaskProject(t.rowId),
          })}
          {...(onToggleSubItem && {
            onToggleSubItem: (subItemId: string) =>
              onToggleSubItem(t.rowId, subItemId),
          })}
        />
      ))}
      {onQuickCreate && (
        <CellAddBar
          date={date}
          railId={railId}
          railName={railName}
          onQuickCreate={onQuickCreate}
        />
      )}
    </div>
  );
}

// Each task pill in a slot is a dnd-kit useSortable item. The
// wrapper handles the drag handle (whole pill row is draggable),
// applies the in-flight transform/transition animation, and dims
// the source while it's lifted. The actual pill visuals + popover
// + tooltip logic stay in TaskPill — this wrapper is just the dnd
// gesture surface.
//
// The `data` payload carries the destination cell context so the
// App-level handleDragEnd can compute the drop's (cycleId, date,
// railId) and the slot's task order without re-deriving from store
// state.
function SortableTaskPillRow({
  task,
  color,
  cellKey,
  cycleId,
  date,
  railId,
  index,
  slotTaskIds,
  isPhantom,
  line,
  onClear,
  onMarkDone,
  onUndoDone,
  onArchive,
  onUnarchive,
  onOpenDetail,
  onOpenProject,
  onToggleSubItem,
}: PillProps & {
  cellKey: string;
  cycleId: string;
  date: string;
  railId: string;
  index: number;
  slotTaskIds: string[];
  /** True when this pill is the dragMirror's projection of a task
   *  routed into this cell from another cell or the backlog. In that
   *  case the row renders as a 2px indicator line so the cell barely
   *  grows — preventing the height-jump that made the target position
   *  "run away" as the cursor crossed cells. */
  isPhantom: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    // ERD §10.6 v0.11 — pill identity is `rowId`, which equals the
    // occurrence id when this pill represents a TaskOccurrence and
    // the Task id otherwise. The App-level drag-end handler resolves
    // it via taskOccurrences lookup (App.tsx).
    id: task.rowId,
    data: {
      type: 'task',
      source: 'cell',
      cellKey,
      cycleId,
      date,
      railId,
      index,
      slotTaskIds,
      // SlotTaskSummary carried in drag data so the multi-container
      // mirror can render this pill inside whichever cell the active
      // currently belongs to during drag (dragMirror.tsx). Without it
      // a destination cell has no way to look up the dragged task's
      // title/state/badges.
      summary: task,
    },
  });
  // Foreign-phantom rendering takes precedence over the regular
  // dimmed-pill drag state: we don't want a full-height ghost in the
  // destination cell at all. dnd-kit still tracks this row as a
  // sortable item, but at ~2px tall — neighbors' transforms shrink to
  // match, so the cell's height barely changes.
  //
  // Transform STAYS APPLIED even for the phantom line. dnd-kit's
  // SortableContext strategy uses transform to translate the active
  // (the line) to the cursor's `over` index, and to shift siblings
  // out of the way. Without it the line would freeze at the first
  // insertion index `handleDragOver` picked when active entered the
  // cell (typically the end, since cell padding gives index=null) —
  // intentionally suppressed earlier and that froze the indicator,
  // which is the bug this comment exists to prevent regressing.
  const renderAsIndicator = isDragging && isPhantom;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={clsx(
        'w-full max-w-full min-w-0',
        !renderAsIndicator && 'cursor-grab active:cursor-grabbing',
        isDragging && !renderAsIndicator && 'opacity-50',
      )}
    >
      {renderAsIndicator ? (
        <DropIndicatorLine color={color} />
      ) : (
        <TaskPill
          task={task}
          color={color}
          {...(line && { line })}
          {...(onClear && { onClear })}
          {...(onMarkDone && { onMarkDone })}
          {...(onUndoDone && { onUndoDone })}
          {...(onArchive && { onArchive })}
          {...(onUnarchive && { onUnarchive })}
          {...(onOpenDetail && { onOpenDetail })}
          {...(onOpenProject && { onOpenProject })}
          {...(onToggleSubItem && { onToggleSubItem })}
        />
      )}
    </div>
  );
}

/** Thin colored bar that replaces a phantom pill during cross-cell
 *  drag. Total height ~6px including margins keeps the destination
 *  cell stable — siblings only move enough to make a narrow gap, not
 *  a full pill's worth, so the user's target position doesn't run
 *  away as the cursor crosses cells. */
function DropIndicatorLine({ color }: { color: RailColor }) {
  return (
    <div
      className="my-0.5 h-0.5 w-full rounded-full"
      style={{ backgroundColor: RAIL_COLOR_HEX[color] }}
      aria-hidden="true"
    />
  );
}

// -- Pill -------------------------------------------------------------

interface PillProps {
  task: SlotTaskSummary;
  color: RailColor;
  line?: { name: string; color?: RailColor };
  onClear?: () => void;
  onMarkDone?: () => void;
  onUndoDone?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onOpenDetail?: () => void;
  onOpenProject?: () => void;
  onToggleSubItem?: (subItemId: string) => void;
}

function TaskPill(props: PillProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const {
    task,
    color,
    line,
    onClear,
    onMarkDone,
    onUndoDone,
    onArchive,
    onUnarchive,
    onOpenDetail,
    onOpenProject,
    onToggleSubItem,
  } = props;
  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      {task.hasNote && task.note ? (
        <NoteHoverPopover
          note={task.note}
          side="right"
          align="start"
          header={<PillMetaChips task={task} line={line} invert={false} />}
          footer={
            (task.subItems?.length ?? 0) > 0 ? (
              <PillSubItemsList task={task} invert={false} />
            ) : undefined
          }
        >
          <PopoverTrigger asChild>
            <PillBody
              task={task}
              color={color}
              {...(line && { line })}
              {...(onClear && { onClear })}
            />
          </PopoverTrigger>
        </NoteHoverPopover>
      ) : (
        <TooltipRoot>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <PillBody
                task={task}
                color={color}
                {...(line && { line })}
                {...(onClear && { onClear })}
              />
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent side="right" className="max-w-none p-2">
            <PillTooltipBody task={task} line={line} />
          </TooltipContent>
        </TooltipRoot>
      )}
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-[260px]"
      >
        <PillPopoverBody
            task={task}
            line={line}
            {...(onMarkDone && {
              onMarkDone: () => {
                onMarkDone();
                setPopoverOpen(false);
              },
            })}
            {...(onUndoDone && {
              onUndoDone: () => {
                onUndoDone();
                setPopoverOpen(false);
              },
            })}
            {...(onArchive && {
              onArchive: () => {
                onArchive();
                setPopoverOpen(false);
              },
            })}
            {...(onUnarchive && {
              onUnarchive: () => {
                onUnarchive();
                setPopoverOpen(false);
              },
            })}
            {...(onClear && {
              onClear: () => {
                onClear();
                setPopoverOpen(false);
              },
            })}
            {...(onOpenDetail && {
              onOpenDetail: () => {
                onOpenDetail();
                setPopoverOpen(false);
              },
            })}
            {...(onOpenProject && {
              onOpenProject: () => {
                onOpenProject();
                setPopoverOpen(false);
              },
            })}
            {...(onToggleSubItem && { onToggleSubItem })}
          />
        </PopoverContent>
      </Popover>
  );
}

interface PillBodyProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color'> {
  task: SlotTaskSummary;
  color: RailColor;
  line?: { name: string; color?: RailColor };
  onClear?: () => void;
}

const PillBody = forwardRef<HTMLDivElement, PillBodyProps>(function PillBody(
  props,
  ref,
) {
  const {
    task,
    color,
    line,
    onClear,
    className,
    style: passedStyle,
    ...rest
  } = props;
  const style = pillStyle(task.state, color);
  return (
    <div
      ref={ref}
      {...rest}
      className={clsx(
        // Drag activation moved to the outer SortableTaskPillRow
        // wrapper (dnd-kit). PillBody now just owns presentation;
        // the wrapper handles the grab + drop gesture via useSortable.
        'group/pill relative flex w-full max-w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-sm px-1.5 py-1 pr-5',
        className,
      )}
      style={{ ...style.container, ...passedStyle }}
    >
      {task.state === 'pending' && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 w-px rounded-full"
          style={{ background: RAIL_COLOR_HEX[color] }}
        />
      )}
      {task.state === 'done' && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 w-px rounded-full"
          style={{ background: RAIL_COLOR_STEP_6[color] }}
        />
      )}
      {task.state === 'archived' && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 w-px rounded-full"
          style={{ background: RAIL_COLOR_STEP_6[color] }}
        />
      )}
      <div className="flex items-start gap-1.5">
        <StateIcon state={task.state} />
        <div className="min-w-0 flex-1">
          {task.parentTitle && (
            // Occurrence pill: parent task title on top, progress
            // indicators (sub-items / milestone %) right-aligned on
            // the same row. These metrics live on the Task, not the
            // Occurrence, so visually grouping them with the parent
            // title keeps "this number belongs to that task" obvious
            // — placing them below the occurrence subject (where
            // PillBadges used to render them) made it look like the
            // % was the occurrence's own progress.
            <div className="flex items-baseline justify-between gap-1.5">
              <span
                className={clsx(
                  'block truncate text-[10px] leading-tight',
                  style.parentTone,
                )}
              >
                {task.parentTitle}
              </span>
              <ParentRowProgress task={task} tone={style.badgeTone} />
            </div>
          )}
          <span
            className={clsx('line-clamp-2 text-xs', style.titleClass)}
            style={style.titleStyle}
          >
            {task.title || '未命名任务'}
          </span>
        </div>
      </div>
      <PillBadges
        task={task}
        {...(line && { line })}
        tone={style.badgeTone}
        hideProgress={task.parentTitle != null}
      />
      {onClear && <ClearButton onClear={onClear} tone={style.clearTone} />}
    </div>
  );
});

function StateIcon({ state }: { state: SlotTaskState }) {
  if (state === 'done')
    return (
      <Check
        aria-hidden
        className="mt-0.5 h-3 w-3 shrink-0 text-ink-tertiary"
        strokeWidth={2.4}
      />
    );
  if (state === 'deferred')
    return (
      <ArrowUpRight
        aria-hidden
        className="mt-0.5 h-3 w-3 shrink-0 text-ink-secondary"
        strokeWidth={1.8}
      />
    );
  if (state === 'archived')
    return (
      <Archive
        aria-hidden
        className="mt-0.5 h-3 w-3 shrink-0 text-ink-tertiary"
        strokeWidth={1.8}
      />
    );
  return null;
}

interface PillStyle {
  container: React.CSSProperties;
  titleClass: string;
  titleStyle?: React.CSSProperties;
  /** ERD §10.6 v0.11 — class for the small parent-task subtitle on
   *  occurrence pills. Mutes the parent line so the occurrence label
   *  remains the primary read. */
  parentTone: string;
  badgeTone: 'default' | 'on-solid';
  clearTone: 'default' | 'on-solid';
}

function pillStyle(state: SlotTaskState, color: RailColor): PillStyle {
  if (state === 'done') {
    // Done = "crossed off the list, ignore it". Uses the neutral
    // surface-2 background (not rail-color-solid) plus strong text
    // desaturation + strikethrough so it reads as inert at a glance.
    // A thin rail-tinted left bar (step 6) keeps enough color memory
    // that scanning by rail still works.
    return {
      container: {
        background: 'rgb(var(--surface-2))',
        opacity: 0.7,
      },
      titleClass: 'text-ink-tertiary line-through decoration-ink-tertiary/50',
      parentTone: 'text-ink-tertiary',
      badgeTone: 'default',
      clearTone: 'default',
    };
  }
  if (state === 'deferred') {
    return {
      container: { background: RAIL_COLOR_STEP_7[color] },
      titleClass: 'text-ink-primary',
      parentTone: 'text-ink-tertiary',
      badgeTone: 'default',
      clearTone: 'default',
    };
  }
  if (state === 'archived') {
    // Archived = user parked this on purpose. Reads as "gone further
    // than done" — same neutral bg as done, stronger fade, Archive
    // icon, no hatched pattern (the hatch made the pill look like a
    // placeholder / unavailable slot rather than an actual task).
    return {
      container: {
        background: 'rgb(var(--surface-2))',
        opacity: 0.55,
      },
      titleClass: 'text-ink-tertiary line-through decoration-ink-tertiary/50',
      parentTone: 'text-ink-tertiary',
      badgeTone: 'default',
      clearTone: 'default',
    };
  }
  // pending
  return {
    container: { background: RAIL_COLOR_STEP_3[color] },
    titleClass: 'text-ink-primary',
    parentTone: 'text-ink-tertiary',
    badgeTone: 'default',
    clearTone: 'default',
  };
}

function PillBadges({
  task,
  line,
  tone,
  hideProgress,
}: {
  task: SlotTaskSummary;
  line?: { name: string; color?: RailColor };
  tone: 'default' | 'on-solid';
  /** Occurrence pills render sub-items / milestone-% on the parent
   *  title row via ParentRowProgress (so the metric visually belongs
   *  to the task, not the occurrence). When true, this row drops
   *  those two and only carries priority + habit chips. */
  hideProgress?: boolean;
}) {
  const showProgress = !hideProgress;
  const anything =
    line != null ||
    task.priority != null ||
    task.isAutoTask ||
    (showProgress && task.subItemsTotal > 0) ||
    (showProgress && task.milestonePercent != null);
  if (!anything) return null;
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-1 font-mono text-2xs tabular-nums',
        tone === 'on-solid' ? '' : 'text-ink-tertiary',
      )}
      style={tone === 'on-solid' ? { opacity: 0.75 } : undefined}
    >
      {line && <ProjectChip line={line} tone={tone} />}
      {task.priority && <PriorityChip priority={task.priority} />}
      {task.isAutoTask && <span>habit</span>}
      {showProgress && task.subItemsTotal > 0 && (
        <span>
          {task.subItemsDone}/{task.subItemsTotal}
        </span>
      )}
      {showProgress && task.milestonePercent != null && (
        <span>{task.milestonePercent}%</span>
      )}
    </div>
  );
}

function ProjectChip({
  line,
  tone,
}: {
  line: { name: string; color?: RailColor };
  tone: 'default' | 'on-solid';
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      {line.color && (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: RAIL_COLOR_HEX[line.color] }}
        />
      )}
      <span
        className={clsx(
          'min-w-0 max-w-[8rem] truncate',
          tone === 'on-solid' ? '' : 'text-ink-secondary',
        )}
      >
        {line.name}
      </span>
    </span>
  );
}

/** Right-aligned progress chip rendered on the same row as the parent
 *  task title in occurrence pills. Mirrors PillBadges' typography (mono,
 *  text-2xs, tabular-nums) but only carries the two task-level progress
 *  signals: sub-items completion and milestone %. */
function ParentRowProgress({
  task,
  tone,
}: {
  task: SlotTaskSummary;
  tone: 'default' | 'on-solid';
}) {
  const hasSub = task.subItemsTotal > 0;
  const hasPct = task.milestonePercent != null;
  if (!hasSub && !hasPct) return null;
  return (
    <span
      className={clsx(
        'shrink-0 font-mono text-2xs tabular-nums leading-tight',
        tone === 'on-solid' ? '' : 'text-ink-tertiary',
      )}
      style={tone === 'on-solid' ? { opacity: 0.75 } : undefined}
    >
      {hasSub && (
        <>
          {task.subItemsDone}/{task.subItemsTotal}
        </>
      )}
      {hasSub && hasPct && ' · '}
      {hasPct && <>{task.milestonePercent}%</>}
    </span>
  );
}

function PriorityChip({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={clsx(
        'inline-flex h-3.5 min-w-[1.25rem] items-center justify-center rounded-sm px-1 font-mono text-[9px] font-medium uppercase tracking-wider text-white',
        priority === 'P0' && 'bg-red-500/90',
        priority === 'P1' && 'bg-amber-500/90',
        priority === 'P2' && 'bg-slate-400/80',
      )}
    >
      {priority}
    </span>
  );
}

function ClearButton({
  onClear,
  tone,
}: {
  onClear: () => void;
  tone: 'default' | 'on-solid';
}) {
  return (
    <button
      type="button"
      aria-label="移除排期"
      title="移除排期"
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={clsx(
        'absolute right-0.5 top-0.5 rounded-sm p-0.5 opacity-0 transition',
        'group-hover/pill:opacity-100 focus:opacity-100',
        tone === 'on-solid'
          ? 'text-cta-foreground/80 hover:bg-black/10 hover:text-cta-foreground'
          : 'text-ink-tertiary hover:bg-surface-3 hover:text-ink-primary',
      )}
    >
      <X className="h-3 w-3" strokeWidth={1.8} />
    </button>
  );
}

// -- Per-pill popover body ------------------------------------------

function PillPopoverBody({
  task,
  line,
  onMarkDone,
  onUndoDone,
  onArchive,
  onUnarchive,
  onClear,
  onOpenDetail,
  onOpenProject,
  onToggleSubItem,
}: {
  task: SlotTaskSummary;
  line?: { name: string; color?: RailColor };
  onMarkDone?: () => void;
  onUndoDone?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onClear?: () => void;
  onOpenDetail?: () => void;
  onOpenProject?: () => void;
  onToggleSubItem?: (subItemId: string) => void;
}) {
  const done = task.state === 'done';
  const pending = task.state === 'pending';
  const archived = task.state === 'archived';
  const subItems = task.subItems ?? [];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        {task.parentTitle && (
          <span className="text-2xs text-ink-tertiary">
            {task.parentTitle}
          </span>
        )}
        <span
          className={clsx(
            'line-clamp-3 text-sm',
            done
              ? 'text-ink-tertiary line-through decoration-ink-tertiary/50'
              : 'text-ink-primary',
          )}
        >
          {task.title || '未命名任务'}
        </span>
        {line && (
          <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {line.color && (
              <span
                aria-hidden
                className="h-2 w-[2px] rounded-sm"
                style={{ background: RAIL_COLOR_HEX[line.color] }}
              />
            )}
            <span className="truncate">{line.name}</span>
            {task.priority && <span>· {task.priority}</span>}
          </span>
        )}
      </div>

      {subItems.length > 0 && (
        <PopoverSubItems
          items={subItems}
          {...(onToggleSubItem && { onToggle: onToggleSubItem })}
        />
      )}

      <div className="flex flex-wrap items-center gap-1">
        {onMarkDone && !done && (
          <PopoverAction
            icon={<Check className="h-3 w-3" strokeWidth={2} />}
            onClick={onMarkDone}
          >
            完成
          </PopoverAction>
        )}
        {onUndoDone && done && (
          <PopoverAction
            icon={<RotateCcw className="h-3 w-3" strokeWidth={1.8} />}
            onClick={onUndoDone}
          >
            撤销完成
          </PopoverAction>
        )}
        {onArchive && pending && (
          <PopoverAction
            icon={<Archive className="h-3 w-3" strokeWidth={1.8} />}
            onClick={onArchive}
          >
            归档
          </PopoverAction>
        )}
        {onUnarchive && archived && (
          <PopoverAction
            icon={<RotateCcw className="h-3 w-3" strokeWidth={1.8} />}
            onClick={onUnarchive}
          >
            撤销归档
          </PopoverAction>
        )}
        {onOpenDetail && (
          <PopoverAction onClick={onOpenDetail}>详情</PopoverAction>
        )}
        {onOpenProject && (
          <PopoverAction
            icon={<ExternalLink className="h-3 w-3" strokeWidth={1.8} />}
            onClick={onOpenProject}
          >
            项目
          </PopoverAction>
        )}
        {onClear && (
          <PopoverAction
            icon={<X className="h-3 w-3" strokeWidth={1.8} />}
            onClick={onClear}
          >
            移除排期
          </PopoverAction>
        )}
      </div>
    </div>
  );
}

function PopoverSubItems({
  items,
  onToggle,
}: {
  items: Array<{ id: string; title: string; done: boolean }>;
  onToggle?: (id: string) => void;
}) {
  const doneCount = items.filter((i) => i.done).length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          子任务
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {doneCount}/{items.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((it) => (
          <li key={it.id} className="group flex items-start gap-1.5 rounded-sm px-1 py-0.5 hover:bg-surface-2/60">
            <button
              type="button"
              onClick={() => onToggle?.(it.id)}
              disabled={!onToggle}
              aria-label={it.done ? '标记未完成' : '标记完成'}
              className={clsx(
                'mt-0.5 shrink-0 transition',
                onToggle
                  ? 'text-ink-tertiary hover:text-ink-primary'
                  : 'cursor-default text-ink-tertiary/70',
              )}
            >
              {it.done ? (
                <Check className="h-3 w-3" strokeWidth={2.2} />
              ) : (
                <Circle className="h-3 w-3" strokeWidth={1.6} />
              )}
            </button>
            <span
              className={clsx(
                'line-clamp-2 text-xs',
                it.done
                  ? 'text-ink-tertiary line-through decoration-ink-tertiary/40'
                  : 'text-ink-primary',
              )}
            >
              {it.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PopoverAction({
  icon,
  onClick,
  children,
}: {
  icon?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
    >
      {icon}
      {children}
    </button>
  );
}

// -- Pill hover tooltip ---------------------------------------------

function PillTooltipBody({
  task,
  line,
}: {
  task: SlotTaskSummary;
  line?: { name: string; color?: RailColor };
}) {
  // Cap visible rows so a 20-item checklist doesn't turn the tooltip
  // into a wall; surplus is summarized as `… +N more`.
  const SUB_LIMIT = 6;
  const items = task.subItems ?? [];
  const visible = items.slice(0, SUB_LIMIT);
  const hidden = items.length - visible.length;
  return (
    <div className="flex max-w-[280px] flex-col gap-1.5 normal-case tracking-normal">
      {task.parentTitle && (
        <span className="line-clamp-1 text-[10px] leading-snug text-surface-0/70">
          {task.parentTitle}
        </span>
      )}
      <span className="line-clamp-3 text-2xs font-medium leading-snug text-surface-0">
        {task.title || '未命名任务'}
      </span>
      <PillMetaChips task={task} line={line} invert />
      {task.noteSnippet && (
        <span className="text-[10px] leading-snug text-surface-0/80">
          {task.noteSnippet}
        </span>
      )}
      {visible.length > 0 && <PillSubItemsList task={task} invert />}
    </div>
  );
}

/** Shared meta row. `invert` swaps colors for dark tooltip backgrounds
 *  (surface-0 text on ink-primary fill) vs the lighter NoteHoverPopover
 *  (ink-primary / tertiary on surface-1). */
function PillMetaChips({
  task,
  line,
  invert,
}: {
  task: SlotTaskSummary;
  line?: { name: string; color?: RailColor };
  invert: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px]',
        invert ? 'text-surface-0/70' : 'text-ink-tertiary',
      )}
    >
      {task.priority && <span>{task.priority}</span>}
      {line && <span>· {line.name}</span>}
      {task.isAutoTask && <span>· habit</span>}
      {task.subItemsTotal > 0 && (
        <span>
          · {task.subItemsDone}/{task.subItemsTotal}
        </span>
      )}
      {task.milestonePercent != null && (
        <span>· {task.milestonePercent}%</span>
      )}
    </div>
  );
}

/** Shared sub-items list (capped at 6 rows, surplus collapsed). */
function PillSubItemsList({
  task,
  invert,
}: {
  task: SlotTaskSummary;
  invert: boolean;
}) {
  const SUB_LIMIT = 6;
  const items = task.subItems ?? [];
  const visible = items.slice(0, SUB_LIMIT);
  const hidden = items.length - visible.length;
  const borderCls = invert ? 'border-surface-0/15' : 'border-hairline/60';
  const glyphDone = invert ? 'text-surface-0/90' : 'text-ink-primary';
  const glyphPending = invert ? 'text-surface-0/40' : 'text-ink-tertiary';
  const titleDone = invert
    ? 'text-surface-0/60 line-through decoration-surface-0/30'
    : 'text-ink-tertiary line-through decoration-ink-tertiary/40';
  const titlePending = invert ? 'text-surface-0/90' : 'text-ink-primary';
  const moreCls = invert ? 'text-surface-0/60' : 'text-ink-tertiary';
  return (
    <ul className={clsx('flex flex-col gap-0.5 border-t pt-1', borderCls)}>
      {visible.map((it) => (
        <li
          key={it.id}
          className="flex items-start gap-1 text-[10px] leading-snug"
        >
          <span
            aria-hidden
            className={clsx('mt-0.5 shrink-0', it.done ? glyphDone : glyphPending)}
          >
            {it.done ? '✓' : '○'}
          </span>
          <span className={clsx('line-clamp-2', it.done ? titleDone : titlePending)}>
            {it.title}
          </span>
        </li>
      ))}
      {hidden > 0 && (
        <li className={clsx('pl-3 font-mono text-[9px]', moreCls)}>
          … +{hidden} more
        </li>
      )}
    </ul>
  );
}

// -- Empty cell + add bar -------------------------------------------

function EmptyCell({
  date,
  railId,
  railName,
  onQuickCreate,
}: {
  date: string;
  railId: string;
  railName: string;
  onQuickCreate?: (date: string, railId: string, title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!onQuickCreate) {
    return <PlannedEmptyPlaceholder />;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Add task on ${date} to ${railName}`}
          className="block w-full max-w-full min-w-0 text-left"
        >
          <PlannedEmptyPlaceholder />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[260px]">
        <QuickCreatePopoverBody
          railName={railName}
          date={date}
          onSubmit={(title) => {
            onQuickCreate(date, railId, title);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function CellAddBar({
  date,
  railId,
  railName,
  onQuickCreate,
}: {
  date: string;
  railId: string;
  railName: string;
  onQuickCreate: (date: string, railId: string, title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Add another task on ${date} to ${railName}`}
          className={clsx(
            'flex h-5 w-full items-center justify-center gap-1 rounded-sm border border-dashed border-ink-tertiary/30 text-2xs text-ink-tertiary/70 transition',
            'max-w-full min-w-0',
            'opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100',
            'hover:border-ink-tertiary/60 hover:text-ink-primary',
            open && 'opacity-100',
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={1.8} />
          <span className="font-mono uppercase tracking-widest">add</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[260px]">
        <QuickCreatePopoverBody
          railName={railName}
          date={date}
          onSubmit={(title) => {
            onQuickCreate(date, railId, title);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function QuickCreatePopoverBody({
  railName,
  date,
  onSubmit,
  onCancel,
}: {
  railName: string;
  date: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const ime = useIme();
  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onSubmit(t);
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {railName} · {formatSlotDate(date)}
      </span>
      <input
        type="text"
        value={value}
        autoFocus
        placeholder="任务标题 · Enter 添加"
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !ime.isComposing(e)) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-8 rounded-md border border-hairline/60 bg-surface-0 px-2 text-sm text-ink-primary outline-none transition focus:border-ink-secondary"
      />
    </div>
  );
}

function formatSlotDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  });
}

function PlannedEmptyPlaceholder() {
  return (
    <div
      className={clsx(
        'relative h-full min-h-[44px] w-full max-w-full min-w-0 rounded-sm transition',
        'border border-dashed border-ink-tertiary/30',
        'hover:border-ink-tertiary/60 hover:bg-surface-1',
      )}
    />
  );
}

// Keep STEP_4 export referenced for future "N/A" cells.
void RAIL_COLOR_STEP_4;
