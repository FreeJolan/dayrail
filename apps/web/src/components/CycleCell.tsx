import { clsx } from 'clsx';
import { ArrowUpRight, Check } from 'lucide-react';
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

interface Props {
  tasks: SlotTaskSummary[];
  color: RailColor;
}

export function CycleCell({ tasks, color }: Props) {
  if (tasks.length === 0) return <PlannedEmptyCell />;
  return (
    <div className="relative flex h-full min-h-[44px] flex-col gap-1 rounded-sm bg-surface-1 px-1.5 py-1.5 transition hover:bg-surface-2">
      {tasks.map((t) => (
        <TaskPill key={t.taskId} task={t} color={color} />
      ))}
    </div>
  );
}

function TaskPill({
  task,
  color,
}: {
  task: SlotTaskSummary;
  color: RailColor;
}) {
  if (task.state === 'done') return <DonePill task={task} color={color} />;
  if (task.state === 'deferred') return <DeferredPill task={task} color={color} />;
  if (task.state === 'archived') return <ArchivedPill task={task} color={color} />;
  return <PendingPill task={task} color={color} />;
}

function PendingPill({
  task,
  color,
}: {
  task: SlotTaskSummary;
  color: RailColor;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm px-1 py-0.5">
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
    </div>
  );
}

function DonePill({
  task,
  color,
}: {
  task: SlotTaskSummary;
  color: RailColor;
}) {
  const bg = RAIL_COLOR_HEX[color];
  const text = RAIL_TEXT_ON_SOLID[color];
  return (
    <div
      className="relative flex flex-col gap-0.5 rounded-sm px-1.5 py-1"
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
    </div>
  );
}

function DeferredPill({
  task,
  color,
}: {
  task: SlotTaskSummary;
  color: RailColor;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-sm px-1.5 py-1"
      style={{ background: RAIL_COLOR_STEP_7[color] }}
    >
      <div className="flex items-start gap-1.5">
        <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-ink-secondary" strokeWidth={1.8} />
        <span className="line-clamp-2 text-xs text-ink-primary">
          {task.title}
        </span>
      </div>
      <Badges task={task} tone="default" />
    </div>
  );
}

function ArchivedPill({
  task,
  color,
}: {
  task: SlotTaskSummary;
  color: RailColor;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-sm px-1.5 py-1 hatch-skipped opacity-80"
      style={{ ['--hatch' as string]: RAIL_COLOR_STEP_6[color] }}
    >
      <span className="line-clamp-2 text-xs text-ink-tertiary line-through decoration-ink-tertiary/40">
        {task.title}
      </span>
      <Badges task={task} tone="default" />
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
