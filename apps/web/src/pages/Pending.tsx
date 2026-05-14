import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Archive, CalendarClock, CircleDashed, Clock, Inbox } from 'lucide-react';
import {
  selectPendingQueue,
  useStore,
  type CarriedTaskRow,
  type Shift,
  type Task,
} from '@dayrail/core';
import { RAIL_COLOR_HEX } from '@/components/railColors';
import { ReasonToast } from '@/components/ReasonToast';
import { SchedulePopover } from '@/components/SchedulePopover';
import {
  latestTagsForTask,
  useReasonToast,
} from '@/components/useReasonToast';
import { TaskDetailDrawer } from './Tasks';
import type { RailColor } from '@/data/sample';

// ERD §5.7 — Pending queue. Master list of "awaiting a decision":
//   - explicit defer (`status === 'deferred'`, any age)
//   - ended without a decision (`status === 'pending'` with
//     plannedEnd <= now, any age)
// Rows look identical apart from a left-side glyph. Actions:
// `Done` / `Archive` (in-place status writes) + `Drag to Cycle →`
// (jumps to Cycle View for re-scheduling). Bulk: archive items
// older than N days (default 7).

const STALE_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PendingRow {
  taskId: string;
  railId: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string;
  railName: string;
  railColor: RailColor;
  subtitle?: string;
  title: string; // task title (hand-built) / habit name (auto-task)
  /** Full Task reference — lets the row wire SchedulePopover + detail
   *  drawer without re-looking up the task each render. */
  task: Task;
  /** How the row got here:
   *  - `deferred`: user explicitly picked Later.
   *  - `unmarked`: window ended without a decision (any age). */
  source: 'deferred' | 'unmarked';
  tags: string[];
  ageDays: number;
}

