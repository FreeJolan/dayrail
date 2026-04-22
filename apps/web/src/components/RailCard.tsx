import { Archive, ArrowUpRight, Check, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import type { RailColor } from '@/data/sample';
import {
  CTA_HEX,
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
} from './railColors';
import { NoteHoverPopover } from './NoteHoverPopover';

// v0.4 per-task-independent layout.
//
// Anatomy:
//  ┌───────────────────────────────────────────────────────────┐
//  │█│ Rail name            13:00 → 14:00 · 1h · CURRENT RAIL   │
//  │█│ optional subtitle                                         │
//  │█│                                                           │
//  │█│ task row 1  · status glyph + title + badges + actions     │
//  │█│ task row 2  · ...                                         │
//  └───────────────────────────────────────────────────────────┘
//
// Card chrome is purely time-based (current rail gets terracotta
// strip + surface-2 bg). Every task row carries its own completion
// state and its own actions — multiple tasks on the same rail can be
// in different states at the same time.

export type TimelineTaskState =
  | 'pending'
  | 'unmarked' // pending but the rail window has ended
  | 'done'
  | 'deferred'
  | 'archived';

export interface TimelineTask {
  id: string;
  title: string;
  state: TimelineTaskState;
  hasNote: boolean;
  /** Full Markdown source — used by the `· 备注` badge's hover popover
   *  to render the note with structure instead of a plain-text blurb.
   *  Only populated when `hasNote` is true. */
  note?: string;
  subItemsDone: number;
  subItemsTotal: number;
  milestonePercent?: number;
  isAutoTask: boolean;
  /** Latest Shift tags attached to this task. Rendered on settled rows
   *  (done / deferred / archived) so the user sees *why* at a glance. */
  tags?: string[];
}

interface RailShape {
  id: string;
  name: string;
  subtitle?: string;
  color: RailColor;
  start: string; // HH:MM
  end: string; // HH:MM
}

interface Props {
  rail: RailShape;
  /** Time-based: the rail's window contains `now`. Drives terracotta
   *  strip + "CURRENT RAIL" chip + always-visible action bars on
   *  pending rows. */
  isCurrent: boolean;
  tasks: TimelineTask[];
  /** Fired when a pending / unmarked row's action button is clicked. */
  onTaskAction?: (taskId: string, action: 'done' | 'defer' | 'archive') => void;
  /** Fired when a settled row's undo button is clicked. */
  onTaskUndo?: (taskId: string) => void;
  /** Click a task row body to open its detail drawer. */
  onTaskOpenDetail?: (taskId: string) => void;
}

export function RailCard({
  rail,
  isCurrent,
  tasks,
  onTaskAction,
  onTaskUndo,
  onTaskOpenDetail,
}: Props) {
  const duration = computeDurationMinutes(rail.start, rail.end);
  const stripColor = isCurrent ? CTA_HEX : RAIL_COLOR_HEX[rail.color];

  return (
    <article
      aria-label={rail.name}
      className={clsx(
        'relative overflow-hidden rounded-md bg-surface-1',
        isCurrent && 'bg-surface-2',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'absolute inset-y-0 left-0 w-1',
          isCurrent && 'w-1.5',
        )}
        style={{ background: stripColor }}
      />

      <div className="relative flex flex-col gap-2 px-5 py-4 pl-6">
        <header className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <h3
              className={clsx(
                'font-mono text-xs uppercase tracking-widest',
                isCurrent ? 'text-ink-primary' : 'text-ink-secondary',
              )}
            >
              {rail.name}
            </h3>
            {isCurrent && <CurrentRailChip />}
          </div>

          <time
            className={clsx(
              'shrink-0 font-mono text-xs tabular-nums',
              isCurrent ? 'text-ink-secondary' : 'text-ink-tertiary',
            )}
            dateTime={`${rail.start}/${rail.end}`}
          >
            {rail.start} <span className="text-ink-tertiary">→</span> {rail.end}
            <span className="ml-2 text-ink-tertiary">
              {formatDuration(duration)}
            </span>
          </time>
        </header>

        {rail.subtitle && (
          <p
            className={clsx(
              'text-sm',
              isCurrent ? 'text-ink-secondary' : 'text-ink-tertiary',
            )}
          >
            {rail.subtitle}
          </p>
        )}

        {tasks.length === 0 ? (
          <p className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            no task scheduled
          </p>
        ) : (
          <ul className="flex flex-col">
            {tasks.map((task, i) => (
              <TaskRow
                key={task.id}
                task={task}
                railColor={rail.color}
                isCurrent={isCurrent}
                isFirst={i === 0}
                {...(onTaskAction && {
                  onAction: (a) => onTaskAction(task.id, a),
                })}
                {...(onTaskUndo && { onUndo: () => onTaskUndo(task.id) })}
                {...(onTaskOpenDetail && {
                  onOpenDetail: () => onTaskOpenDetail(task.id),
                })}
              />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------
// Per-task row.
// ------------------------------------------------------------------

function TaskRow({
  task,
  railColor,
  isCurrent,
  isFirst,
  onAction,
  onUndo,
  onOpenDetail,
}: {
  task: TimelineTask;
  railColor: RailColor;
  isCurrent: boolean;
  isFirst: boolean;
  onAction?: (action: 'done' | 'defer' | 'archive') => void;
  onUndo?: () => void;
  onOpenDetail?: () => void;
}) {
  const isPending = task.state === 'pending';
  const isUnmarked = task.state === 'unmarked';
  const isDone = task.state === 'done';
  const isDeferred = task.state === 'deferred';
  const isArchived = task.state === 'archived';
  const settled = isDone || isDeferred || isArchived;

  const hatching = rowHatching(task.state, railColor);

  return (
    <li
      className={clsx(
        'group/row relative flex flex-col gap-1.5 py-2',
        !isFirst && 'border-t border-hairline/30',
        onOpenDetail && 'cursor-pointer',
        isDone && 'opacity-70',
        isArchived && 'opacity-60',
      )}
      style={{ ['--hatch' as string]: hatching?.color }}
      role={onOpenDetail ? 'button' : undefined}
      tabIndex={onOpenDetail ? 0 : undefined}
      onClick={onOpenDetail}
      onKeyDown={
        onOpenDetail
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDetail();
              }
            }
          : undefined
      }
    >
      {hatching && (
        <span
          aria-hidden
          className={clsx(
            'pointer-events-none absolute inset-0',
            hatching.kind === 'unmarked' ? 'hatch-unmarked' : 'hatch-skipped',
          )}
        />
      )}

      <div className="relative flex items-center gap-2">
        <StateGlyph state={task.state} color={railColor} />
        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-sm',
            isDone &&
              'text-ink-tertiary line-through decoration-ink-tertiary/40',
            isArchived &&
              'text-ink-tertiary line-through decoration-ink-tertiary/40',
            (isDeferred || isUnmarked) && 'text-ink-tertiary',
            (isPending || (isPending && isCurrent)) && 'text-ink-primary',
          )}
        >
          {task.title}
        </span>
        <RowStateLabel state={task.state} />
      </div>

      <TaskBadges task={task} />

      {task.tags && task.tags.length > 0 && settled && (
        <div className="relative flex flex-wrap items-center gap-1">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-ink-tertiary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Unmarked = pending + past time. Same decision ("what happened
          to this task?") as pending, just retroactive; reuse the full
          action bar. Unmarked rows keep the bar always-visible so the
          user doesn't miss it. */}
      {(isPending || isUnmarked) && (
        <ActionRow
          alwaysVisible={isCurrent || isUnmarked}
          onAction={onAction}
        />
      )}
      {isDeferred && <UndoRow label="取消以后再说" onClick={onUndo} />}
      {isArchived && <UndoRow label="取消归档" onClick={onUndo} />}
      {isDone && <UndoRow label="撤回完成" onClick={onUndo} />}
    </li>
  );
}

function TaskBadges({ task }: { task: TimelineTask }) {
  const anything =
    task.isAutoTask ||
    task.subItemsTotal > 0 ||
    task.hasNote ||
    task.milestonePercent != null;
  if (!anything) return null;
  return (
    <div className="relative flex flex-wrap items-center gap-1.5 pl-5 text-ink-tertiary">
      {task.isAutoTask && (
        <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest">
          habit
        </span>
      )}
      {task.subItemsTotal > 0 && (
        <span className="font-mono text-2xs tabular-nums">
          子项 {task.subItemsDone}/{task.subItemsTotal}
        </span>
      )}
      {task.hasNote && task.note ? (
        <NoteHoverPopover note={task.note} side="top" align="start">
          <span
            tabIndex={0}
            className="cursor-help rounded-sm font-mono text-2xs uppercase tracking-widest transition hover:text-ink-primary focus:outline-none focus-visible:text-ink-primary"
          >
            · 备注
          </span>
        </NoteHoverPopover>
      ) : task.hasNote ? (
        <span className="font-mono text-2xs uppercase tracking-widest">
          · 备注
        </span>
      ) : null}
      {task.milestonePercent != null && (
        <span className="font-mono text-2xs tabular-nums">
          · {task.milestonePercent}%
        </span>
      )}
    </div>
  );
}

// State glyph — replaces the v0.3 "card-wide state" treatment. Sits
// flush-left of the task title.
function StateGlyph({
  state,
  color,
}: {
  state: TimelineTaskState;
  color: RailColor;
}) {
  if (state === 'done') {
    return (
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-ink-primary/10 text-ink-tertiary">
        <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
      </span>
    );
  }
  if (state === 'deferred') {
    return (
      <ArrowUpRight
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-ink-tertiary"
        strokeWidth={1.8}
      />
    );
  }
  if (state === 'archived') {
    return (
      <Archive
        aria-hidden
        className="h-3 w-3 shrink-0 text-ink-tertiary"
        strokeWidth={1.8}
      />
    );
  }
  if (state === 'unmarked') {
    return (
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0 rounded-sm ring-1 ring-ink-tertiary/40"
      />
    );
  }
  // pending — rail-colored dot
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-sm"
      style={{ background: RAIL_COLOR_HEX[color] }}
    />
  );
}

function RowStateLabel({ state }: { state: TimelineTaskState }) {
  if (state === 'pending' || state === 'done') return null;
  const label =
    state === 'deferred'
      ? 'Later'
      : state === 'archived'
      ? 'Archived'
      : 'Unmarked';
  return (
    <span className="shrink-0 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      {label}
    </span>
  );
}

// ------------------------------------------------------------------
// Reusable sub-parts.
// ------------------------------------------------------------------

function CurrentRailChip() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm bg-cta px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-cta-foreground"
      style={{ letterSpacing: '0.14em' }}
    >
      <span className="relative inline-flex h-1.5 w-1.5 items-center justify-center">
        <span className="absolute h-full w-full animate-ping rounded-full bg-cta-soft opacity-80" />
        <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-cta-soft" />
      </span>
      Current Rail
    </span>
  );
}

function ActionRow({
  alwaysVisible,
  onAction,
}: {
  alwaysVisible: boolean;
  onAction?: (action: 'done' | 'defer' | 'archive') => void;
}) {
  return (
    <div
      className={clsx(
        'relative flex items-center gap-2 pl-5 transition duration-200',
        alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 translate-y-1 group-hover/row:translate-y-0 group-hover/row:opacity-100',
      )}
    >
      <ActionButton
        variant="primary"
        icon={Check}
        label="完成"
        onClick={(e) => {
          e.stopPropagation();
          onAction?.('done');
        }}
      />
      <ActionButton
        icon={Clock}
        label="以后再说"
        onClick={(e) => {
          e.stopPropagation();
          onAction?.('defer');
        }}
      />
      <ActionButton
        icon={Archive}
        label="归档"
        onClick={(e) => {
          e.stopPropagation();
          onAction?.('archive');
        }}
      />
    </div>
  );
}

function UndoRow({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <div className="relative flex items-center gap-2 pl-5 opacity-0 transition group-hover/row:opacity-100">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        className="rounded-sm px-2.5 py-1 text-xs font-medium text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-secondary"
      >
        {label}
      </button>
    </div>
  );
}

function ActionButton({
  variant = 'default',
  icon: Icon,
  label,
  onClick,
}: {
  variant?: 'default' | 'primary' | 'terracotta';
  icon: typeof Check;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition',
        variant === 'primary' &&
          'bg-ink-primary text-surface-0 hover:bg-ink-secondary',
        variant === 'default' &&
          'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
        variant === 'terracotta' &&
          'border border-cta/40 text-cta hover:bg-cta hover:text-cta-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

// ------------------------------------------------------------------
// Helpers.
// ------------------------------------------------------------------

function computeDurationMinutes(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh! - sh!) * 60 + (em! - sm!);
}

function formatDuration(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
}

function rowHatching(
  state: TimelineTaskState,
  color: RailColor,
): { kind: 'unmarked' | 'skipped'; color: string } | undefined {
  if (state === 'unmarked') {
    return { kind: 'unmarked', color: RAIL_COLOR_STEP_4[color] };
  }
  if (state === 'deferred' || state === 'archived') {
    return { kind: 'skipped', color: RAIL_COLOR_STEP_6[color] };
  }
  return undefined;
}
