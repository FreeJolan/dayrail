import { clsx } from 'clsx';
import { useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, X } from 'lucide-react';
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

// ERD §5.3 D1-1B — per-template stacked section. Each section is a
// self-contained mini-grid. Structure:
//
//   ┌─── 8 px Template.color strip ───────────────────────────────┐
//   │  ┌─ 24 px section mini-header ───────────────────────────┐  │
//   │  │ TEMPLATE · N days  | Mon 13 | Tue 14 | ... | Thu 16   │  │
//   │  │                      ↑ each date cell is the sole     │  │
//   │  │                        CycleDay template-switch entry │  │
//   │  └────────────────────────────────────────────────────── ┘  │
//   │  Rail row: [name · time]  | cell | cell | cell | cell       │
//   │  ...                                                         │
//   └──────────────────────────────────────────────────────────────┘

/** Minimal template shape a section's day-header popover needs. */
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
  onOpenTaskProject?: (taskId: string) => void;
  onQuickCreate?: (date: string, railId: string, title: string) => void;
  /** Look up the Project / Habit a task belongs to, so the slot
   *  popover can render the Line name + color without each cell
   *  subscribing to the store directly. */
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
  onOpenTaskProject,
  onQuickCreate,
  lineLookup,
}: Props) {
  const stripColor = RAIL_COLOR_HEX[templateColor];
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);
  const [openQuickCreateKey, setOpenQuickCreateKey] = useState<string | null>(
    null,
  );

  return (
    <section
      aria-label={`${templateLabel} section`}
      className="relative overflow-hidden rounded-md bg-surface-1"
    >
      {/* 8 px left color strip (decorative, G2 whitelist) */}
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
            {rails.map((rail) => (
              <tr key={rail.id}>
                <th
                  scope="row"
                  className="pr-3 py-1 text-left align-top"
                >
                  <RailRowLabel rail={rail} />
                </th>
                {days.map((d) => {
                  const slot = slotsByKey.get(`${rail.id}|${d.date}`);
                  const cellKey = `${rail.id}|${d.date}`;
                  // Only empty cells accept drops — preventing a second
                  // task from silently shadowing an existing slot.
                  const canDrop = onDropTask != null && slot == null;
                  const isHover = hoverKey === cellKey;
                  return (
                    <td
                      key={d.date}
                      onDragEnter={
                        canDrop
                          ? (e) => {
                              if (!hasTaskPayload(e)) return;
                              e.preventDefault();
                              setHoverKey(cellKey);
                            }
                          : undefined
                      }
                      onDragOver={
                        canDrop
                          ? (e) => {
                              if (!hasTaskPayload(e)) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }
                          : undefined
                      }
                      onDragLeave={
                        canDrop
                          ? () => {
                              setHoverKey((k) =>
                                k === cellKey ? null : k,
                              );
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
                        isHover && 'bg-cta-soft/30 ring-1 ring-inset ring-cta/60',
                      )}
                    >
                      {slot ? (
                        slot.state === 'planned-task' &&
                        slot.taskId &&
                        onClearSlot ? (
                          <Popover
                            open={openPopoverKey === cellKey}
                            onOpenChange={(o) =>
                              setOpenPopoverKey(o ? cellKey : null)
                            }
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="block w-full text-left"
                                aria-label={`Slot for ${slot.taskName ?? 'task'}`}
                              >
                                <CycleCell
                                  state={slot.state}
                                  color={rail.color}
                                  taskName={slot.taskName}
                                  meta={slot.meta}
                                />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="center"
                              className="w-[260px]"
                            >
                              {(() => {
                                const line = slot.taskId
                                  ? lineLookup?.(slot.taskId)
                                  : undefined;
                                return (
                                  <SlotPopoverBody
                                    taskName={slot.taskName ?? ''}
                                    railName={rail.name}
                                    date={d.date}
                                    lineName={line?.name}
                                    lineColor={line?.color}
                                    onMarkDone={() => {
                                      onMarkTaskDone?.(slot.taskId!);
                                      setOpenPopoverKey(null);
                                    }}
                                    onClear={() => {
                                      onClearSlot(slot.taskId!);
                                      setOpenPopoverKey(null);
                                    }}
                                    onOpenProject={
                                      onOpenTaskProject
                                        ? () => {
                                            onOpenTaskProject(slot.taskId!);
                                            setOpenPopoverKey(null);
                                          }
                                        : undefined
                                    }
                                  />
                                );
                              })()}
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <CycleCell
                            state={slot.state}
                            color={rail.color}
                            taskName={slot.taskName}
                            meta={slot.meta}
                          />
                        )
                      ) : onQuickCreate ? (
                        <Popover
                          open={openQuickCreateKey === cellKey}
                          onOpenChange={(o) =>
                            setOpenQuickCreateKey(o ? cellKey : null)
                          }
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="block w-full text-left"
                              aria-label={`Add task on ${d.date} to ${rail.name}`}
                            >
                              <CycleCell
                                state="planned-empty"
                                color={rail.color}
                              />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="center"
                            className="w-[260px]"
                          >
                            <QuickCreateBody
                              railName={rail.name}
                              date={d.date}
                              onSubmit={(title) => {
                                onQuickCreate(d.date, rail.id, title);
                                setOpenQuickCreateKey(null);
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <CycleCell state="planned-empty" color={rail.color} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
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

function RailRowLabel({ rail }: { rail: EditableRail }) {
  return (
    <div className="flex items-center gap-2">
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
    </div>
  );
}

function QuickCreateBody({
  railName,
  date,
  onSubmit,
}: {
  railName: string;
  date: string;
  onSubmit: (title: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Add task
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {railName} · {formatSlotDate(date)}
        </span>
      </div>
      <input
        type="text"
        value={value}
        autoFocus
        placeholder="任务标题 · Enter"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // `nativeEvent.isComposing` is true while an IME candidate
          // window is open — Enter in that state confirms the pinyin
          // pick, not a form submit.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="h-8 rounded-md border border-hairline/60 bg-surface-0 px-2 text-sm text-ink-primary outline-none transition focus:border-ink-secondary"
      />
    </div>
  );
}

function SlotPopoverBody({
  taskName,
  railName,
  date,
  lineName,
  lineColor,
  onMarkDone,
  onClear,
  onOpenProject,
}: {
  taskName: string;
  railName: string;
  date: string;
  lineName?: string;
  lineColor?: RailColor;
  onMarkDone: () => void;
  onClear: () => void;
  onOpenProject?: () => void;
}) {
  const lineChip = lineName && (
    <>
      {lineColor && (
        <span
          aria-hidden
          className="h-2 w-[2px] rounded-sm"
          style={{ background: RAIL_COLOR_HEX[lineColor] }}
        />
      )}
      {lineName}
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="line-clamp-2 text-sm text-ink-primary">
          {taskName || '未命名任务'}
        </span>
        {lineName &&
          (onOpenProject ? (
            <button
              type="button"
              onClick={onOpenProject}
              className="group flex items-center gap-1.5 self-start font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:text-ink-primary"
            >
              {lineChip}
              <ArrowUpRight
                className="h-2.5 w-2.5 opacity-0 transition group-hover:opacity-100"
                strokeWidth={1.8}
              />
            </button>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {lineChip}
            </span>
          ))}
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {railName} · {formatSlotDate(date)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onMarkDone}
          className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-primary transition hover:bg-surface-3"
        >
          <Check className="h-3 w-3" strokeWidth={2} />
          标记完成
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <X className="h-3 w-3" strokeWidth={1.8} />
          移除排期
        </button>
      </div>
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