export function Pending() {
  const railRevisions = useStore((s) => s.railRevisions);
  const railTombstones = useStore((s) => s.railTombstones);
  const tasks = useStore((s) => s.tasks);
  const taskOccurrences = useStore((s) => s.taskOccurrences);
  const lines = useStore((s) => s.lines);
  const shifts = useStore((s) => s.shifts);
  const updateTask = useStore((s) => s.updateTask);

  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  // Keyboard navigation cursor (Pending page · ROADMAP 停车场 ·
  // 键盘快捷键扩展). Tracked by taskId rather than index so rows
  // shifting (after archive/complete) don't move the cursor off the
  // intended row. Auto-selects the first row when rows change and
  // cursor is unset / stale.
  const [cursorTaskId, setCursorTaskId] = useState<string | null>(null);
  const cursorRowRef = useRef<HTMLDivElement | null>(null);
  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'pending-queue',
  );

  const rows = useMemo<PendingRow[]>(() => {
    const now = new Date();
    return selectPendingQueue(
      { tasks, taskOccurrences, railRevisions, railTombstones },
      now,
    ).map((r) => adaptRow(r, shifts, now));
  }, [tasks, taskOccurrences, railRevisions, railTombstones, shifts]);

  const summary = useMemo(
    () => ({
      total: rows.length,
      eligible: rows.filter((r) => r.ageDays > STALE_THRESHOLD_DAYS).length,
      // selectPendingQueue sorts by plannedStart asc, so the first row
      // is the oldest.
      oldest: rows[0]?.date,
    }),
    [rows],
  );

  const groups = useMemo(() => groupByDate(rows), [rows]);

  const handleComplete = useCallback(
    (row: PendingRow) => {
      fire({
        taskId: row.taskId,
        railId: row.railId,
        displayName: row.railName,
        action: 'done',
      });
    },
    [fire],
  );

  const handleArchive = useCallback(
    (row: PendingRow) => {
      fire({
        taskId: row.taskId,
        railId: row.railId,
        displayName: row.railName,
        action: 'archive',
      });
    },
    [fire],
  );

  const handleOpenDetail = useCallback((row: PendingRow) => {
    setDetailTaskId(row.taskId);
  }, []);

  // Keep cursor pointing at a row that still exists. If the focused
  // row was just completed / archived / disappeared, snap to the
  // next-nearest row (prefer the row that took its index slot).
  useEffect(() => {
    if (rows.length === 0) {
      if (cursorTaskId !== null) setCursorTaskId(null);
      return;
    }
    if (cursorTaskId === null) {
      setCursorTaskId(rows[0]!.taskId);
      return;
    }
    const stillExists = rows.some((r) => r.taskId === cursorTaskId);
    if (!stillExists) {
      // Best-effort: pick row 0 (oldest) when our row disappeared.
      // Could try to preserve index, but the row order can shift
      // unpredictably after a write, so "back to top" is safer.
      setCursorTaskId(rows[0]!.taskId);
    }
  }, [rows, cursorTaskId]);

  // Auto-scroll focused row into view (smooth, nearest). Fires when
  // cursor moves or row layout shifts.
  useEffect(() => {
    cursorRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursorTaskId]);

  // Page-local shortcuts (ROADMAP 停车场 · 键盘快捷键扩展):
  //   j / k · move cursor down / up
  //   d     · mark current row done (via the same reason-toast path
  //           as clicking the 完成 chip)
  //   .     · open the task detail drawer for the current row
  //   x     · archive (extra · also useful for the eligible-old rows)
  // Bare keys (not bigraph) — won't collide with global `g <key>`
  // navigation because the leader hasn't been pressed. Ignored when
  // a typing target has focus (matches keyboardShortcuts.ts).
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      // Don't fire while a modal sits in front (detail drawer / dialog).
      if (detailTaskId !== null) return;
      if (rows.length === 0) return;
      const idx = cursorTaskId
        ? rows.findIndex((r) => r.taskId === cursorTaskId)
        : -1;
      const key = e.key.toLowerCase();
      if (key === 'j') {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1);
        setCursorTaskId(rows[next]!.taskId);
      } else if (key === 'k') {
        e.preventDefault();
        const next = idx <= 0 ? 0 : idx - 1;
        setCursorTaskId(rows[next]!.taskId);
      } else if (key === 'd') {
        if (idx < 0) return;
        e.preventDefault();
        handleComplete(rows[idx]!);
      } else if (key === 'x') {
        if (idx < 0) return;
        e.preventDefault();
        handleArchive(rows[idx]!);
      } else if (key === '.') {
        if (idx < 0) return;
        e.preventDefault();
        handleOpenDetail(rows[idx]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    rows,
    cursorTaskId,
    detailTaskId,
    handleComplete,
    handleArchive,
    handleOpenDetail,
  ]);

  const handleBulkArchive = useCallback(() => {
    if (summary.eligible === 0) return;
    const msg = `归档超过 ${STALE_THRESHOLD_DAYS} 天仍未决定的 ${summary.eligible} 条事项？\n它们在历史里仍可检索，但不再出现在此队列。`;
    if (!window.confirm(msg)) return;
    const nowIso = new Date().toISOString();
    for (const row of rows) {
      if (row.ageDays > STALE_THRESHOLD_DAYS) {
        void updateTask(row.taskId, { status: 'archived', archivedAt: nowIso });
      }
    }
  }, [rows, summary.eligible, updateTask]);

  return (
    <div className="flex w-full max-w-[920px] flex-col gap-6 py-10 pl-10 pr-10 lg:pl-14 xl:pl-20">
      <TopBar
        total={summary.total}
        eligible={summary.eligible}
        oldest={summary.oldest}
        onBulkArchive={handleBulkArchive}
      />

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="flex flex-col gap-8">
          {groups.map((g) => (
            <DateGroup
              key={g.date}
              date={g.date}
              relative={g.relative}
              weekdayShort={g.weekdayShort}
              dayLabel={g.dayLabel}
              items={g.items}
              focusedTaskId={cursorTaskId}
              focusedRowRef={cursorRowRef}
              onComplete={handleComplete}
              onArchive={handleArchive}
              onOpenDetail={handleOpenDetail}
            />
          ))}
        </section>
      )}

      <Footnote />
      <ReasonToast
        state={toast}
        onAddTag={handleAddTag}
        onUndo={handleUndo}
        onClose={handleClose}
      />

      {detailTaskId && tasks[detailTaskId] && (
        <TaskDetailDrawer
          task={tasks[detailTaskId]!}
          line={lines[tasks[detailTaskId]!.lineId]}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Adapter + grouping.
// ------------------------------------------------------------------

function adaptRow(
  row: CarriedTaskRow,
  shifts: Record<string, Shift>,
  now: Date,
): PendingRow {
  // Slot-less rows: fall back to the task's deferredAt for grouping /
  // ageing. No planned window → start/end/railName/railColor get
  // placeholder display values.
  const anchorIso =
    row.plannedStart ??
    row.task.slot?.date ??
    row.task.deferredAt ??
    row.task.archivedAt ??
    new Date().toISOString();
  const startMs = Date.parse(anchorIso);
  const ageDays = Number.isNaN(startMs)
    ? 0
    : Math.max(0, Math.floor((now.getTime() - startMs) / MS_PER_DAY));
  if (row.rail && row.plannedStart && row.plannedEnd) {
    return {
      taskId: row.task.id,
      railId: row.rail.id,
      date: row.task.slot?.date ?? '',
      start: row.plannedStart.slice(11, 16) || '00:00',
      end: row.plannedEnd.slice(11, 16) || '00:00',
      railName: row.rail.name,
      railColor: row.rail.color as RailColor,
      ...(row.rail.subtitle && { subtitle: row.rail.subtitle }),
      title: row.task.title,
      task: row.task,
      source: row.task.status === 'deferred' ? 'deferred' : 'unmarked',
      tags: latestTagsForTask(row.task.id, shifts),
      ageDays,
    };
  }
  // Slot-less deferred task (e.g. Inbox item user pushed to later).
  return {
    taskId: row.task.id,
    railId: '',
    date: (row.task.deferredAt ?? '').slice(0, 10),
    start: '—',
    end: '—',
    railName: '未排期',
    railColor: 'slate' as RailColor,
    title: row.task.title,
    task: row.task,
    source: 'deferred',
    tags: latestTagsForTask(row.task.id, shifts),
    ageDays,
  };
}

interface Group {
  date: string;
  relative: string;
  weekdayShort: string;
  dayLabel: string;
  items: PendingRow[];
}

function groupByDate(rows: PendingRow[]): Group[] {
  const map = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const list = map.get(row.date);
    if (list) list.push(row);
    else map.set(row.date, [row]);
  }
  const today = toIsoLocalDate(new Date());
  const yesterday = toIsoLocalDate(new Date(Date.now() - MS_PER_DAY));
  const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
  const dayFmt = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
  });
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => {
      const d = new Date(`${date}T00:00:00`);
      const relative =
        date === today ? '今天' : date === yesterday ? '昨天' : daysAgoLabel(d);
      return {
        date,
        relative,
        weekdayShort: weekdayFmt.format(d),
        dayLabel: dayFmt.format(d),
        items: items.sort((a, b) => a.start.localeCompare(b.start)),
      };
    });
}

