import { useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import { Archive, ArrowRight, CircleDashed, Clock, Inbox } from 'lucide-react';
import {
  selectPendingQueue,
  useStore,
  type Rail,
  type RailInstance,
  type Shift,
} from '@dayrail/core';
import { RAIL_COLOR_HEX } from '@/components/railColors';
import { ReasonToast } from '@/components/ReasonToast';
import { useReasonToast } from '@/components/useReasonToast';
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
  instanceId: string;
  date: string; // YYYY-MM-DD (from plannedStart)
  start: string; // HH:MM
  end: string;
  railName: string;
  railColor: RailColor;
  subtitle?: string;
  /** How the row got here:
   *  - `deferred`: user explicitly picked Later.
   *  - `unmarked`: rail ended without a decision (any age, not just >24h). */
  source: 'deferred' | 'unmarked';
  tags: string[];
  ageDays: number;
}

export function Pending() {
  const rails = useStore((s) => s.rails);
  const railInstances = useStore((s) => s.railInstances);
  const shifts = useStore((s) => s.shifts);
  const markRailInstance = useStore((s) => s.markRailInstance);

  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'pending-queue',
  );

  const rows = useMemo<PendingRow[]>(() => {
    const now = new Date();
    return selectPendingQueue({ railInstances }, now)
      .map((inst) => adaptRow(inst, rails[inst.railId], shifts, now))
      .filter((r): r is PendingRow => r !== null);
  }, [rails, railInstances, shifts]);

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
    (id: string) => {
      fire(id, 'done');
    },
    [fire],
  );

  const handleArchive = useCallback(
    (id: string) => {
      fire(id, 'archive');
    },
    [fire],
  );

  const handleReschedule = useCallback((_id: string) => {
    // v0.3 lands drag-to-re-schedule inside Cycle View; v0.2 just tells
    // the user where to go.
    window.alert('v0.3 接入 Cycle View 拖拽；v0.2 先用 Today 视图里「以后再说」区的「取消」把它放回今天 pending。');
  }, []);

  const handleBulkArchive = useCallback(() => {
    if (summary.eligible === 0) return;
    const msg = `归档超过 ${STALE_THRESHOLD_DAYS} 天仍未决定的 ${summary.eligible} 条事项？\n它们在历史里仍可检索，但不再出现在此队列。`;
    if (!window.confirm(msg)) return;
    for (const row of rows) {
      if (row.ageDays > STALE_THRESHOLD_DAYS) {
        void markRailInstance(row.instanceId, 'archived');
      }
    }
  }, [rows, summary.eligible, markRailInstance]);

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
  inst: RailInstance,
  rail: Rail | undefined,
  shifts: Record<string, Shift>,
  now: Date,
): PendingRow | null {
  if (!rail) return null;
  const startMs = Date.parse(inst.plannedStart);
  if (Number.isNaN(startMs)) return null;
  const ageDays = Math.max(0, Math.floor((now.getTime() - startMs) / MS_PER_DAY));
  return {
    instanceId: inst.id,
    date: inst.date,
    start: inst.plannedStart.slice(11, 16) || '00:00',
    end: inst.plannedEnd.slice(11, 16) || '00:00',
    railName: rail.name,
    railColor: rail.color as RailColor,
    subtitle: rail.subtitle,
    source: inst.status === 'deferred' ? 'deferred' : 'unmarked',
    tags: tagsForInstance(inst.id, shifts),
    ageDays,
  };
}

function tagsForInstance(
  instanceId: string,
  shifts: Record<string, Shift>,
): string[] {
  let latest: Shift | undefined;
  for (const shift of Object.values(shifts)) {
    if (shift.railInstanceId !== instanceId) continue;
    if (!latest || shift.at > latest.at) latest = shift;
  }
  return latest?.tags ?? [];
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
      title={`归档超过 ${STALE_THRESHOLD_DAYS} 天仍未决定的事项（阈值可在 设置 → 高级 调整）`}
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
  onComplete: (id: string) => void;
  onArchive: (id: string) => void;
  onReschedule: (id: string) => void;
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
          <li key={it.instanceId}>
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
  onComplete: (id: string) => void;
  onArchive: (id: string) => void;
  onReschedule: (id: string) => void;
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
        <span className="truncate text-sm text-ink-primary">
          {row.railName}
        </span>
        {row.subtitle && (
          <span className="truncate text-sm text-ink-tertiary">
            · {row.subtitle}
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
        <ActionChip variant="primary" onClick={() => onComplete(row.instanceId)}>
          完成
        </ActionChip>
        <ActionChip onClick={() => onArchive(row.instanceId)}>归档</ActionChip>
        <ActionChip variant="ghost" onClick={() => onReschedule(row.instanceId)}>
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
      <span>
        归档阈值：{STALE_THRESHOLD_DAYS} 天 · 设置 → 高级 可调
      </span>
    </footer>
  );
}
