import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import {
  materializeAutoTasks,
  mondayOf,
  useStore,
  type Line,
  type Rail,
  type Task,
} from '@dayrail/core';
import { RAIL_COLOR_HEX, RAIL_COLOR_STEP_4, RAIL_COLOR_STEP_6, RAIL_COLOR_STEP_7 } from '@/components/railColors';
import type { RailColor } from '@/data/sample';

// ERD §5.5.0 v0.4 habit detail page.
//
// Layout:
//   ● <habit name>                     (header — outside this file)
//   ──────────────────────────────────
//   Rhythm (14-day mini heatmap)
//   Schedule (bound Rails list)
//   Phases (handled by the existing HabitPhasePanel, above the fold)
//   Notes (long-form text)
//   Danger zone
//
// A: read-only rhythm strip. Click-to-backfill (B) is a follow-up
// commit — this file keeps strip cells static for now.

const WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Props {
  habit: Line;
}

export function HabitDetail({ habit }: Props) {
  const rails = useStore((s) => s.rails);
  const templates = useStore((s) => s.templates);
  const tasks = useStore((s) => s.tasks);
  const updateLine = useStore((s) => s.updateLine);
  const navigate = useNavigate();

  // Materialise auto-tasks for the strip window on open — §10.2
  // trigger point "Habit 详情页节奏带打开". Materializer is idempotent
  // so re-running on every navigation is fine.
  const windowEnd = useMemo(() => todayIso(), []);
  const windowStart = useMemo(
    () => isoDatePlus(windowEnd, -(WINDOW_DAYS - 1)),
    [windowEnd],
  );
  useEffect(() => {
    void materializeAutoTasks({ startDate: windowStart, endDate: windowEnd });
    // Cycle View materialiser closes the Monday-anchored cycle when
    // the window fully covers it — here we also fire the adjacent
    // cycle so the current week / previous week both get marked.
    const monday = mondayOf(windowStart);
    const prevMonday = isoDatePlus(monday, -7);
    void materializeAutoTasks({
      startDate: prevMonday,
      endDate: isoDatePlus(prevMonday, 6),
    });
    void materializeAutoTasks({
      startDate: monday,
      endDate: isoDatePlus(monday, 6),
    });
  }, [windowStart, windowEnd]);

  const boundRails = useMemo<Rail[]>(
    () =>
      Object.values(rails)
        .filter((r) => r.defaultLineId === habit.id)
        .sort((a, b) => a.startMinutes - b.startMinutes),
    [rails, habit.id],
  );

  return (
    <div className="flex flex-col gap-8">
      <RhythmStrip
        habitId={habit.id}
        boundRails={boundRails}
        windowStart={windowStart}
        windowEnd={windowEnd}
        tasks={tasks}
        color={habit.color}
      />

      <ScheduleList
        boundRails={boundRails}
        templates={templates}
        onGoToTemplate={(templateKey) => navigate(`/templates/${templateKey}`)}
      />

      <NotesSection line={habit} onCommit={(note) => updateLine(habit.id, { note })} />

      <DangerSection line={habit} onArchive={() => navigate('/tasks/inbox')} />
    </div>
  );
}

// ------------------------------------------------------------------
// Rhythm strip (14-day).
// ------------------------------------------------------------------

type CellState = 'done' | 'deferred' | 'archived' | 'pending' | 'empty';

