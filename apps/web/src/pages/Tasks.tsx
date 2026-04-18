import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Archive,
  ArchiveRestore,
  Calendar as CalendarIcon,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  Inbox,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  INBOX_LINE_ID,
  useStore,
  type Line,
  type Task,
} from '@dayrail/core';
import { RAIL_COLOR_HEX } from '@/components/railColors';
import { Tooltip } from '@/components/primitives/Tooltip';
import { SchedulePopover } from '@/components/SchedulePopover';

// ERD §5.5 Tasks view. Chunk E = list + filters + search + task CRUD.
// Scheduling popover (Chunk F) + Trash hard-delete UX (Chunk G) ship
// in subsequent commits. Task rows carry a "Schedule…" action that
// alerts "coming next" until Chunk F.

type Selection =
  | { kind: 'inbox' }
  | { kind: 'line'; lineId: string }
  | { kind: 'archived' }
  | { kind: 'trash' };

/** Map the current URL to a Selection. `/tasks/inbox` / `.../archived` /
 *  `.../trash` are static; `/tasks/line/:lineId` takes the route param. */
function selectionFromLocation(
  pathname: string,
  lineId: string | undefined,
): Selection {
  if (pathname.startsWith('/tasks/line/') && lineId) {
    return { kind: 'line', lineId };
  }
  if (pathname === '/tasks/archived') return { kind: 'archived' };
  if (pathname === '/tasks/trash') return { kind: 'trash' };
  return { kind: 'inbox' };
}

function pathForSelection(s: Selection): string {
  switch (s.kind) {
    case 'inbox':
      return '/tasks/inbox';
    case 'line':
      return `/tasks/line/${s.lineId}`;
    case 'archived':
      return '/tasks/archived';
    case 'trash':
      return '/tasks/trash';
  }
}

