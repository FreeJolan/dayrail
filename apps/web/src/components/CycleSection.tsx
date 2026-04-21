import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { TaskPriority } from '@dayrail/core';
import {
  type CycleDay,
  type CycleSlot,
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
import { TASK_DRAG_MIME } from './BacklogDrawer';
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
  todayISO: string;
  templateChoices: TemplateChoice[];
  onOverride: (date: string, nextTemplate: TemplateKey) => void;
  onClearOverride: (date: string) => void;
  onDropTask?: (taskId: string, date: string, railId: string) => void;
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
  todayISO,
  templateChoices,
  onOverride,
  onClearOverride,
  onDropTask,
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
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // `hoverRailId` falls out of the hoverKey (railId|date). Derived
  // separately so the rail row + left label can signal "this Rail
  // will receive the drop" without every cell tracking it.
  const hoverRailId = hoverKey ? hoverKey.split('|')[0] : null;

  // Clear the drag highlight once the drag ends (successful drop,
  // cancel/ESC, or dragging out of the window). We don't use per-cell
  // dragleave because it fires every time the cursor transitions
  // between a cell's child elements — that's the "frantic flicker"
  // bug. dragover alone handles the "what cell am I over" question
  // (each hover sets hoverKey to that cell, overwriting the previous
  // in a single state write), and window-level dragend/drop wipes
  // state exactly once when the gesture is over.
  useEffect(() => {
    const clear = () => setHoverKey(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear, true);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear, true);
    };
  }, []);

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
          onOverride={onOverride}
          onClearOverride={onClearOverride}
        />

        <table className="table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-[140px]" />
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
                  className={clsx(
                    'pr-3 py-1 text-left align-top transition',
                    railIsDropTarget && 'bg-cta-soft/25',
                  )}
                >
                  <RailRowLabel rail={rail} isDropTarget={railIsDropTarget} />
                </th>
                {days.map((d) => {
                  const slot = slotsByKey.get(`${rail.id}|${d.date}`);
                  const cellKey = `${rail.id}|${d.date}`;
                  const tasks = slot?.tasks ?? [];
                  const canDrop = onDropTask != null;
                  const isHover = hoverKey === cellKey;
                  const railSoftHover = railIsDropTarget && !isHover;
                  return (
                    <td
                      key={d.date}
                      onDragOver={
                        canDrop
                          ? (e) => {
                              if (!hasTaskPayload(e)) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              // Monotonic set — React bails when next
                              // state equals prev, so the ~60Hz dragover
                              // cadence doesn't cause re-renders once
                              // the cursor stabilizes on a cell.
                              if (hoverKey !== cellKey) setHoverKey(cellKey);
                            }
                          : undefined
                      }
                      onDrop={
                        canDrop
                          ? (e) => {
                              const taskId = e.dataTransfer.getData(
                                TASK_DRAG_MIME,
                              );
                              setHoverKey(null);
                              if (!taskId) return;
                              e.preventDefault();
                              onDropTask(taskId, d.date, rail.id);
                            }
                          : undefined
                      }
                      className={clsx(
                        'p-1 align-top transition',
                        d.date === todayISO && 'bg-surface-2/40',
                        railSoftHover && 'bg-cta-soft/15',
                        isHover && 'bg-cta-soft/30 ring-1 ring-inset ring-cta/60',
                      )}
                    >
                      <CycleCell
                        tasks={tasks}
                        color={rail.color}
                        date={d.date}
                        railId={rail.id}
                        railName={rail.name}
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
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function hasTaskPayload(e: React.DragEvent<HTMLTableCellElement>): boolean {
  return Array.from(e.dataTransfer.types).includes(TASK_DRAG_MIME);
}

function SectionMiniHeader({
  templateLabel,
  days,
  stripColor,
  todayISO,
  templateChoices,
  onOverride,
  onClearOverride,
}: {
  templateLabel: string;
  days: CycleDay[];
  stripColor: string;
  todayISO: string;
  templateChoices: TemplateChoice[];
  onOverride: (date: string, nextTemplate: TemplateKey) => void;
  onClearOverride: (date: string) => void;
}) {
  return (
    <div className="flex min-h-[48px] items-center gap-0 border-b border-transparent py-2">
      <table className="table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[140px]" />
          {days.map((d) => (
            <col key={d.date} className="w-[180px]" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="pr-3 text-left align-middle">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-[3px] rounded-sm"
                  style={{ background: stripColor }}
                />
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
                  {templateLabel}
                </span>
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  · {days.length} days
                </span>
              </div>
            </th>
            {days.map((d) => (
              <th key={d.date} className="px-1 text-left align-middle">
                <DayCellButton
                  day={d}
                  isToday={d.date === todayISO}
                  templateChoices={templateChoices}
                  onOverride={(tpl) => onOverride(d.date, tpl)}
                  onClearOverride={() => onClearOverride(d.date)}
                />
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </div>
  );
}

function DayCellButton({
  day,
  isToday,
  templateChoices,
  onOverride,
  onClearOverride,
}: {
  day: CycleDay;
  isToday: boolean;
  templateChoices: TemplateChoice[];
  onOverride: (tpl: TemplateKey) => void;
  onClearOverride: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { weekday, dayNum } = formatDayLabel(day);
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          <ChevronDown
            aria-hidden
            className="ml-auto h-3 w-3 text-ink-tertiary opacity-0 transition group-hover:opacity-100"
            strokeWidth={1.8}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[200px] p-1">
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
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {fmtHHMM(rail.startMin)} → {fmtHHMM(rail.endMin)}
        </span>
      </span>
      <span
        aria-hidden
        className={clsx(
          'font-mono text-[9px] uppercase tracking-widest text-cta transition-opacity',
          isDropTarget ? 'opacity-100' : 'opacity-0',
        )}
      >
        →
      </span>
    </div>
  );
}