function RhythmStrip({
  habitId,
  boundRails,
  windowStart,
  windowEnd,
  tasks,
  color,
}: {
  habitId: string;
  boundRails: Rail[];
  windowStart: string;
  windowEnd: string;
  tasks: Record<string, Task>;
  color?: RailColor;
}) {
  const dates = useMemo(() => {
    const out: string[] = [];
    for (let t = 0; t < WINDOW_DAYS; t++) {
      out.push(isoDatePlus(windowStart, t));
    }
    return out;
  }, [windowStart]);

  // Index auto-tasks by date. Habit has 1+ bound rails, so a single
  // date may have 1+ occurrences. We reduce to one cell per date:
  // worst-status wins (deferred > archived > pending > done > empty).
  const cellByDate = useMemo<Record<string, CellState>>(() => {
    const byDate: Record<string, CellState> = {};
    for (const d of dates) byDate[d] = 'empty';
    for (const t of Object.values(tasks)) {
      if (!t.slot) continue;
      if (t.lineId !== habitId) continue;
      const d = t.slot.date;
      if (d < windowStart || d > windowEnd) continue;
      byDate[d] = reduceCell(byDate[d]!, t.status);
    }
    return byDate;
  }, [dates, tasks, habitId, windowStart, windowEnd]);

  const accent: RailColor = (color ?? boundRails[0]?.color ?? 'slate') as RailColor;

  return (
    <section aria-label="Habit rhythm" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Rhythm
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          最近 {WINDOW_DAYS} 天
        </span>
      </header>
      <div className="flex items-end gap-1">
        {dates.map((d) => (
          <div
            key={d}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${d} · ${STATE_LABEL[cellByDate[d]!]}`}
          >
            <span
              aria-hidden
              className={clsx(
                'h-8 w-full rounded-sm transition',
                cellByDate[d] === 'empty' && 'bg-surface-2',
              )}
              style={styleFor(cellByDate[d]!, accent)}
            />
            <span
              className={clsx(
                'font-mono text-2xs tabular-nums',
                d === windowEnd ? 'text-ink-primary' : 'text-ink-tertiary',
              )}
            >
              {d.slice(5)}
            </span>
          </div>
        ))}
      </div>
      <Legend />
    </section>
  );
}

const STATE_LABEL: Record<CellState, string> = {
  done: '完成',
  deferred: '以后再说',
  archived: '跳过',
  pending: '未标记',
  empty: '不参与',
};

function reduceCell(prev: CellState, status: Task['status']): CellState {
  // Rank: lower wins (deferred flags a day as "problem"; done is best).
  const rank: Record<CellState, number> = {
    deferred: 0,
    archived: 1,
    pending: 2,
    done: 3,
    empty: 4,
  };
  let next: CellState;
  if (status === 'done') next = 'done';
  else if (status === 'deferred') next = 'deferred';
  else if (status === 'archived') next = 'archived';
  else if (status === 'pending') next = 'pending';
  else return prev;
  return rank[next] < rank[prev] ? next : prev;
}

function styleFor(state: CellState, color: RailColor): React.CSSProperties | undefined {
  if (state === 'done') return { background: RAIL_COLOR_HEX[color] };
  if (state === 'archived')
    return {
      background: 'var(--surface-1, #F9F9F8)',
      backgroundImage: `repeating-linear-gradient(-45deg, ${RAIL_COLOR_STEP_6[color]} 0 1.5px, transparent 1.5px 6px)`,
    };
  if (state === 'deferred')
    return {
      background: 'var(--surface-1, #F9F9F8)',
      backgroundImage: `repeating-linear-gradient(-45deg, ${RAIL_COLOR_STEP_7[color]} 0 1.5px, transparent 1.5px 6px)`,
    };
  if (state === 'pending') return { background: RAIL_COLOR_STEP_4[color] };
  return undefined;
}

function Legend() {
  return (
    <div className="flex items-center gap-3 font-mono text-2xs text-ink-tertiary">
      <LegendSwatch label="完成" className="bg-ink-primary/70" />
      <LegendSwatch label="以后再说" hatched tone="warn" />
      <LegendSwatch label="跳过" hatched tone="skip" />
      <LegendSwatch label="未标记" className="bg-surface-3" />
      <LegendSwatch label="不参与" className="bg-surface-2" />
    </div>
  );
}

function LegendSwatch({
  label,
  className,
  hatched,
  tone,
}: {
  label: string;
  className?: string;
  hatched?: boolean;
  tone?: 'warn' | 'skip';
}) {
  const hatchColor = tone === 'warn' ? '#d4a24c88' : '#9ca39c88';
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={clsx('block h-2.5 w-2.5 rounded-sm', className)}
        style={
          hatched
            ? {
                background: 'var(--surface-1, #F9F9F8)',
                backgroundImage: `repeating-linear-gradient(-45deg, ${hatchColor} 0 1.5px, transparent 1.5px 4px)`,
              }
            : undefined
        }
      />
      {label}
    </span>
  );
}

// ------------------------------------------------------------------
// Schedule list — bound Rails.
// ------------------------------------------------------------------

function ScheduleList({
  boundRails,
  templates,
  onGoToTemplate,
}: {
  boundRails: Rail[];
  templates: Record<string, { key: string; name: string; color?: string }>;
  onGoToTemplate: (templateKey: string) => void;
}) {
  return (
    <section aria-label="Habit schedule" className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Schedule
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {boundRails.length} 条节奏
        </span>
      </header>
      {boundRails.length === 0 ? (
        <p className="rounded-md bg-surface-1 px-3 py-2.5 text-xs text-ink-tertiary">
          还没有绑定任何 Rail。去
          <button
            type="button"
            onClick={() => onGoToTemplate('workday')}
            className="mx-1 underline decoration-dotted underline-offset-2 hover:text-ink-secondary"
          >
            Template Editor
          </button>
          建一条时间带,在它的 `⋯` 菜单里把 default Line 绑到这个 habit。
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {boundRails.map((rail) => (
            <ScheduleRow
              key={rail.id}
              rail={rail}
              templateName={templates[rail.templateKey]?.name ?? rail.templateKey}
              onGoToTemplate={() => onGoToTemplate(rail.templateKey)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleRow({
  rail,
  templateName,
  onGoToTemplate,
}: {
  rail: Rail;
  templateName: string;
  onGoToTemplate: () => void;
}) {
  const start = formatMinutes(rail.startMinutes);
  const end = formatMinutes(rail.startMinutes + rail.durationMinutes);
  return (
    <li className="group flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2">
      <span
        aria-hidden
        className="h-5 w-[3px] shrink-0 rounded-sm"
        style={{ background: RAIL_COLOR_HEX[rail.color as RailColor] }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-ink-primary">{rail.name}</span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {start}–{end} · {recurrenceLabel(rail.recurrence)} · {templateName}
        </span>
      </div>
      <button
        type="button"
        onClick={onGoToTemplate}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
      >
        编辑
        <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </li>
  );
}

function recurrenceLabel(r: Rail['recurrence']): string {
  switch (r.kind) {
    case 'daily':
      return '每天';
    case 'weekdays':
      return '工作日';
    case 'custom': {
      const names = ['日', '一', '二', '三', '四', '五', '六'];
      return r.weekdays.map((w) => `周${names[w]}`).join(' / ') || '—';
    }
  }
}

// ------------------------------------------------------------------
// Notes.
// ------------------------------------------------------------------

function NotesSection({
  line,
  onCommit,
}: {
  line: Line;
  onCommit: (note: string) => void;
}) {
  const [draft, setDraft] = useState(line.note ?? '');
  useEffect(() => {
    setDraft(line.note ?? '');
  }, [line.id, line.note]);

  const commit = useCallback(() => {
    const trimmed = draft;
    if (trimmed === (line.note ?? '')) return;
    onCommit(trimmed);
  }, [draft, line.note, onCommit]);

  return (
    <section aria-label="Habit notes" className="flex flex-col gap-2">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Notes
      </span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder="写一些动机、目标或要记住的上下文…(失焦自动保存)"
        rows={4}
        className="resize-y rounded-md border border-hairline/60 bg-surface-0 px-3 py-2 text-sm leading-relaxed text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
      />
    </section>
  );
}

// ------------------------------------------------------------------
// Danger zone.
// ------------------------------------------------------------------

function DangerSection({
  line,
  onArchive,
}: {
  line: Line;
  onArchive: () => void;
}) {
  const updateLine = useStore((s) => s.updateLine);
  const deleteLine = useStore((s) => s.deleteLine);
  const handleArchive = useCallback(() => {
    const msg = `归档「${line.name}」?归档后不在主列表显示;随时可从"已归档"恢复。`;
    if (!window.confirm(msg)) return;
    void updateLine(line.id, {
      status: 'archived',
      archivedAt: Date.now(),
    });
    onArchive();
  }, [line, updateLine, onArchive]);
  const handleDelete = useCallback(() => {
    const msg = `把「${line.name}」移到回收站?关联的 auto-task 历史会保留在事件日志里,但列表不再显示。`;
    if (!window.confirm(msg)) return;
    void deleteLine(line.id);
    onArchive();
  }, [line, deleteLine, onArchive]);
  return (
    <section
      aria-label="Habit danger zone"
      className="flex flex-col gap-2 pt-2"
    >
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Danger
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleArchive}
          className="inline-flex items-center gap-1.5 rounded-md bg-surface-1 px-3 py-1.5 text-xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Archive className="h-3.5 w-3.5" strokeWidth={1.8} />
          归档此 habit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-warn"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          移到回收站
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------
// Helpers.
// ------------------------------------------------------------------

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoDatePlus(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// keep the Plus import alive for the eventual "add phase" follow-up
// button — reserved for v0.4 Stage 5 B (click-to-backfill).
void Plus;