export function Tasks() {
  const location = useLocation();
  const navigate = useNavigate();
  const { lineId } = useParams<{ lineId?: string }>();
  const selection = useMemo(
    () => selectionFromLocation(location.pathname, lineId),
    [location.pathname, lineId],
  );
  const setSelection = useCallback(
    (next: Selection) => navigate(pathForSelection(next)),
    [navigate],
  );
  // Subscribe to the raw map, not a selector that sorts/filters — Zustand
  // shallow-compares output, and `Object.values(...).sort()` returns a
  // fresh array every render → infinite loop.
  const linesMap = useStore((s) => s.lines);
  const createLine = useStore((s) => s.createLine);
  const inbox = linesMap[INBOX_LINE_ID];
  const projects = useMemo(
    () =>
      Object.values(linesMap)
        .filter((l) => l.kind === 'project' && l.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt),
    [linesMap],
  );
  const otherProjects = useMemo(
    () => projects.filter((l) => l.id !== INBOX_LINE_ID),
    [projects],
  );

  const handleCreateProject = useCallback(() => {
    // Minimal creation UX for chunk E — a full popover with color /
    // planned-end pickers can land later; a name is all the store
    // strictly needs.
    const raw = window.prompt('新建 Project · 输入名称');
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return;
    const id = freshId('line');
    void createLine({
      id,
      name,
      kind: 'project',
      status: 'active',
      createdAt: Date.now(),
    });
    setSelection({ kind: 'line', lineId: id });
  }, [createLine, setSelection]);

  return (
    <div className="flex min-h-screen w-full">
      <NavTree
        selection={selection}
        onSelect={setSelection}
        inbox={inbox}
        projects={otherProjects}
        onCreateProject={handleCreateProject}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <MainPanel selection={selection} inbox={inbox} projects={projects} />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------
// Left nav tree.
// ------------------------------------------------------------------

function NavTree({
  selection,
  onSelect,
  inbox,
  projects,
  onCreateProject,
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  inbox: Line | undefined;
  projects: Line[];
  onCreateProject: () => void;
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-[256px] shrink-0 flex-col border-r border-hairline/40 bg-surface-0 px-3 py-6">
      <header className="px-3 pb-4">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Tasks
        </span>
        <h1 className="mt-1 text-lg font-medium text-ink-primary">任务</h1>
      </header>

      {inbox && (
        <NavRow
          icon={<Inbox className="h-4 w-4" strokeWidth={1.6} />}
          label={inbox.name}
          active={selection.kind === 'inbox'}
          onClick={() => onSelect({ kind: 'inbox' })}
        />
      )}

      <NavGroup label="Projects" actionLabel="+ 新建" onAction={onCreateProject}>
        {projects.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-ink-tertiary">
            还没有 Project
          </p>
        ) : (
          projects.map((line) => (
            <NavRow
              key={line.id}
              icon={<ColorDot color={line.color} />}
              label={line.name}
              active={selection.kind === 'line' && selection.lineId === line.id}
              onClick={() => onSelect({ kind: 'line', lineId: line.id })}
            />
          ))
        )}
      </NavGroup>

      <NavGroup label="Habits">
        <p className="px-3 py-1.5 text-xs text-ink-tertiary">v0.4</p>
      </NavGroup>

      <div className="mt-auto flex flex-col gap-0.5">
        <NavRow
          icon={<Archive className="h-4 w-4" strokeWidth={1.6} />}
          label="已归档"
          active={selection.kind === 'archived'}
          onClick={() => onSelect({ kind: 'archived' })}
          dim
        />
        <NavRow
          icon={<Trash2 className="h-4 w-4" strokeWidth={1.6} />}
          label="回收站"
          active={selection.kind === 'trash'}
          onClick={() => onSelect({ kind: 'trash' })}
          dim
        />
      </div>
    </aside>
  );
}

function NavGroup({
  label,
  actionLabel,
  onAction,
  children,
}: {
  label: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between px-3 pb-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {label}
        </span>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:text-ink-primary"
          >
            <Plus className="h-2.5 w-2.5" strokeWidth={1.8} />
            {actionLabel.replace(/^\+\s*/, '')}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function NavRow({
  icon,
  label,
  active,
  onClick,
  dim = false,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  dim?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-8 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition',
        active
          ? 'bg-surface-2 text-ink-primary'
          : dim
            ? 'text-ink-tertiary hover:bg-surface-1 hover:text-ink-secondary'
            : 'text-ink-secondary hover:bg-surface-1 hover:text-ink-primary',
      )}
    >
      <span className="shrink-0 text-ink-tertiary">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function ColorDot({ color }: { color?: Line['color'] }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{
        background: color ? RAIL_COLOR_HEX[color] : 'rgba(0,0,0,0.2)',
      }}
    />
  );
}

// ------------------------------------------------------------------
// Main panel: header · new-task input · filter bar · task list.
// ------------------------------------------------------------------

type ScheduleFilter =
  | 'any'
  | 'scheduled'
  | 'unscheduled'
  | 'today'
  | 'thisWeek'
  | 'overdue';

const SCHEDULE_FILTER_KEYS: ScheduleFilter[] = [
  'any',
  'scheduled',
  'unscheduled',
  'today',
  'thisWeek',
  'overdue',
];

function isScheduleFilter(v: string | null): v is ScheduleFilter {
  return !!v && (SCHEDULE_FILTER_KEYS as string[]).includes(v);
}

interface Filters {
  search: string;
  schedule: ScheduleFilter;
  /** Multi-select line-id narrow. Empty set = "no line filter applied"
   *  (show everything in scope). Only surfaces in cross-Project views
   *  (Archived / Trash) where single-line nav-tree picking doesn't
   *  cover the ask. */
  lineIds: Set<string>;
}

function parseLineIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function stringifyLineIds(ids: Set<string>): string {
  return [...ids].sort().join(',');
}

function MainPanel({
  selection,
  inbox,
  projects,
}: {
  selection: Selection;
  inbox: Line | undefined;
  projects: Line[];
}) {
  // Filters in URL (`?q=...&schedule=...`) so bookmarking /
  // sharing a filtered view works. Empty / default values are
  // stripped — clean URL for the common case.
  const [searchParams, setSearchParams] = useSearchParams();
  const scheduleParam = searchParams.get('schedule');
  const lineIdsParam = searchParams.get('lines');
  const filters: Filters = useMemo(
    () => ({
      search: searchParams.get('q') ?? '',
      schedule: isScheduleFilter(scheduleParam) ? scheduleParam : 'any',
      lineIds: parseLineIds(lineIdsParam),
    }),
    [searchParams, scheduleParam, lineIdsParam],
  );
  const setFilters = useCallback(
    (next: Filters) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (next.search) n.set('q', next.search);
          else n.delete('q');
          if (next.schedule !== 'any') n.set('schedule', next.schedule);
          else n.delete('schedule');
          const joined = stringifyLineIds(next.lineIds);
          if (joined) n.set('lines', joined);
          else n.delete('lines');
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const tasksMap = useStore((s) => s.tasks);
  const adhocEventsMap = useStore((s) => s.adhocEvents);
  const linesMap = useStore((s) => s.lines);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const archiveTask = useStore((s) => s.archiveTask);
  const restoreTask = useStore((s) => s.restoreTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const purgeTask = useStore((s) => s.purgeTask);

  // Narrow the tasks map to what this selection cares about, before
  // the search/status filters run. Filtering by selection first keeps
  // the filter chips' semantics ("within this context") crisp.
  const tasksInScope = useMemo(() => {
    const all = Object.values(tasksMap);
    switch (selection.kind) {
      case 'inbox':
        return all.filter(
          (t) =>
            t.lineId === INBOX_LINE_ID &&
            t.status !== 'archived' &&
            t.status !== 'deleted',
        );
      case 'line': {
        const id = selection.lineId;
        return all.filter(
          (t) =>
            t.lineId === id &&
            t.status !== 'archived' &&
            t.status !== 'deleted',
        );
      }
      case 'archived':
        return all.filter((t) => t.status === 'archived');
      case 'trash':
        return all.filter((t) => t.status === 'deleted');
    }
  }, [tasksMap, selection]);

  // Map taskId → active AdhocEvent's date. Used by the schedule
  // filter to tell "scheduled via free-time mode" apart from "slot-
  // bound". Only one active adhoc per task in v0.2+ (§5.5.2 mutual-
  // exclusivity), so the map is safe to build flat.
  const adhocDateByTaskId = useMemo(() => {
    const m = new Map<string, string>();
    for (const ev of Object.values(adhocEventsMap)) {
      if (ev.status !== 'active' || !ev.taskId) continue;
      m.set(ev.taskId, ev.date);
    }
    return m;
  }, [adhocEventsMap]);

  const today = useMemo(() => {
    const d = new Date();
    return toIsoDateStr(d);
  }, []);
  const thisWeekRange = useMemo(() => weekRangeOf(new Date()), []);

  const filteredTasks = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const applyLineFilter = filters.lineIds.size > 0;
    return tasksInScope
      .filter((t) => (applyLineFilter ? filters.lineIds.has(t.lineId) : true))
      .filter((t) => {
        if (filters.schedule === 'any') return true;
        const scheduledDate = t.slot?.date ?? adhocDateByTaskId.get(t.id);
        switch (filters.schedule) {
          case 'scheduled':
            return scheduledDate != null;
          case 'unscheduled':
            return scheduledDate == null;
          case 'today':
            return scheduledDate === today;
          case 'thisWeek':
            return (
              scheduledDate != null &&
              scheduledDate >= thisWeekRange.from &&
              scheduledDate <= thisWeekRange.to
            );
          case 'overdue':
            return (
              scheduledDate != null &&
              scheduledDate < today &&
              t.status !== 'done'
            );
          default:
            return true;
        }
      })
      .filter((t) => {
        if (!q) return true;
        return (
          t.title.toLowerCase().includes(q) ||
          (t.note?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => a.order - b.order);
  }, [tasksInScope, filters, adhocDateByTaskId, today, thisWeekRange]);

  // Split into the two collapsible groups for inbox / line views.
  // Archived / trash don't split — they're status-scoped lists already.
  const openTasks = useMemo(
    () =>
      filteredTasks.filter(
        (t) => t.status === 'pending' || t.status === 'in-progress',
      ),
    [filteredTasks],
  );
  const doneTasks = useMemo(
    () => filteredTasks.filter((t) => t.status === 'done'),
    [filteredTasks],
  );

  const handleCreate = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (selection.kind !== 'inbox' && selection.kind !== 'line') return;
      const lineId =
        selection.kind === 'line' ? selection.lineId : INBOX_LINE_ID;
      // Order = last task's order + 1, so new tasks sort to the bottom.
      const maxOrder = Object.values(tasksMap)
        .filter((t) => t.lineId === lineId)
        .reduce((m, t) => Math.max(m, t.order), 0);
      void createTask({
        id: freshId('task'),
        lineId,
        title: trimmed,
        order: maxOrder + 1,
        status: 'pending',
      });
    },
    [createTask, selection, tasksMap],
  );

  const title =
    selection.kind === 'inbox'
      ? (inbox?.name ?? 'Inbox')
      : selection.kind === 'line'
        ? (projects.find((p) => p.id === selection.lineId)?.name ?? 'Project')
        : selection.kind === 'archived'
          ? '已归档'
          : '回收站';

  const overline =
    selection.kind === 'inbox'
      ? 'Inbox'
      : selection.kind === 'line'
        ? 'Project'
        : selection.kind === 'archived'
          ? 'Archived'
          : 'Trash';

  const canCreate = selection.kind === 'inbox' || selection.kind === 'line';
  const isTrash = selection.kind === 'trash';
  const isArchived = selection.kind === 'archived';

  const handlePurge = useCallback(
    (task: Task) => {
      const msg = `永久删除「${task.title}」？\n这个操作不可撤销。`;
      if (!window.confirm(msg)) return;
      void purgeTask(task.id);
    },
    [purgeTask],
  );

  const handleEmptyTrash = useCallback(() => {
    const deleted = Object.values(tasksMap).filter(
      (t) => t.status === 'deleted',
    );
    if (deleted.length === 0) return;
    const msg = `清空回收站？将永久删除 ${deleted.length} 条任务，不可撤销。`;
    if (!window.confirm(msg)) return;
    for (const t of deleted) void purgeTask(t.id);
  }, [purgeTask, tasksMap]);

  const trashCount = useMemo(
    () =>
      Object.values(tasksMap).filter((t) => t.status === 'deleted').length,
    [tasksMap],
  );

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-6 px-10 py-10">
      <PageHeader
        overline={overline}
        title={title}
        selection={selection}
        rightSlot={
          isTrash && trashCount > 0 ? (
            <button
              type="button"
              onClick={handleEmptyTrash}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
              清空回收站 · {trashCount}
            </button>
          ) : null
        }
      />

      {canCreate && (
        <NewTaskInput onCreate={handleCreate} placeholder="+ 新任务 · Enter" />
      )}

      <FilterBar
        filters={filters}
        onChange={setFilters}
        lineChoices={
          isArchived || isTrash
            ? distinctLinesForScope(tasksInScope, linesMap)
            : []
        }
      />

      {(() => {
        const rowProps = {
          linesMap,
          onToggleDone: (task: Task) =>
            void updateTask(task.id, {
              status: task.status === 'done' ? 'pending' : 'done',
              doneAt:
                task.status === 'done'
                  ? undefined
                  : new Date().toISOString(),
            }),
          onArchive: (task: Task) => void archiveTask(task.id),
          onRestore: (task: Task) => void restoreTask(task.id),
          onDelete: (task: Task) => void deleteTask(task.id),
          onPurge: handlePurge,
        };
        if (isTrash || isArchived) {
          return filteredTasks.length === 0 ? (
            <EmptyState
              selection={selection}
              hasQuery={filters.search.length > 0}
            />
          ) : (
            <TaskList
              tasks={filteredTasks}
              showProjectPill
              isTrash={isTrash}
              isArchived={isArchived}
              {...rowProps}
            />
          );
        }
        return (
          <GroupedTaskList
            openTasks={openTasks}
            doneTasks={doneTasks}
            searchActive={filters.search.trim().length > 0}
            selection={selection}
            hasQuery={filters.search.length > 0}
            {...rowProps}
          />
        );
      })()}
    </div>
  );
}

// ------------------------------------------------------------------
// Header.
// ------------------------------------------------------------------

function PageHeader({
  overline,
  title,
  selection,
  rightSlot,
}: {
  overline: string;
  title: string;
  selection: Selection;
  rightSlot?: React.ReactNode;
}) {
  const tasksMap = useStore((s) => s.tasks);

  // Project-selection only: show `N / total 任务` + conditional milestone
  // progress bar (only when at least one task in this Project has a
  // milestonePercent). Inbox / Archived / Trash get no count — the
  // filter chip + empty state say enough.
  const stats = useMemo(() => {
    if (selection.kind !== 'line' && selection.kind !== 'inbox') return null;
    const lineId =
      selection.kind === 'line' ? selection.lineId : INBOX_LINE_ID;
    let done = 0;
    let total = 0;
    let progress = 0;
    let hasMilestone = false;
    for (const t of Object.values(tasksMap)) {
      if (t.lineId !== lineId) continue;
      if (t.status === 'archived' || t.status === 'deleted') continue;
      total++;
      if (t.status === 'done') {
        done++;
        if (t.milestonePercent != null) {
          hasMilestone = true;
          if (t.milestonePercent > progress) progress = t.milestonePercent;
        }
      } else if (t.milestonePercent != null) {
        hasMilestone = true;
      }
    }
    return { done, total, progress, hasMilestone };
  }, [tasksMap, selection]);

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {overline}
          </span>
          <h2 className="mt-1 text-2xl font-medium text-ink-primary">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          {stats && stats.total > 0 && (
            <span className="font-mono text-sm tabular-nums text-ink-secondary">
              {stats.done}
              <span className="text-ink-tertiary">/{stats.total}</span> 任务
            </span>
          )}
          {rightSlot}
        </div>
      </div>
      {stats?.hasMilestone && (
        <div className="flex items-center gap-3">
          <div className="relative h-1.5 flex-1 overflow-hidden bg-surface-2">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-ink-primary/70 transition-[width] duration-500"
              style={{ width: `${stats.progress}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink-primary">
            {stats.progress}%
          </span>
        </div>
      )}
    </header>
  );
}

// ------------------------------------------------------------------
// New-task input.
// ------------------------------------------------------------------

function NewTaskInput({
  onCreate,
  placeholder,
}: {
  onCreate: (title: string) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setValue('');
  };
  return (
    <div className="flex h-10 items-center gap-2 rounded-md border border-hairline/60 bg-surface-0 px-3 transition hover:border-hairline focus-within:border-ink-secondary">
      <Plus className="h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.6} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Skip Enter while an IME (pinyin / kana) candidate window
          // is still open — that Enter confirms the candidate, not
          // the form.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="flex-1 bg-transparent text-base text-ink-primary outline-none placeholder:text-ink-tertiary"
      />
    </div>
  );
}

// ------------------------------------------------------------------
// Filter chip bar.
// ------------------------------------------------------------------

const SCHEDULE_CHIPS: Array<{ key: ScheduleFilter; label: string }> = [
  { key: 'any', label: '任意排期' },
  { key: 'today', label: '今日' },
  { key: 'thisWeek', label: '本周' },
  { key: 'overdue', label: '过期未做' },
  { key: 'scheduled', label: '已排期' },
  { key: 'unscheduled', label: '未排期' },
];

function FilterBar({
  filters,
  onChange,
  lineChoices,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Lines that have at least one task in the current selection scope.
   *  Only non-empty for Archived / Trash — regular Project / Inbox
   *  views are already single-line by construction. */
  lineChoices: Line[];
}) {
  const toggleLine = (id: string) => {
    const next = new Set(filters.lineIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filters, lineIds: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {SCHEDULE_CHIPS.map((c) => {
          const active = filters.schedule === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onChange({ ...filters, schedule: c.key })}
              className={clsx(
                'rounded-sm px-2.5 py-1 text-xs font-medium transition',
                active
                  ? 'bg-ink-primary text-surface-0'
                  : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
              )}
            >
              {c.label}
            </button>
          );
        })}
        <label className="ml-auto flex h-8 items-center gap-2 rounded-md border border-hairline/60 bg-surface-0 px-2.5 transition hover:border-hairline focus-within:border-ink-secondary">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" strokeWidth={1.6} />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="搜索标题 / 备注"
            className="w-48 bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-tertiary"
          />
        </label>
      </div>
      {lineChoices.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            所属
          </span>
          {lineChoices.map((line) => {
            const active = filters.lineIds.has(line.id);
            return (
              <button
                key={line.id}
                type="button"
                onClick={() => toggleLine(line.id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs transition',
                  active
                    ? 'bg-surface-3 text-ink-primary'
                    : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
                )}
              >
                <ColorDot color={line.color} />
                {line.name}
              </button>
            );
          })}
          {filters.lineIds.size > 0 && (
            <button
              type="button"
              onClick={() =>
                onChange({ ...filters, lineIds: new Set() })
              }
              className="rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              清空
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function distinctLinesForScope(
  tasks: Task[],
  linesMap: Record<string, Line>,
): Line[] {
  const seen = new Set<string>();
  const result: Line[] = [];
  for (const t of tasks) {
    if (seen.has(t.lineId)) continue;
    const line = linesMap[t.lineId];
    if (!line) continue;
    seen.add(t.lineId);
    result.push(line);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------
// Grouped list — open + completed, each section collapsible.
// ------------------------------------------------------------------

function GroupedTaskList({
  openTasks,
  doneTasks,
  searchActive,
  selection,
  hasQuery,
  linesMap,
  onToggleDone,
  onArchive,
  onRestore,
  onDelete,
  onPurge,
}: {
  openTasks: Task[];
  doneTasks: Task[];
  searchActive: boolean;
  selection: Selection;
  hasQuery: boolean;
  linesMap: Record<string, Line>;
  onToggleDone: (task: Task) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  onDelete: (task: Task) => void;
  onPurge: (task: Task) => void;
}) {
  const [openExpanded, setOpenExpanded] = useState(true);
  const [doneExpanded, setDoneExpanded] = useState(false);

  // Auto-expand the Completed section whenever Open is empty — "you're
  // done, look back at what you did" flips the defaults.
  useEffect(() => {
    if (openTasks.length === 0) setDoneExpanded(true);
  }, [openTasks.length]);

  // Search overrides manual collapse state — if the user is typing a
  // query, both matching groups open so their results are visible.
  const showOpenBody = searchActive || openExpanded;
  const showDoneBody = searchActive || doneExpanded;

  if (openTasks.length === 0 && doneTasks.length === 0) {
    return <EmptyState selection={selection} hasQuery={hasQuery} />;
  }

  const listRowProps = {
    linesMap,
    onToggleDone,
    onArchive,
    onRestore,
    onDelete,
    onPurge,
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        label="未完成"
        count={openTasks.length}
        expanded={showOpenBody}
        onToggle={() => setOpenExpanded((v) => !v)}
        locked={searchActive}
      >
        {openTasks.length === 0 ? (
          <p className="px-1 py-3 text-sm text-ink-tertiary">
            都搞定了 ✓
          </p>
        ) : (
          <TaskList
            tasks={openTasks}
            showProjectPill={selection.kind === 'inbox'}
            isTrash={false}
            isArchived={false}
            {...listRowProps}
          />
        )}
      </Section>
      {doneTasks.length > 0 && (
        <Section
          label="已完成"
          count={doneTasks.length}
          expanded={showDoneBody}
          onToggle={() => setDoneExpanded((v) => !v)}
          locked={searchActive}
        >
          <TaskList
            tasks={doneTasks}
            showProjectPill={selection.kind === 'inbox'}
            isTrash={false}
            isArchived={false}
            {...listRowProps}
          />
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  expanded,
  onToggle,
  locked,
  children,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  locked: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={locked ? undefined : onToggle}
        disabled={locked}
        className={clsx(
          'group flex w-full items-center gap-2 py-1.5 text-left transition',
          locked ? 'cursor-default' : 'hover:text-ink-primary',
        )}
      >
        <ChevronRight
          aria-hidden
          className={clsx(
            'h-3.5 w-3.5 text-ink-tertiary transition-transform',
            expanded && 'rotate-90',
          )}
          strokeWidth={1.8}
        />
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-secondary group-hover:text-ink-primary">
          {label}
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {count}
        </span>
      </button>
      {expanded && <div className="pt-1">{children}</div>}
    </section>
  );
}

// ------------------------------------------------------------------
// Task list + rows.
// ------------------------------------------------------------------

function TaskList({
  tasks,
  linesMap,
  showProjectPill,
  onToggleDone,
  onArchive,
  onRestore,
  onDelete,
  onPurge,
  isTrash,
  isArchived,
}: {
  tasks: Task[];
  linesMap: Record<string, Line>;
  showProjectPill: boolean;
  onToggleDone: (task: Task) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  onDelete: (task: Task) => void;
  onPurge: (task: Task) => void;
  isTrash: boolean;
  isArchived: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskRow
            task={task}
            line={showProjectPill ? linesMap[task.lineId] : undefined}
            onToggleDone={() => onToggleDone(task)}
            onArchive={() => onArchive(task)}
            onRestore={() => onRestore(task)}
            onDelete={() => onDelete(task)}
            onPurge={() => onPurge(task)}
            isTrash={isTrash}
            isArchived={isArchived}
          />
        </li>
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  line,
  onToggleDone,
  onArchive,
  onRestore,
  onDelete,
  onPurge,
  isTrash,
  isArchived,
}: {
  task: Task;
  line: Line | undefined;
  onToggleDone: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onPurge: () => void;
  isTrash: boolean;
  isArchived: boolean;
}) {
  const isDone = task.status === 'done';
  // §5.5.3 archived / trash rows drop the leftmost circle entirely —
  // the circle reads as a checkbox-like affordance ("click to check /
  // multi-select"), which is wrong here: the view context already
  // tells the user the status. Active rows keep the circle as the
  // canonical "mark this task done" hit-target.
  const showStatusToggle = !isArchived && !isTrash;
  return (
    <div
      className={clsx(
        'group flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2',
        (isDone || isArchived || isTrash) && 'opacity-80',
      )}
    >
      {showStatusToggle && (
        <button
          type="button"
          onClick={onToggleDone}
          aria-label={isDone ? 'Mark as open' : 'Mark as done'}
          className="shrink-0 transition hover:text-ink-primary"
        >
          <StatusIcon status={task.status} />
        </button>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={clsx(
            'truncate text-sm',
            isDone && 'text-ink-tertiary line-through decoration-ink-tertiary/40',
            isArchived && 'text-ink-tertiary',
            isTrash && 'text-ink-tertiary line-through decoration-ink-tertiary/40',
            !isDone && !isArchived && !isTrash && 'text-ink-primary',
          )}
        >
          {task.title}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
          <ScheduleInfo task={task} />
          {line && <ProjectPill line={line} />}
          {task.milestonePercent != null && (
            <span className="font-mono text-2xs tabular-nums text-ink-secondary">
              · milestone {task.milestonePercent}%
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        {isTrash ? (
          <>
            <IconAction
              onClick={onRestore}
              label="恢复"
              title="从回收站恢复"
              icon={<Undo2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            />
            <IconAction
              onClick={onPurge}
              label="永久删除"
              title="永久删除（不可恢复）"
              icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
              danger
            />
          </>
        ) : isArchived ? (
          <IconAction
            onClick={onRestore}
            label="取消归档"
            title="恢复到未完成"
            icon={<ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.8} />}
          />
        ) : (
          <>
            <SchedulePopover task={task}>
              <IconActionButton
                label="排期"
                icon={
                  <CalendarIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                }
              />
            </SchedulePopover>
            <IconAction
              onClick={onArchive}
              label="归档"
              title="归档（可恢复）"
              icon={<Archive className="h-3.5 w-3.5" strokeWidth={1.8} />}
            />
            <IconAction
              onClick={onDelete}
              label="删除"
              title="移到回收站（可恢复）"
              icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            />
            <IconAction
              onClick={() => undefined}
              label="更多"
              title="更多"
              icon={
                <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: Task['status'] }) {
  // Only rendered for active rows (pending / in-progress / done); the
  // caller omits this glyph for archived / deleted rows so the user
  // doesn't read the circle as a checkbox-style multi-select hint.
  if (status === 'done') {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-primary/10">
        <Check className="h-3 w-3 text-ink-primary/70" strokeWidth={2.2} />
      </span>
    );
  }
  if (status === 'in-progress') {
    return <CircleDot className="h-4 w-4 text-cta" strokeWidth={2} />;
  }
  return <Circle className="h-4 w-4 text-ink-tertiary" strokeWidth={1.8} />;
}

function ScheduleInfo({ task }: { task: Task }) {
  // §5.5.2 two scheduling modes, rendered distinctly:
  //   Mode A — `task.slot` set: render "date · Rail name"
  //   Mode B — an active AdhocEvent with `taskId = task.id`:
  //              render "date · HH:MM–HH:MM"
  //   Neither → "— 未排期".
  const rails = useStore((s) => s.rails);
  const adhocs = useStore((s) => s.adhocEvents);

  if (task.slot) {
    const rail = rails[task.slot.railId];
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums text-ink-secondary">
        <CalendarIcon className="h-2.5 w-2.5" strokeWidth={1.8} />
        {task.slot.date.slice(5)}
        <span className="text-ink-tertiary">·</span>
        {rail?.name ?? task.slot.railId}
      </span>
    );
  }

  const freeTime = Object.values(adhocs).find(
    (a) => a.taskId === task.id && a.status === 'active',
  );
  if (freeTime) {
    const end = freeTime.startMinutes + freeTime.durationMinutes;
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums text-ink-secondary">
        <CalendarIcon className="h-2.5 w-2.5" strokeWidth={1.8} />
        {freeTime.date.slice(5)}
        <span className="text-ink-tertiary">·</span>
        {minutesToHHMM(freeTime.startMinutes)}–{minutesToHHMM(end)}
      </span>
    );
  }

  return <span className="text-ink-tertiary/80">— 未排期</span>;
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function ProjectPill({ line }: { line: Line }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-2xs text-ink-tertiary">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full"
        style={{
          background: line.color ? RAIL_COLOR_HEX[line.color] : 'rgba(0,0,0,0.2)',
        }}
      />
      {line.name}
    </span>
  );
}

function IconAction({
  onClick,
  label,
  title,
  icon,
  danger,
}: {
  onClick: () => void;
  label: string;
  title: string;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Tooltip content={title}>
      <IconActionButton
        onClick={onClick}
        label={label}
        icon={icon}
        danger={danger}
      />
    </Tooltip>
  );
}

/** Bare button used when the caller composes its own overlay (e.g.,
 *  SchedulePopover wraps this via Radix `asChild`). The standalone
 *  `IconAction` wraps this in a Tooltip. No native `title` attribute
 *  — the Radix Tooltip (when wrapped) is the single hint source; a
 *  native title on top would race against it and show ~2s later. */
const IconActionButton = forwardRef<
  HTMLButtonElement,
  {
    onClick?: () => void;
    label: string;
    icon: React.ReactNode;
    danger?: boolean;
  } & Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onClick' | 'aria-label' | 'title'
  >
>(({ onClick, label, icon, danger, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    aria-label={label}
    className={clsx(
      'rounded-sm p-1 transition',
      danger
        ? 'text-ink-tertiary hover:bg-surface-3 hover:text-red-500'
        : 'text-ink-tertiary hover:bg-surface-3 hover:text-ink-primary',
    )}
    {...rest}
  >
    {icon}
  </button>
));
IconActionButton.displayName = 'IconActionButton';

function EmptyState({
  selection,
  hasQuery,
}: {
  selection: Selection;
  hasQuery: boolean;
}) {
  if (hasQuery) {
    return (
      <section className="flex min-h-[180px] flex-col items-start justify-center gap-2 rounded-md bg-surface-1 px-8 py-10">
        <h3 className="text-base font-medium text-ink-primary">
          没有符合条件的任务
        </h3>
        <p className="text-sm text-ink-tertiary">
          清空搜索或切到其它状态过滤看看。
        </p>
      </section>
    );
  }
  const { heading, body } = emptyCopy(selection);
  return (
    <section className="flex min-h-[180px] flex-col items-start justify-center gap-2 rounded-md bg-surface-1 px-8 py-10">
      <h3 className="text-base font-medium text-ink-primary">{heading}</h3>
      <p className="text-sm text-ink-secondary">{body}</p>
    </section>
  );
}

function emptyCopy(selection: Selection): { heading: string; body: string } {
  switch (selection.kind) {
    case 'inbox':
      return {
        heading: '随手记是空的',
        body: '想到的事情可以先随手丢进来，之后再慢慢归到 Project 或排到某天的 Rail。',
      };
    case 'line':
      return {
        heading: '这个 Project 还没任务',
        body: '顶部输入框新建，或从随手记把已有的任务拖进来。',
      };
    case 'archived':
      return {
        heading: '没有归档的任务',
        body: '归档掉的任务会出现在这里。',
      };
    case 'trash':
      return {
        heading: '回收站是空的',
        body: '删除的任务会进这里，可以恢复或永久删除。',
      };
  }
}

// ------------------------------------------------------------------
// Utilities.
// ------------------------------------------------------------------

function freshId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function toIsoDateStr(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

/** Monday-anchored week range for the given date, both endpoints ISO-
 *  date strings so the schedule filter can do lexical compare. */
function weekRangeOf(date: Date): { from: string; to: string } {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const offset = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: toIsoDateStr(start), to: toIsoDateStr(end) };
}

