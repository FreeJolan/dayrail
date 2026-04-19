import { clsx } from 'clsx';
import { ArrowUpRight, Check, X } from 'lucide-react';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
  RAIL_COLOR_STEP_7,
  RAIL_TEXT_ON_SOLID,
} from './railColors';
import type { RailColor } from '@/data/sample';
import type { SlotTaskState, SlotTaskSummary } from '@/data/sampleCycle';

// ERD §5.3 D7 / §4.1 "Slot ↔ Task one-to-many". One cell renders a
// list of task pills stacked vertically; each pill is styled per
// task.status. Empty cell = dashed placeholder that invites +add.
// Each pill has a hover-reveal X for one-click unschedule; the full
// task actions still live in the popover.

interface Props {
  tasks: SlotTaskSummary[];
  color: RailColor;
  /** Unschedule a specific task from this cell. Hover-reveal X on
   *  each pill. The X swallows the click so the slot popover doesn't
   *  open. */
  onClearTask?: (taskId: string) => void;
}

export function CycleCell({ tasks, color, onClearTask }: Props) {
  if (tasks.length === 0) return <PlannedEmptyCell />;
  return (
    <div className="relative flex h-full min-h-[44px] flex-col gap-1 rounded-sm bg-surface-1 px-1.5 py-1.5 transition hover:bg-surface-2">
      {tasks.map((t) => (
        <TaskPill
          key={t.taskId}
          task={t}
          color={color}
          {...(onClearTask && { onClear: () => onClearTask(t.taskId) })}
        />
      ))}
    </div>
  );
}

function TaskPill({
  task,
  color,
  onClear,
}: {
  task: SlotTaskSummary;
  color: RailColor;
  onClear?: () => void;
}) {
  if (task.state === 'done')
    return <DonePill task={task} color={color} onClear={onClear} />;
  if (task.state === 'deferred')
    return <DeferredPill task={task} color={color} onClear={onClear} />;
  if (task.state === 'archived')
    return <ArchivedPill task={task} color={color} onClear={onClear} />;
  return <PendingPill task={task} color={color} onClear={onClear} />;
}

/** Hover-reveal X positioned inside a pill. Stops click propagation so
 *  the parent popover trigger doesn't fire — "clear" is a distinct
 *  action from "open popover". */
function ClearButton({
  onClear,
  tone = 'default',
}: {
  onClear: () => void;
  tone?: 'default' | 'on-solid';
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

function PendingPill({
  task,
  color,
  onClear,
}: {
  task: SlotTaskSummary;
  color: RailColor;
  onClear?: () => void;
}) {
  return (
    <div className="group/pill relative flex flex-col gap-0.5 rounded-sm px-1 py-0.5 pr-5">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ background: RAIL_COLOR_HEX[color] }}
        />
        <span className="line-clamp-2 text-xs text-ink-primary">
          {task.title}
        </span>
      </div>
      <Badges task={task} tone="default" />
      {onClear && <ClearButton onClear={onClear} />}
    </div>
  );
}

function DonePill({
  task,
  color,
  onClear,
}: {
  task: SlotTaskSummary;
  color: RailColor;
  onClear?: () => void;
}) {
  const bg = RAIL_COLOR_HEX[color];
  const text = RAIL_TEXT_ON_SOLID[color];
  return (
    <div
      className="group/pill relative flex flex-col gap-0.5 rounded-sm px-1.5 py-1 pr-5"
      style={{ background: bg, color: text }}
    >
      <div className="flex items-start gap-1.5">
        <Check
          aria-hidden
          className="mt-0.5 h-3 w-3 shrink-0"
          strokeWidth={2.4}
          style={{ opacity: 0.7 }}
        />
        <span className="line-clamp-2 text-xs" style={{ opacity: 0.92 }}>
          {task.title}
        </span>
      </div>
      <Badges task={task} tone="on-solid" />
      {onClear && <ClearButton onClear={onClear} tone="on-solid" />}
    </div>
  );
}

function DeferredPill({
  task,
  color,
  onClear,
}: {
  task: SlotTaskSummary;
  color: RailColor;
  onClear?: () => void;
}) {
  return (
    <div
      className="group/pill relative flex flex-col gap-0.5 rounded-sm px-1.5 py-1 pr-5"
      style={{ background: RAIL_COLOR_STEP_7[color] }}
    >
      <div className="flex items-start gap-1.5">
        <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-ink-secondary" strokeWidth={1.8} />
        <span className="line-clamp-2 text-xs text-ink-primary">
          {task.title}
        </span>
      </div>
      <Badges task={task} tone="default" />
      {onClear && <ClearButton onClear={onClear} />}
    </div>
  );
}

function ArchivedPill({
  task,
  color,
  onClear,
}: {
  task: SlotTaskSummary;
  color: RailColor;
  onClear?: () => void;
}) {
  return (
    <div
      className="group/pill relative flex flex-col gap-0.5 rounded-sm px-1.5 py-1 pr-5 hatch-skipped opacity-80"
      style={{ ['--hatch' as string]: RAIL_COLOR_STEP_6[color] }}
    >
      <span className="line-clamp-2 text-xs text-ink-tertiary line-through decoration-ink-tertiary/40">
        {task.title}
      </span>
      <Badges task={task} tone="default" />
      {onClear && <ClearButton onClear={onClear} />}
    </div>
  );
}

function Badges({
  task,
  tone,
}: {
  task: SlotTaskSummary;
  tone: 'default' | 'on-solid';
}) {
  const anything =
    task.subItemsTotal > 0 ||
    task.hasNote ||
    task.milestonePercent != null ||
    task.isAutoTask;
  if (!anything) return null;
  const color =
    tone === 'on-solid' ? { opacity: 0.75 } : undefined;
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-1 font-mono text-2xs tabular-nums',
        tone === 'on-solid' ? '' : 'text-ink-tertiary',
      )}
      style={color}
    >
      {task.isAutoTask && <span>habit</span>}
      {task.subItemsTotal > 0 && (
        <span>
          {task.subItemsDone}/{task.subItemsTotal}
        </span>
      )}
      {task.hasNote && <span>·备</span>}
      {task.milestonePercent != null && <span>{task.milestonePercent}%</span>}
    </div>
  );
}

function PlannedEmptyCell() {
  return (
    <div
      className={clsx(
        'relative h-full min-h-[44px] rounded-sm transition',
        'border border-dashed border-ink-tertiary/30',
        'hover:border-ink-tertiary/60 hover:bg-surface-1',
      )}
    />
  );
}

// Keep the STEP_4 import referenced so future N/A-style cells can
// re-use it without a round-trip through git blame.
void RAIL_COLOR_STEP_4;
void Array.isArray;
export type { SlotTaskState };