function toIsoLocalDate(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function daysAgoLabel(d: Date): string {
  const diffDays = Math.floor((Date.now() - d.getTime()) / MS_PER_DAY);
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  return `${Math.floor(diffDays / 30)} 月前`;
}

// ------------------------------------------------------------------
// Presentational pieces.
// ------------------------------------------------------------------

function TopBar({
  total,
  eligible,
  oldest,
  onBulkArchive,
}: {
  total: number;
  eligible: number;
  oldest: string | undefined;
  onBulkArchive: () => void;
}) {
  return (
    <header className="flex items-end justify-between gap-6 pt-2">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-xs uppercase tracking-widest text-ink-tertiary">
          Unresolved
        </span>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-medium text-ink-primary">待决定</h1>
          <span className="font-mono text-sm tabular-nums text-ink-secondary">
            {total} 条
          </span>
          {oldest && (
            <span className="font-mono text-xs tabular-nums text-ink-tertiary">
              · 最早 {oldest.slice(5)}
            </span>
          )}
        </div>
      </div>

      <BulkArchiveButton eligible={eligible} onClick={onBulkArchive} />
    </header>
  );
}

function BulkArchiveButton({
  eligible,
  onClick,
}: {
  eligible: number;
  onClick: () => void;
}) {
  const disabled = eligible === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`归档超过 ${STALE_THRESHOLD_DAYS} 天仍未决定的事项`}
      className={clsx(
        'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
        disabled
          ? 'cursor-not-allowed text-ink-tertiary/50'
          : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
      )}
    >
      <Archive className="h-3.5 w-3.5" strokeWidth={1.8} />
      <span>归档超过 {STALE_THRESHOLD_DAYS} 天的事项</span>
      {eligible > 0 && (
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          · {eligible} 条
        </span>
      )}
    </button>
  );
}

