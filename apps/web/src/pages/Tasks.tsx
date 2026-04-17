import { useCallback, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  Archive,
  ArchiveRestore,
  Calendar as CalendarIcon,
  Check,
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

// ERD §5.5 Tasks view. Chunk E = list + filters + search + task CRUD.
// Scheduling popover (Chunk F) + Trash hard-delete UX (Chunk G) ship
// in subsequent commits. Task rows carry a "Schedule…" action that
// alerts "coming next" until Chunk F.

type Selection =
  | { kind: 'inbox' }
  | { kind: 'line'; lineId: string }
  | { kind: 'archived' }
  | { kind: 'trash' };

const DEFAULT_SELECTION: Selection = { kind: 'inbox' };

export function Tasks() {
  const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION);
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
  }, [createLine]);

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

type StatusFilter = 'all' | 'open' | 'done';

interface Filters {
  status: StatusFilter;
  search: string;
}

const DEFAULT_FILTERS: Filters = { status: 'open', search: '' };

function MainPanel({
  selection,
  inbox,
  projects,
}: {
  selection: Selection;
  inbox: Line | undefined;
  projects: Line[];
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const tasksMap = useStore((s) => s.tasks);
  const linesMap = useStore((s) => s.lines);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const archiveTask = useStore((s) => s.archiveTask);
  const restoreTask = useStore((s) => s.restoreTask);
  const deleteTask = useStore((s) => s.deleteTask);

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

  const filteredTasks = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return tasksInScope
      .filter((t) => {
        if (selection.kind === 'archived' || selection.kind === 'trash') {
          // Status filter is not meaningful — those views are already
          // status-scoped.
          return true;
        }
        if (filters.status === 'open') {
          return t.status === 'pending' || t.status === 'in-progress';
        }
        if (filters.status === 'done') return t.status === 'done';
        return true;
      })
      .filter((t) => {
        if (!q) return true;
        return (
          t.title.toLowerCase().includes(q) ||
          (t.note?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => a.order - b.order);
  }, [tasksInScope, filters, selection.kind]);

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

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-6 px-10 py-10">
      <PageHeader overline={overline} title={title} selection={selection} />

      {canCreate && (
        <NewTaskInput onCreate={handleCreate} placeholder="+ 新任务 · Enter" />
      )}

      <FilterBar
        filters={filters}
        onChange={setFilters}
        hideStatus={isTrash || isArchived}
      />

      {filteredTasks.length === 0 ? (
        <EmptyState selection={selection} hasQuery={filters.search.length > 0} />
      ) : (
        <TaskList
          tasks={filteredTasks}
          linesMap={linesMap}
          showProjectPill={isArchived || isTrash}
          onToggleDone={(task) =>
            void updateTask(task.id, {
              status: task.status === 'done' ? 'pending' : 'done',
              doneAt: task.status === 'done' ? undefined : new Date().toISOString(),
            })
          }
          onArchive={(task) => void archiveTask(task.id)}
          onRestore={(task) => void restoreTask(task.id)}
          onDelete={(task) => void deleteTask(task.id)}
          onSchedule={() =>
            window.alert('排期 popover 在 Chunk F 接入；v0.2 暂用占位。')
          }
          isTrash={isTrash}
          isArchived={isArchived}
        />
      )}
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
}: {
  overline: string;
  title: string;
  selection: Selection;
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
        {stats && stats.total > 0 && (
          <span className="font-mono text-sm tabular-nums text-ink-secondary">
            {stats.done}
            <span className="text-ink-tertiary">/{stats.total}</span> 任务
          </span>
        )}
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
          if (e.key === 'Enter') {
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

function FilterBar({
  filters,
  onChange,
  hideStatus,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  hideStatus?: boolean;
}) {
  const statusChips: Array<{ key: StatusFilter; label: string }> = [
    { key: 'open', label: '未完成' },
    { key: 'done', label: '已完成' },
    { key: 'all', label: '全部' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hideStatus &&
        statusChips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange({ ...filters, status: c.key })}
            className={clsx(
              'rounded-sm px-2.5 py-1 text-xs font-medium transition',
              filters.status === c.key
                ? 'bg-ink-primary text-surface-0'
                : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
            )}
          >
            {c.label}
          </button>
        ))}
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
  onSchedule,
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
  onSchedule: (task: Task) => void;
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
            onSchedule={() => onSchedule(task)}
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
  onSchedule,
  isTrash,
  isArchived,
}: {
  task: Task;
  line: Line | undefined;
  onToggleDone: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onSchedule: () => void;
  isTrash: boolean;
  isArchived: boolean;
}) {
  const isDone = task.status === 'done';
  return (
    <div
      className={clsx(
        'group flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2',
        (isDone || isArchived || isTrash) && 'opacity-80',
      )}
    >
      <button
        type="button"
        onClick={onToggleDone}
        aria-label={isDone ? 'Mark as open' : 'Mark as done'}
        disabled={isTrash}
        className={clsx(
          'shrink-0 transition',
          !isTrash && 'hover:text-ink-primary',
          isTrash && 'cursor-not-allowed opacity-60',
        )}
      >
        <StatusIcon status={task.status} />
      </button>

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
              onClick={() => window.alert('永久删除在 Chunk G 接入。')}
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
            <IconAction
              onClick={onSchedule}
              label="排期"
              title="绑到 Rail / 自由时间排期"
              icon={
                <CalendarIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              }
            />
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
  if (status === 'archived' || status === 'deleted') {
    return <Circle className="h-4 w-4 text-ink-tertiary/60" strokeWidth={1.4} />;
  }
  return <Circle className="h-4 w-4 text-ink-tertiary" strokeWidth={1.8} />;
}

function ScheduleInfo({ task }: { task: Task }) {
  // v0.2.1 Chunk E: nothing is scheduled yet (popover lands in Chunk F);
  // shape the info slot so the row layout stabilises before that ships.
  if (task.slot) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums">
        <CalendarIcon className="h-2.5 w-2.5" strokeWidth={1.8} />
        {task.slot.date.slice(5)} · {task.slot.railId}
      </span>
    );
  }
  return <span className="text-ink-tertiary/80">— 未排期</span>;
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
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={clsx(
          'rounded-sm p-1 transition',
          danger
            ? 'text-ink-tertiary hover:bg-surface-3 hover:text-red-500'
            : 'text-ink-tertiary hover:bg-surface-3 hover:text-ink-primary',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

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

