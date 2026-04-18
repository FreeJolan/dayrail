import { useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowRight, CircleDashed, Clock, Inbox } from 'lucide-react';
import {
  selectPendingQueue,
  useStore,
  type CarriedTaskRow,
  type Shift,
} from '@dayrail/core';
import { RAIL_COLOR_HEX } from '@/components/railColors';
import { ReasonToast } from '@/components/ReasonToast';
import {
  latestTagsForTask,
  useReasonToast,
} from '@/components/useReasonToast';
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
  /** How the row got here:
   *  - `deferred`: user explicitly picked Later.
   *  - `unmarked`: window ended without a decision (any age). */
  source: 'deferred' | 'unmarked';
  tags: string[];
  ageDays: number;
}

export function Pending() {
  const rails = useStore((s) => s.rails);
  const tasks = useStore((s) => s.tasks);
  const shifts = useStore((s) => s.shifts);
  const updateTask = useStore((s) => s.updateTask);

  const navigate = useNavigate();
  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'pending-queue',
  );

  const rows = useMemo<PendingRow[]>(() => {
    const now = new Date();
    return selectPendingQueue({ tasks, rails }, now).map(
      (r) => adaptRow(r, shifts, now),
    );
  }, [tasks, rails, shifts]);

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

  const handleReschedule = useCallback(
    (_row: PendingRow) => {
      // Drag-to-re-schedule inside Cycle View is still pending; for now
      // we hop over so the user can at least eyeball the week and pick
      // a day by hand.
      navigate('/cycle');
    },
    [navigate],
  );

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
              onComplete={handleComplete}
              onArchive={handleArchive}
              onReschedule={handleReschedule}
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
  onComplete,
  onArchive,
  onReschedule,
}: {
  date: string;
  relative: string;
  weekdayShort: string;
  dayLabel: string;
  items: PendingRow[];
  onComplete: (row: PendingRow) => void;
  onArchive: (row: PendingRow) => void;
  onReschedule: (row: PendingRow) => void;
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
        {items.map((it) => (
          <li key={it.taskId}>
            <PendingItemRow
              row={it}
              eligible={it.ageDays > STALE_THRESHOLD_DAYS}
              onComplete={onComplete}
              onArchive={onArchive}
              onReschedule={onReschedule}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PendingItemRow({
  row,
  eligible,
  onComplete,
  onArchive,
  onReschedule,
}: {
  row: PendingRow;
  eligible: boolean;
  onComplete: (row: PendingRow) => void;
  onArchive: (row: PendingRow) => void;
  onReschedule: (row: PendingRow) => void;
}) {
  const strip = RAIL_COLOR_HEX[row.railColor];
  const SourceIcon = row.source === 'deferred' ? Clock : CircleDashed;
  const sourceTitle =
    row.source === 'deferred' ? '显式「以后再说」' : '结束时未标记';
  return (
    <div
      className={clsx(
        'group flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2',
        eligible && 'opacity-85',
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

      <div className="flex shrink-0 items-center gap-1">
        <ActionChip variant="primary" onClick={() => onComplete(row)}>
          完成
        </ActionChip>
        <ActionChip onClick={() => onArchive(row)}>归档</ActionChip>
        <ActionChip variant="ghost" onClick={() => onReschedule(row)}>
          <span className="inline-flex items-center gap-1">
            拖到 Cycle
            <ArrowRight className="h-3 w-3" strokeWidth={1.8} />
          </span>
        </ActionChip>
      </div>
    </div>
  );
}

function ActionChip({
  children,
  variant = 'default',
  onClick,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'ghost';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-sm px-2.5 py-1 text-xs font-medium transition',
        variant === 'primary' &&
          'bg-ink-primary text-surface-0 hover:bg-ink-secondary',
        variant === 'default' &&
          'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
        variant === 'ghost' && 'text-ink-tertiary hover:text-ink-secondary',
      )}
    >
      {children}
    </button>
  );
}

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