function DateGroup({
  date,
  relative,
  weekdayShort,
  dayLabel,
  items,
  focusedTaskId,
  focusedRowRef,
  onComplete,
  onArchive,
  onOpenDetail,
}: {
  date: string;
  relative: string;
  weekdayShort: string;
  dayLabel: string;
  items: PendingRow[];
  focusedTaskId: string | null;
  focusedRowRef: React.RefObject<HTMLDivElement>;
  onComplete: (row: PendingRow) => void;
  onArchive: (row: PendingRow) => void;
  onOpenDetail: (row: PendingRow) => void;
}) {
  return (
    <section aria-label={date} className="flex flex-col gap-2">
      <header className="flex items-baseline gap-3">
        <span className="font-mono text-sm tabular-nums text-ink-primary">
          {dayLabel}
        </span>
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-secondary">
          {weekdayShort}
        </span>
        <span className="text-xs text-ink-tertiary">· {relative}</span>
        <span className="text-xs text-ink-tertiary">· {items.length} 条</span>
      </header>
      <ul className="flex flex-col gap-1">
        {items.map((it) => {
          const isFocused = it.taskId === focusedTaskId;
          return (
            <li key={it.taskId}>
              <PendingItemRow
                row={it}
                eligible={it.ageDays > STALE_THRESHOLD_DAYS}
                focused={isFocused}
                {...(isFocused && { focusedRowRef })}
                onComplete={onComplete}
                onArchive={onArchive}
                onOpenDetail={onOpenDetail}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PendingItemRow({
  row,
  eligible,
  focused,
  focusedRowRef,
  onComplete,
  onArchive,
  onOpenDetail,
}: {
  row: PendingRow;
  eligible: boolean;
  focused: boolean;
  focusedRowRef?: React.RefObject<HTMLDivElement>;
  onComplete: (row: PendingRow) => void;
  onArchive: (row: PendingRow) => void;
  onOpenDetail: (row: PendingRow) => void;
}) {
  const strip = RAIL_COLOR_HEX[row.railColor];
  const SourceIcon = row.source === 'deferred' ? Clock : CircleDashed;
  const sourceTitle =
    row.source === 'deferred' ? '显式「以后再说」' : '结束时未标记';
  return (
    <div
      ref={focusedRowRef}
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(row)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetail(row);
        }
      }}
      className={clsx(
        'group flex cursor-pointer items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2',
        eligible && 'opacity-85',
        focused && 'ring-2 ring-cta/60 ring-offset-1 ring-offset-surface-0',
      )}
    >
      <span
        aria-hidden
        className="h-5 w-1 shrink-0 rounded-sm"
        style={{ background: strip }}
      />

      <SourceIcon
        className="h-3.5 w-3.5 shrink-0 text-ink-tertiary"
        strokeWidth={1.6}
        aria-label={sourceTitle}
      />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-tertiary">
          {row.start}–{row.end}
        </span>
        <span className="truncate text-sm text-ink-primary">{row.title}</span>
        {row.title !== row.railName && (
          <span className="truncate text-xs text-ink-tertiary">
            · {row.railName}
          </span>
        )}
        {row.tags.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {row.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-ink-tertiary"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
      </div>

      <div
        className="flex shrink-0 items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <ActionChip
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            onComplete(row);
          }}
        >
          完成
        </ActionChip>
        <ActionChip
          onClick={(e) => {
            e.stopPropagation();
            onArchive(row);
          }}
        >
          归档
        </ActionChip>
        <SchedulePopover task={row.task}>
          <ActionChip
            variant="ghost"
            onClick={(e) => {
              // SchedulePopover's PopoverTrigger consumes click; stop
              // propagation so the row's detail-drawer handler doesn't
              // also fire.
              e.stopPropagation();
            }}
          >
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" strokeWidth={1.8} />
              改期
            </span>
          </ActionChip>
        </SchedulePopover>
      </div>
    </div>
  );
}

/** Tiny pill button used by Pending row actions. Must be a forwardRef
 *  so that Radix's `asChild` (used by SchedulePopover's PopoverTrigger
 *  to wrap the 改期 chip) can attach its trigger ref + inject the
 *  aria-/data-state props the popover needs to anchor and toggle.
 *  Without this, the popover never appears and the chip looks
 *  un-clickable. */
const ActionChip = forwardRef<
  HTMLButtonElement,
  {
    children: React.ReactNode;
    variant?: 'default' | 'primary' | 'ghost';
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(({ children, variant = 'default', className, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    className={clsx(
      'rounded-sm px-2.5 py-1 text-xs font-medium transition',
      variant === 'primary' &&
        'bg-ink-primary text-surface-0 hover:bg-ink-secondary',
      variant === 'default' &&
        'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
      variant === 'ghost' && 'text-ink-tertiary hover:text-ink-secondary',
      className,
    )}
    {...rest}
  >
    {children}
  </button>
));
ActionChip.displayName = 'ActionChip';

function EmptyState() {
  return (
    <section className="flex min-h-[240px] flex-col items-start justify-center gap-2 rounded-md bg-surface-1 px-8 py-12">
      <Inbox className="h-6 w-6 text-ink-tertiary" strokeWidth={1.4} />
      <h2 className="text-lg font-medium text-ink-primary">队列为空</h2>
      <p className="text-sm text-ink-secondary">
        已结束但还没决定的 Rail —— 以及你显式点过「以后再说」的 ——
        都会汇总在这里，可以一次性处理。
      </p>
    </section>
  );
}

function Footnote() {
  return (
    <footer className="mt-4 flex justify-between font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>ERD §5.7 · 未决定项需由用户主动处理</span>
      <span>归档阈值：{STALE_THRESHOLD_DAYS} 天</span>
    </footer>
  );
}
