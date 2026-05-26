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
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  deriveTaskProgress,
  deriveTaskStatus,
  INBOX_LINE_ID,
  isOccurrenceManaged,
  railAtDate,
  selectCurrentHabitPhase,
  selectHabitPhasesByLine,
  selectOccurrencesForTask,
  useStore,
  type HabitPhase,
  type Line,
  type Rail,
  type Shift,
  type Task,
  type TaskOccurrence,
  type TaskPriority,
} from '@dayrail/core';
import type { RailColor } from '@/data/sample';
import { RAIL_COLOR_HEX } from '@/components/railColors';
import { Tooltip } from '@/components/primitives/Tooltip';
import { useIme } from '@/lib/ime';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';
import { MarkdownField } from '@/components/MarkdownField';
import { RailPicker } from '@/components/RailPicker';
import { SchedulePopover } from '@/components/SchedulePopover';
import { useResolvedTemplateKey } from '@/lib/useResolvedTemplate';
import { HabitDetail } from './HabitDetail';
import { ReasonToast } from '@/components/ReasonToast';
import {
  latestTagsForTask,
  useReasonToast,
} from '@/components/useReasonToast';

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
  const habitPhasesMap = useStore((s) => s.habitPhases);
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
  const habits = useMemo(
    () =>
      Object.values(linesMap)
        .filter((l) => l.kind === 'habit' && l.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt),
    [linesMap],
  );
  const currentPhaseByHabitId = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const h of habits) {
      const p = selectCurrentHabitPhase({ habitPhases: habitPhasesMap }, h.id);
      m[h.id] = p?.name;
    }
    return m;
  }, [habits, habitPhasesMap]);

  // Name comes from the NavGroup's inline create input (not
  // window.prompt — that's a silent no-op in the Tauri desktop webview,
  // which doesn't implement runJavaScriptTextInputPanel). The inline
  // input works identically on web and desktop.
  const handleCreateProject = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
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
    },
    [createLine, setSelection],
  );

  const handleCreateHabit = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      const id = freshId('line');
      void createLine({
        id,
        name,
        kind: 'habit',
        status: 'active',
        createdAt: Date.now(),
      });
      setSelection({ kind: 'line', lineId: id });
    },
    [createLine, setSelection],
  );

  return (
    <div className="flex min-h-screen w-full">
      <NavTree
        selection={selection}
        onSelect={setSelection}
        inbox={inbox}
        projects={otherProjects}
        habits={habits}
        currentPhaseByHabitId={currentPhaseByHabitId}
        onCreateProject={handleCreateProject}
        onCreateHabit={handleCreateHabit}
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
  habits,
  currentPhaseByHabitId,
  onCreateProject,
  onCreateHabit,
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  inbox: Line | undefined;
  projects: Line[];
  habits: Line[];
  currentPhaseByHabitId: Record<string, string | undefined>;
  onCreateProject: (name: string) => void;
  onCreateHabit: (name: string) => void;
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

      <NavGroup
        label="Projects"
        actionLabel="+ 新建"
        onCreate={onCreateProject}
        createPlaceholder="新建 Project · 名称后回车"
      >
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

      <NavGroup
        label="Habits"
        actionLabel="+ 新建"
        onCreate={onCreateHabit}
        createPlaceholder="新建 Habit · 名称后回车"
      >
        {habits.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-ink-tertiary">
            还没有 Habit
          </p>
        ) : (
          habits.map((line) => (
            <NavRow
              key={line.id}
              icon={<ColorDot color={line.color} />}
              label={line.name}
              subtitle={currentPhaseByHabitId[line.id]}
              active={
                selection.kind === 'line' && selection.lineId === line.id
              }
              onClick={() => onSelect({ kind: 'line', lineId: line.id })}
            />
          ))
        )}
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
  onCreate,
  createPlaceholder,
  children,
}: {
  label: string;
  actionLabel?: string;
  /** Called with the typed name when the user submits the inline
   *  create input. Replaces the old `window.prompt`-based flow (which
   *  is a silent no-op in the Tauri desktop webview). */
  onCreate?: (name: string) => void;
  createPlaceholder?: string;
  children: React.ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const ime = useIme();

  const submit = () => {
    const name = draft.trim();
    if (name) onCreate?.(name);
    setDraft('');
    setCreating(false);
  };
  // Blur / Esc discard (don't create on click-away) — matches the
  // QuickCreate idiom; only Enter commits.
  const cancel = () => {
    setDraft('');
    setCreating(false);
  };

  return (
    <div className="mt-5 flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between px-3 pb-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {label}
        </span>
        {actionLabel && onCreate && (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            aria-expanded={creating}
            className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:text-ink-primary"
          >
            <Plus className="h-2.5 w-2.5" strokeWidth={1.8} />
            {actionLabel.replace(/^\+\s*/, '')}
          </button>
        )}
      </div>
      {creating && onCreate && (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={cancel}
          placeholder={createPlaceholder ?? '名称后回车'}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !ime.isComposing(e)) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          className="mx-3 mb-1 h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-sm text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
        />
      )}
      {children}
    </div>
  );
}

function NavRow({
  icon,
  label,
  subtitle,
  active,
  onClick,
  dim = false,
}: {
  icon: React.ReactNode;
  label: string;
  /** Optional second line (muted, Mono overline-style). Habit rows
   *  use this to surface the current phase name. */
  subtitle?: string;
  active: boolean;
  onClick: () => void;
  dim?: boolean;
}) {
  const h = subtitle ? 'h-10' : 'h-8';
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-3 text-left text-sm transition',
        h,
        active
          ? 'bg-surface-2 text-ink-primary'
          : dim
            ? 'text-ink-tertiary hover:bg-surface-1 hover:text-ink-secondary'
            : 'text-ink-secondary hover:bg-surface-1 hover:text-ink-primary',
      )}
    >
      <span className="shrink-0 text-ink-tertiary">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {subtitle && (
          <span className="truncate font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {subtitle}
          </span>
        )}
      </span>
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
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
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
  const taskOccurrencesMap = useStore((s) => s.taskOccurrences);
  const adhocEventsMap = useStore((s) => s.adhocEvents);
  const linesMap = useStore((s) => s.lines);
  const railsMap = useStore((s) => s.rails);
  const shiftsMap = useStore((s) => s.shifts);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const restoreTask = useStore((s) => s.restoreTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const purgeTask = useStore((s) => s.purgeTask);

  // Wire complete / archive actions through the Reason toast so users
  // get 6s undo + optional reason-tag capture (ERD §5.2). Direct
  // archiveTask / status-flip paths that used to fire immediately now
  // go through `fire()` instead.
  const { toast, fire, handleAddTag, handleUndo, handleClose } = useReasonToast(
    'pending-queue',
  );

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

  // ERD §10.6 — completion status is DERIVED for occurrence-managed
  // tasks (the rollup over occurrences), not the raw `task.status`
  // field (which the store never materializes back). The 已完成/未完成
  // grouping + overdue filter below must use this derived status, or an
  // occurrence-managed task lands in the wrong group (e.g. raw status
  // stale `done` while only 1/4 occurrences are done). For tasks with
  // no occurrences `deriveTaskStatus` returns `task.status` verbatim, so
  // legacy rows are unaffected.
  const effectiveStatusById = useMemo(() => {
    const m = new Map<string, Task['status']>();
    for (const t of tasksInScope) {
      m.set(
        t.id,
        deriveTaskStatus(
          t,
          selectOccurrencesForTask(
            { taskOccurrences: taskOccurrencesMap },
            t.id,
          ),
        ),
      );
    }
    return m;
  }, [tasksInScope, taskOccurrencesMap]);
  const effectiveStatusOf = useCallback(
    (t: Task): Task['status'] => effectiveStatusById.get(t.id) ?? t.status,
    [effectiveStatusById],
  );

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
              effectiveStatusOf(t) !== 'done'
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
  }, [tasksInScope, filters, adhocDateByTaskId, today, thisWeekRange, effectiveStatusOf]);

  // Split into the two collapsible groups for inbox / line views.
  // Archived / trash don't split — they're status-scoped lists already.
  // `deferred` is "still awaiting a decision" (§5.7 Pending semantics)
  // — it belongs in 未完成 next to pending / in-progress, not silently
  // dropped between the two buckets.
  // "open" = anything not derived-done. Within inbox/line scope the raw
  // archived/deleted tasks are already excluded by `tasksInScope`, so the
  // remainder is pending / in-progress / deferred (and the rare
  // occurrence-managed "all occurrences archived" edge, which belongs in
  // 未完成 — it isn't done and isn't in the archived view).
  const openTasks = useMemo(
    () => filteredTasks.filter((t) => effectiveStatusOf(t) !== 'done'),
    [filteredTasks, effectiveStatusOf],
  );
  const doneTasks = useMemo(
    () => filteredTasks.filter((t) => effectiveStatusOf(t) === 'done'),
    [filteredTasks, effectiveStatusOf],
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
        ? (linesMap[selection.lineId]?.name ?? 'Line')
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

  const updateLine = useStore((s) => s.updateLine);
  const navigateRoute = useNavigate();

  // When the selected Line is a habit, surface a phase panel above
  // the task flow. Detached so projects don't render it.
  const selectedLine =
    selection.kind === 'line' ? projects.find((p) => p.id === selection.lineId) : undefined;
  // `projects` excludes habit lines — pull habits directly from the
  // lines map to detect kind='habit' selection.
  const selectedHabit =
    selection.kind === 'line' && !selectedLine
      ? linesMap[selection.lineId]
      : undefined;
  const isHabitView = selectedHabit?.kind === 'habit';

  // Line actions menu — visible only for user-editable lines (active
  // projects + active habits). Inbox skipped (isDefault), archived /
  // trash skipped (those are status buckets, not Lines).
  const editableLine: Line | undefined =
    selection.kind === 'line'
      ? (selectedLine ?? selectedHabit)
      : undefined;
  const canEditLine =
    editableLine != null && !editableLine.isDefault;

  // Inline rename is owned by PageHeader; the parent only needs a
  // commit path. The `⋯` menu's Rename item trips a request counter
  // that PageHeader watches to flip into edit mode.
  const [renameRequestCount, setRenameRequestCount] = useState(0);
  const handleRequestRename = useCallback(() => {
    if (!editableLine) return;
    setRenameRequestCount((n) => n + 1);
  }, [editableLine]);
  const handleCommitLineName = useCallback(
    (next: string) => {
      if (!editableLine) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === editableLine.name) return;
      void updateLine(editableLine.id, { name: trimmed });
    },
    [editableLine, updateLine],
  );

  const handleArchiveLine = useCallback(() => {
    if (!editableLine) return;
    const msg = `归档「${editableLine.name}」？归档后不在主列表显示；随时可从"已归档"恢复。`;
    if (!window.confirm(msg)) return;
    void updateLine(editableLine.id, {
      status: 'archived',
      archivedAt: Date.now(),
    });
    navigateRoute('/tasks/inbox');
  }, [editableLine, updateLine, navigateRoute]);

  const handleChangeLineColor = useCallback(
    (next: RailColor) => {
      if (!editableLine) return;
      if (editableLine.color === next) return;
      void updateLine(editableLine.id, { color: next });
    },
    [editableLine, updateLine],
  );

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-6 px-10 py-10">
      <PageHeader
        overline={isHabitView ? 'Habit' : overline}
        title={title}
        selection={selection}
        hideTaskCount={isHabitView}
        {...(canEditLine && { onRequestRename: handleRequestRename })}
        {...(canEditLine && { onCommitLineName: handleCommitLineName })}
        renameRequestCount={renameRequestCount}
        {...(canEditLine &&
          !isHabitView && { onArchiveLine: handleArchiveLine })}
        {...(canEditLine && { onChangeLineColor: handleChangeLineColor })}
        lineColor={editableLine?.color}
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

      {isHabitView && selectedHabit && (
        <>
          <HabitPhasePanel lineId={selectedHabit.id} />
          <HabitDetail habit={selectedHabit} />
        </>
      )}

      {!isHabitView && selectedLine && !selectedLine.isDefault && (
        <MarkdownField
          value={selectedLine.note}
          onCommit={(next) =>
            void updateLine(selectedLine.id, { note: next })
          }
          placeholder="+ 添加描述 · Markdown"
          dialogTitle={`${selectedLine.name} · 描述`}
          ariaLabel="Project 描述"
        />
      )}

      {!isHabitView && canCreate && (
        <NewTaskInput onCreate={handleCreate} placeholder="+ 新任务 · Enter" />
      )}

      {!isHabitView && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          lineChoices={
            isArchived || isTrash
              ? distinctLinesForScope(tasksInScope, linesMap)
              : []
          }
        />
      )}

      {!isHabitView && (() => {
        const displayNameFor = (task: Task): string => {
          if (task.slot) {
            const rail = railsMap[task.slot.railId];
            if (rail) return rail.name;
          }
          return task.title;
        };
        const rowProps = {
          linesMap,
          onToggleDone: (task: Task) => {
            // Un-marking (done → pending) is a direct revert, no
            // reason-tag capture makes sense. Marking done goes
            // through the toast so the user gets 6s undo.
            if (task.status === 'done') {
              void updateTask(task.id, {
                status: 'pending',
                doneAt: undefined,
              });
              return;
            }
            fire({
              taskId: task.id,
              ...(task.slot && { railId: task.slot.railId }),
              displayName: displayNameFor(task),
              action: 'done',
            });
          },
          onArchive: (task: Task) =>
            fire({
              taskId: task.id,
              ...(task.slot && { railId: task.slot.railId }),
              displayName: displayNameFor(task),
              action: 'archive',
            }),
          onRestore: (task: Task) => void restoreTask(task.id),
          onDelete: (task: Task) => void deleteTask(task.id),
          onPurge: handlePurge,
          // Only non-trash rows open the detail drawer — trash rows
          // are effectively read-only until restored.
          onOpenDetail: isTrash
            ? undefined
            : (task: Task) => setDetailTaskId(task.id),
          shiftsMap,
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

      {detailTaskId && tasksMap[detailTaskId] && (
        <TaskDetailDrawer
          task={tasksMap[detailTaskId]!}
          line={linesMap[tasksMap[detailTaskId]!.lineId]}
          onClose={() => setDetailTaskId(null)}
        />
      )}

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
// Header.
// ------------------------------------------------------------------

function PageHeader({
  overline,
  title,
  selection,
  rightSlot,
  onRequestRename,
  onCommitLineName,
  renameRequestCount,
  onArchiveLine,
  onChangeLineColor,
  lineColor,
  hideTaskCount,
}: {
  overline: string;
  title: string;
  selection: Selection;
  rightSlot?: React.ReactNode;
  /** The `⋯` menu's Rename item calls this; PageHeader flips to inline
   *  edit mode via the request counter. */
  onRequestRename?: () => void;
  /** Commit path for inline rename / `⋯` menu rename. Trimmed
   *  non-empty values only; parent short-circuits if unchanged. */
  onCommitLineName?: (next: string) => void;
  /** Ticked by the parent when the `⋯` menu's Rename is pressed.
   *  PageHeader watches this counter to enter edit mode — decouples
   *  parent from the header's internal state. */
  renameRequestCount?: number;
  onArchiveLine?: () => void;
  onChangeLineColor?: (next: RailColor) => void;
  lineColor?: RailColor;
  /** Habits don't have user-facing tasks (auto-tasks materialize
   *  behind the scenes), so the `N/total 任务` count is misleading. */
  hideTaskCount?: boolean;
}) {
  const tasksMap = useStore((s) => s.tasks);
  const taskOccurrencesMap = useStore((s) => s.taskOccurrences);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(title);
  const ime = useIme();
  // React to external rename requests (from the ⋯ menu item).
  useEffect(() => {
    if (renameRequestCount == null || renameRequestCount === 0) return;
    setDraftName(title);
    setIsRenaming(true);
  }, [renameRequestCount, title]);
  // Keep draft fresh when the selection changes underneath us.
  useEffect(() => {
    if (!isRenaming) setDraftName(title);
  }, [title, isRenaming]);

  const canRename = !!onCommitLineName;
  const commitName = useCallback(() => {
    const trimmed = draftName.trim();
    setIsRenaming(false);
    if (!trimmed || trimmed === title) {
      setDraftName(title);
      return;
    }
    onCommitLineName?.(trimmed);
  }, [draftName, onCommitLineName, title]);
  const cancelRename = useCallback(() => {
    setDraftName(title);
    setIsRenaming(false);
  }, [title]);

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
      // ERD §10.6 — count by DERIVED status/progress so occurrence-managed
      // tasks roll up correctly (raw `task.status` / `milestonePercent`
      // are stale once occurrences drive completion). Mirrors the
      // `countTasks` / `selectProjectProgress` selectors.
      const occs = selectOccurrencesForTask(
        { taskOccurrences: taskOccurrencesMap },
        t.id,
      );
      const status = deriveTaskStatus(t, occs);
      if (status === 'archived' || status === 'deleted') continue;
      total++;
      const taskProgress = deriveTaskProgress(t, occs);
      if (status === 'done') {
        done++;
        if (taskProgress != null) {
          hasMilestone = true;
          if (taskProgress > progress) progress = taskProgress;
        }
      } else if (taskProgress != null) {
        hasMilestone = true;
      }
    }
    return { done, total, progress, hasMilestone };
  }, [tasksMap, taskOccurrencesMap, selection]);

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {overline}
          </span>
          {isRenaming && canRename ? (
            <input
              type="text"
              value={draftName}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !ime.isComposing(e)) {
                  e.preventDefault();
                  commitName();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              aria-label="重命名"
              className="mt-1 w-full rounded-sm bg-transparent text-2xl font-medium text-ink-primary outline-none ring-2 ring-cta/40 ring-offset-2 ring-offset-surface-0"
            />
          ) : (
            <div
              className="group relative mt-1 inline-flex max-w-full items-center gap-2"
              onDoubleClick={
                canRename ? () => setIsRenaming(true) : undefined
              }
            >
              <h2 className="truncate text-2xl font-medium text-ink-primary">
                {title}
              </h2>
              {canRename && (
                <button
                  type="button"
                  onClick={() => setIsRenaming(true)}
                  aria-label="重命名"
                  title="重命名 · 双击标题也行"
                  className="shrink-0 rounded-sm p-1 text-ink-tertiary opacity-0 transition hover:bg-surface-2 hover:text-ink-primary group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {!hideTaskCount && stats && stats.total > 0 && (
            <span className="font-mono text-sm tabular-nums text-ink-secondary">
              {stats.done}
              <span className="text-ink-tertiary">/{stats.total}</span> 任务
            </span>
          )}
          {(onRequestRename || onArchiveLine || onChangeLineColor) && (
            <LineActionsMenu
              currentColor={lineColor}
              onRename={onRequestRename}
              onArchive={onArchiveLine}
              onChangeColor={onChangeLineColor}
            />
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

const LINE_COLOR_PALETTE: RailColor[] = [
  'sand',
  'sage',
  'slate',
  'brown',
  'amber',
  'teal',
  'pink',
  'grass',
  'indigo',
  'plum',
];

function LineActionsMenu({
  currentColor,
  onRename,
  onArchive,
  onChangeColor,
}: {
  currentColor?: RailColor;
  onRename?: () => void;
  onArchive?: () => void;
  onChangeColor?: (next: RailColor) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Line actions"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[200px]">
        {onRename && (
          <DropdownMenuItem onSelect={onRename}>重命名</DropdownMenuItem>
        )}
        {onChangeColor && (
          <div className="px-2 py-1.5">
            <span className="mb-1.5 block font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              改色
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {LINE_COLOR_PALETTE.map((c) => {
                const active = c === currentColor;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Set color: ${c}`}
                    onClick={() => onChangeColor(c)}
                    className={clsx(
                      'h-5 w-5 rounded-full transition hover:scale-110',
                      active && 'ring-2 ring-ink-primary/70 ring-offset-1 ring-offset-surface-1',
                    )}
                    style={{ background: RAIL_COLOR_HEX[c] }}
                  />
                );
              })}
            </div>
          </div>
        )}
        {onArchive && (
          <DropdownMenuItem onSelect={onArchive}>归档</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewTaskInput({
  onCreate,
  placeholder,
}: {
  onCreate: (title: string) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState('');
  const ime = useIme();
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
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={(e) => {
          // Skip Enter while an IME (pinyin / kana) candidate window
          // is still open — see @/lib/ime for the WKWebView race
          // workaround behind ime.isComposing(e).
          if (e.key === 'Enter' && !ime.isComposing(e)) {
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

// ------------------------------------------------------------------
// Habit Phase panel — §5.5.0. Opt-in phase timeline for habit-kind
// Lines. Zero phases → simple-habit prompt. ≥1 phases → vertical
// timeline with add / rename / reschedule / delete per phase.
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Task detail drawer — click a task row's title / body area to edit
// title / note / milestone in a right-slide panel. Autosaves on blur
// so there's no "save" button friction. Esc closes.
// ------------------------------------------------------------------

export function TaskDetailDrawer({
  task,
  line,
  onClose,
}: {
  task: Task;
  line: Line | undefined;
  onClose: () => void;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const linesMap = useStore((s) => s.lines);
  // ERD §10.6 v0.11.5 — when a Task has occurrences, `Task.slot` is
  // ignored. Hide the task-level Schedule entry so the user doesn't
  // hit the silent dead-end where the click writes a field that the
  // rest of the app skips.
  const taskOccurrencesMap = useStore((s) => s.taskOccurrences);
  const taskIsManaged = useMemo(
    () =>
      isOccurrenceManaged(
        selectOccurrencesForTask({ taskOccurrences: taskOccurrencesMap }, task.id),
      ),
    [taskOccurrencesMap, task.id],
  );
  // IME guard for the title input + sub-item inputs below. Shared
  // ref-tracked composition state across all text inputs in this
  // drawer (one user-facing input editing flow at a time).
  const ime = useIme();
  // v0.4: auto-tasks generated by habit materialization get locked
  // fields (ERD §5.5.0 editability table) — title / schedule /
  // milestone all flow from the habit, not this occurrence.
  const isAutoTask = task.source === 'auto-habit';
  // Candidate destinations for moving the task: every active Line
  // (Inbox included). Projects + habits share the same picker since
  // a task is kind-agnostic at the lineId level.
  const moveTargets = useMemo(
    () =>
      Object.values(linesMap)
        .filter((l) => l.status === 'active')
        .sort((a, b) => {
          // Inbox pinned to top; everything else by name.
          if (a.id === INBOX_LINE_ID) return -1;
          if (b.id === INBOX_LINE_ID) return 1;
          return a.name.localeCompare(b.name);
        }),
    [linesMap],
  );

  const [title, setTitle] = useState(task.title);
  const [milestone, setMilestone] = useState<string>(
    task.milestonePercent != null ? String(task.milestonePercent) : '',
  );

  // Sync editor state when a different task is opened from the list
  // without unmounting the drawer (fast successive clicks). MarkdownField
  // owns the note buffer internally and re-syncs when `value` changes.
  useEffect(() => {
    setTitle(task.title);
    setMilestone(
      task.milestonePercent != null ? String(task.milestonePercent) : '',
    );
  }, [task.id, task.title, task.milestonePercent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === task.title) {
      setTitle(task.title);
      return;
    }
    void updateTask(task.id, { title: trimmed });
  };

  const commitNote = useCallback(
    (next: string | undefined) => {
      const normalized = next && next.trim() ? next.trim() : undefined;
      if ((task.note ?? undefined) === normalized) return;
      void updateTask(task.id, { note: normalized });
    },
    [task.id, task.note, updateTask],
  );

  const commitMilestone = () => {
    const raw = milestone.trim();
    if (raw === '') {
      if (task.milestonePercent != null) {
        void updateTask(task.id, { milestonePercent: undefined });
      }
      return;
    }
    const n = Math.max(0, Math.min(100, Number.parseInt(raw, 10)));
    if (!Number.isFinite(n)) {
      setMilestone(
        task.milestonePercent != null ? String(task.milestonePercent) : '',
      );
      return;
    }
    if (n === task.milestonePercent) return;
    void updateTask(task.id, { milestonePercent: n });
  };

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink-primary/10 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-label={`Task detail · ${task.title}`}
        className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col overflow-hidden bg-surface-0 shadow-[0_0_0_0.5px_theme(colors.hairline),-12px_0_32px_-16px_rgba(0,0,0,0.2)] animate-[popoverIn_200ms_cubic-bezier(0.22,0.61,0.36,1)]"
      >
        <header className="flex items-center justify-between px-5 pt-5">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Task detail
            </span>
            {line && (
              <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                <ColorDot color={line.color} />
                {line.name}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
          {!isAutoTask && (
            <label className="flex flex-col gap-1 text-xs text-ink-secondary">
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                所属
              </span>
              <select
                value={task.lineId}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next !== task.lineId) {
                    void updateTask(task.id, { lineId: next });
                  }
                }}
                className="h-9 rounded-md border border-hairline/60 bg-surface-0 px-2.5 text-sm text-ink-primary outline-none focus:border-ink-secondary"
              >
                {moveTargets.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id === INBOX_LINE_ID
                      ? `📥 ${l.name}`
                      : l.kind === 'habit'
                        ? `📈 ${l.name}`
                        : l.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-ink-secondary">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              标题
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              disabled={isAutoTask}
              title={
                isAutoTask
                  ? 'Habit 自动任务的标题由 habit 名统一控制,在 habit 详情页改名'
                  : undefined
              }
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !ime.isComposing(e)) {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="h-9 rounded-md border border-hairline/60 bg-surface-0 px-2.5 text-base text-ink-primary outline-none focus:border-ink-secondary disabled:bg-surface-1 disabled:text-ink-tertiary"
            />
          </label>

          <div className="flex flex-col gap-1 text-xs text-ink-secondary">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              备注
            </span>
            <MarkdownField
              value={task.note}
              onCommit={commitNote}
              placeholder="+ 添加备注 · Markdown"
              dialogTitle={`${task.title || '任务'} · 备注`}
              ariaLabel="任务备注"
            />
          </div>

          {task.lineId !== INBOX_LINE_ID && !isAutoTask && (
            <label className="flex items-center gap-3 text-xs text-ink-secondary">
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                里程碑
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={milestone}
                onChange={(e) => setMilestone(e.target.value)}
                onBlur={commitMilestone}
                placeholder="可选 · 0-100"
                className="h-8 w-24 rounded-md border border-hairline/60 bg-surface-0 px-2 font-mono text-sm tabular-nums text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
              />
              <span className="text-ink-tertiary">%</span>
              <span className="ml-auto text-2xs text-ink-tertiary">
                留空 = 非里程碑任务
              </span>
            </label>
          )}

          <PrioritySection task={task} />

          <OccurrencesSection task={task} />

          <div className="flex flex-col gap-1 pt-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              排期
            </span>
            <div className="flex items-center gap-2">
              <ScheduleInfo task={task} />
              {isAutoTask ? (
                <span className="text-2xs text-ink-tertiary">
                  Habit 绑定决定,去 habit 详情页改节奏
                </span>
              ) : taskIsManaged ? (
                <span className="text-2xs text-ink-tertiary">
                  已切分 · 请在上方「切分」区按 occurrence 排期
                </span>
              ) : (
                <SchedulePopover task={task}>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
                  >
                    {task.slot ? '修改' : '排期…'}
                  </button>
                </SchedulePopover>
              )}
            </div>
          </div>
        </div>

        <footer className="hairline-t flex items-center justify-between px-5 py-3 text-2xs text-ink-tertiary">
          <span>ESC 关闭 · 失焦自动保存</span>
          <span className="font-mono tabular-nums">
            id · {task.id.slice(0, 12)}
          </span>
        </footer>
      </aside>
    </>
  );
}

// §5.5 lightweight priority hint. Writes `priority: undefined` on
// "None" so the field is cleared rather than carried as a string.
function PrioritySection({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const current = task.priority ?? null;
  const opts: Array<{ key: TaskPriority | null; label: string; tone: string }> = [
    { key: null, label: 'None', tone: 'bg-surface-2 text-ink-secondary' },
    { key: 'P0', label: 'P0', tone: 'bg-red-500/90 text-white' },
    { key: 'P1', label: 'P1', tone: 'bg-amber-500/90 text-white' },
    { key: 'P2', label: 'P2', tone: 'bg-slate-400/80 text-white' },
  ];
  const commit = (next: TaskPriority | null) => {
    if (next === current) return;
    void updateTask(task.id, { priority: next ?? undefined });
  };
  return (
    <div className="flex items-center gap-3 text-xs text-ink-secondary">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        优先级
      </span>
      <div className="inline-flex items-stretch overflow-hidden rounded-md border border-hairline/60">
        {opts.map((o, i) => {
          const active = o.key === current;
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => commit(o.key)}
              className={clsx(
                'px-2.5 py-1 font-mono text-2xs tabular-nums transition',
                i > 0 && 'border-l border-hairline/60',
                active
                  ? o.tone
                  : 'text-ink-tertiary hover:bg-surface-2/70 hover:text-ink-primary',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <span className="ml-auto text-2xs text-ink-tertiary">仅排序/筛选</span>
    </div>
  );
}

// ERD §10.6 v0.11 — small badge surfaced in the task list row showing
// "切分 N/M" when the task has occurrences. Subscribes to
// `taskOccurrences` raw map; useMemo derives the count for this task
// (per the Zustand selector rule against returning fresh arrays inline).
function TaskOccurrenceCountBadge({ taskId }: { taskId: string }) {
  const occurrencesMap = useStore((s) => s.taskOccurrences);
  const counts = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const occ of Object.values(occurrencesMap)) {
      if (occ.taskId !== taskId) continue;
      if (occ.status === 'archived') continue;
      total++;
      if (occ.status === 'done') done++;
    }
    return { total, done };
  }, [occurrencesMap, taskId]);
  if (counts.total === 0) return null;
  return (
    <span className="font-mono text-2xs tabular-nums text-ink-secondary">
      · 切分 {counts.done}/{counts.total}
    </span>
  );
}

// ERD §10.6 v0.11 — TaskOccurrences inside the task detail drawer.
// Each row is one occurrence; checkbox toggles status, label / percent
// edit in-place, slot chip opens an inline date+rail picker (or
// "未排" when empty). Replaces the pre-v0.11 SubItemsSection.
//
// Migration story: legacy `Task.subItems` are mapped one-shot to
// occurrences at hydrate (`runOccurrencesMigration`); they appear here
// as label-only / unscheduled occurrences and behave identically to
// what the user had before. The new affordance is the slot chip + the
// percent input.

function OccurrencesSection({ task }: { task: Task }) {
  const occurrencesMap = useStore((s) => s.taskOccurrences);
  const railsMap = useStore((s) => s.rails);
  const addTaskOccurrence = useStore((s) => s.addTaskOccurrence);
  const updateTaskOccurrence = useStore((s) => s.updateTaskOccurrence);
  const completeTaskOccurrence = useStore((s) => s.completeTaskOccurrence);
  const reopenTaskOccurrence = useStore((s) => s.reopenTaskOccurrence);
  const removeTaskOccurrence = useStore((s) => s.removeTaskOccurrence);
  const scheduleTaskOccurrence = useStore((s) => s.scheduleTaskOccurrence);

  const items = useMemo(
    () =>
      selectOccurrencesForTask({ taskOccurrences: occurrencesMap }, task.id),
    [occurrencesMap, task.id],
  );

  const [draft, setDraft] = useState('');
  const ime = useIme();

  const addOccurrence = () => {
    const trimmed = draft.trim();
    // ERD §10.6 v0.12.3 — quick-add shortcut: a bare integer in the
    // valid percent range (0–100) creates a label-less milestone
    // occurrence directly, so "add a 50% milestone" is one step instead
    // of "create empty → type 50 in the row". A number out of range
    // (e.g. 150, 2024) or any non-numeric text falls through to a
    // label, so numeric step names still work. Empty = blank occurrence.
    let partial: Partial<Omit<TaskOccurrence, 'id' | 'taskId'>> | undefined;
    if (trimmed.length === 0) {
      partial = undefined;
    } else if (/^\d+$/.test(trimmed) && Number(trimmed) <= 100) {
      partial = { percent: Number(trimmed) };
    } else {
      partial = { label: trimmed };
    }
    void addTaskOccurrence(task.id, partial);
    setDraft('');
  };

  const toggle = (occ: TaskOccurrence) => {
    if (occ.status === 'done') {
      void reopenTaskOccurrence(occ.id);
    } else {
      void completeTaskOccurrence(occ.id);
    }
  };

  const doneCount = items.filter((it) => it.status === 'done').length;

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          切分
        </span>
        {items.length > 0 && (
          <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
            {doneCount}/{items.length}
          </span>
        )}
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((occ) => (
            <OccurrenceRow
              key={occ.id}
              task={task}
              occurrence={occ}
              railsMap={railsMap}
              onToggle={() => toggle(occ)}
              onUpdate={(patch) => void updateTaskOccurrence(occ.id, patch)}
              onSchedule={(slot) => void scheduleTaskOccurrence(occ.id, slot)}
              onRemove={() => void removeTaskOccurrence(occ.id)}
              ime={ime}
            />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 rounded-md border border-hairline/60 bg-surface-0 px-2.5 py-1 focus-within:border-ink-secondary">
        <Plus className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" strokeWidth={1.6} />
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            items.length === 0
              ? '+ 切分 · 步骤名，或直接填进度数字 0-100 · 回车 (留空也行)'
              : '继续加一个 · 名字或进度数字 · Enter'
          }
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !ime.isComposing(e)) {
              e.preventDefault();
              addOccurrence();
            }
          }}
          className="h-6 flex-1 bg-transparent text-xs text-ink-primary outline-none placeholder:text-ink-tertiary"
        />
      </div>
    </div>
  );
}

function OccurrenceRow({
  task,
  occurrence,
  railsMap,
  onToggle,
  onUpdate,
  onSchedule,
  onRemove,
  ime,
}: {
  task: Task;
  occurrence: TaskOccurrence;
  railsMap: Record<string, Rail>;
  onToggle: () => void;
  onUpdate: (patch: Partial<Omit<TaskOccurrence, 'id' | 'taskId'>>) => void;
  onSchedule: (
    slot: { cycleId: string; date: string; railId: string } | null,
  ) => void;
  onRemove: () => void;
  ime: ReturnType<typeof useIme>;
}) {
  const [editingLabel, setEditingLabel] = useState(occurrence.label ?? '');
  const [editingPercent, setEditingPercent] = useState(
    occurrence.percent != null ? String(occurrence.percent) : '',
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  // ERD §10.6 v0.12.2 — per-occurrence note disclosure. Collapsed by
  // default; the StickyNote icon lights up when a note exists so the
  // dense row doesn't have to surface the body. Clicking expands an
  // inline MarkdownField (same component / fullscreen support as the
  // Task note) below the row.
  const [noteOpen, setNoteOpen] = useState(false);
  const hasNote = !!occurrence.note && occurrence.note.trim().length > 0;

  // Sync controlled inputs when the upstream occurrence changes (e.g.
  // CRDT pull from another device). Only resync when the value
  // genuinely differs to avoid clobbering the user's mid-edit text.
  useEffect(() => {
    setEditingLabel(occurrence.label ?? '');
  }, [occurrence.label]);
  useEffect(() => {
    setEditingPercent(occurrence.percent != null ? String(occurrence.percent) : '');
  }, [occurrence.percent]);

  // ERD §10.6 — percent is a milestone marker, NOT a done flag.
  // The checkbox reflects status only; setting percent=100 does
  // not auto-complete the occurrence.
  const isDone = occurrence.status === 'done';

  const commitLabel = () => {
    const trimmed = editingLabel.trim();
    const next = trimmed.length > 0 ? trimmed : undefined;
    if (next === occurrence.label) return;
    onUpdate({ label: next });
  };

  const commitPercent = () => {
    const trimmed = editingPercent.trim();
    if (trimmed === '') {
      if (occurrence.percent != null) onUpdate({ percent: undefined });
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (Number.isNaN(n)) return;
    const clamped = Math.max(0, Math.min(100, n));
    if (clamped === occurrence.percent) return;
    onUpdate({ percent: clamped });
  };

  const commitNote = (next: string | undefined) => {
    const normalized = next && next.trim() ? next.trim() : undefined;
    if ((occurrence.note ?? undefined) === normalized) return;
    onUpdate({ note: normalized });
  };

  const slotChip = (() => {
    if (!occurrence.slot) {
      return (
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="rounded-md px-1.5 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          未排
        </button>
      );
    }
    const rail = railsMap[occurrence.slot.railId];
    const railLabel = rail?.name ?? occurrence.slot.railId;
    return (
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-2xs tabular-nums text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
      >
        <CalendarIcon className="h-2.5 w-2.5" strokeWidth={1.6} />
        <span>{occurrence.slot.date}</span>
        <span className="text-ink-tertiary">·</span>
        <span className="truncate max-w-[80px]">{railLabel}</span>
      </button>
    );
  })();

  return (
    <li className="group flex flex-col gap-1 rounded-md px-1.5 py-1 transition hover:bg-surface-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={isDone ? 'Reopen occurrence' : 'Mark occurrence done'}
          className="shrink-0 text-ink-tertiary transition hover:text-ink-primary"
        >
          {isDone ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
          ) : (
            <Circle className="h-3.5 w-3.5" strokeWidth={1.6} />
          )}
        </button>
        <input
          type="text"
          value={editingLabel}
          onChange={(e) => setEditingLabel(e.target.value)}
          onBlur={commitLabel}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !ime.isComposing(e)) {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={task.title || '步骤'}
          className={clsx(
            'h-6 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm outline-none transition focus:bg-surface-0',
            isDone
              ? 'text-ink-tertiary line-through decoration-ink-tertiary/40'
              : 'text-ink-primary',
          )}
        />
        <input
          type="number"
          min={0}
          max={100}
          value={editingPercent}
          onChange={(e) => setEditingPercent(e.target.value)}
          onBlur={commitPercent}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="%"
          className="h-6 w-12 rounded-sm bg-transparent px-1 text-right font-mono text-2xs tabular-nums text-ink-secondary outline-none transition focus:bg-surface-0 placeholder:text-ink-tertiary"
        />
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          aria-label={hasNote ? 'Edit occurrence note' : 'Add occurrence note'}
          title={hasNote ? '备注' : '添加备注'}
          className={clsx(
            'rounded-sm p-0.5 transition hover:bg-surface-2 hover:text-ink-primary',
            hasNote
              ? 'text-ink-secondary'
              : 'text-ink-tertiary opacity-0 group-hover:opacity-100',
            noteOpen && 'bg-surface-2 text-ink-primary opacity-100',
          )}
        >
          <StickyNote className="h-3 w-3" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Delete occurrence"
          className="rounded-sm p-0.5 text-ink-tertiary opacity-0 transition hover:bg-surface-2 hover:text-ink-primary group-hover:opacity-100"
        >
          <X className="h-3 w-3" strokeWidth={1.8} />
        </button>
      </div>
      {/* Schedule pill on its own line, indented to align under the name
          (pl matches the checkbox + gap = note-editor indent). Keeps the
          name input at full flex-1 width so long slice labels stay legible
          instead of being crushed by the date·rail chip. */}
      <div className="pl-[1.375rem]">{slotChip}</div>
      {noteOpen && (
        <div className="pl-[1.375rem] pr-1">
          <MarkdownField
            value={occurrence.note}
            onCommit={commitNote}
            placeholder="+ 添加备注 · Markdown"
            dialogTitle={`${occurrence.label?.trim() || task.title || '切分'} · 备注`}
            ariaLabel="切分备注"
            displayMaxHeight="12rem"
          />
        </div>
      )}
      {pickerOpen && (
        <OccurrenceSlotPicker
          occurrence={occurrence}
          railsMap={railsMap}
          onApply={(slot) => {
            onSchedule(slot);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </li>
  );
}

/** Inline slot picker for a task occurrence. Date input + RailPicker
 *  (narrow + fallback group per ERD §5.5.2) + clear / cancel / apply.
 *
 *  v0.11.5 — swapped the previous native `<select>` for RailPicker so
 *  occurrence scheduling inherits the same narrow-to-resolved-template
 *  + collapsed-fallback behavior as SchedulePopover (ERD §10.6 v0.11.5
 *  修正纪要). Stripped-down vs SchedulePopover: no Mode B / free-time —
 *  occurrences in v0.11 use rail slots only. */
function OccurrenceSlotPicker({
  occurrence,
  railsMap,
  onApply,
  onCancel,
}: {
  occurrence: TaskOccurrence;
  railsMap: Record<string, Rail>;
  onApply: (
    slot: { cycleId: string; date: string; railId: string } | null,
  ) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(
    occurrence.slot?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [railId, setRailId] = useState(occurrence.slot?.railId ?? '');

  const templatesMap = useStore((s) => s.templates);

  // ERD §6.7.9 — date decides the template; scope rails to it.
  const resolvedTemplateKey = useResolvedTemplateKey(date);

  const allRails = useMemo(
    () =>
      Object.values(railsMap).sort(
        (a, b) => a.startMinutes - b.startMinutes,
      ),
    [railsMap],
  );
  const railsInScope = useMemo(
    () =>
      resolvedTemplateKey
        ? allRails.filter((r) => r.templateKey === resolvedTemplateKey)
        : allRails,
    [allRails, resolvedTemplateKey],
  );
  useEffect(() => {
    if (!railId || !resolvedTemplateKey) return;
    const r = railsMap[railId];
    if (r && r.templateKey !== resolvedTemplateKey) setRailId('');
  }, [resolvedTemplateKey, railId, railsMap]);

  const canApply = Boolean(date) && Boolean(railId);

  return (
    <div className="ml-6 flex flex-wrap items-center gap-2 rounded-md border border-hairline/60 bg-surface-0 px-2 py-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-6 rounded-sm border border-hairline/60 bg-surface-0 px-1.5 text-2xs text-ink-primary outline-none focus:border-ink-secondary"
      />
      {resolvedTemplateKey && (
        <span className="text-2xs text-ink-tertiary">
          {templatesMap[resolvedTemplateKey]?.name ?? resolvedTemplateKey}
        </span>
      )}
      <RailPicker
        rails={railsInScope}
        templates={templatesMap}
        value={railId}
        onChange={setRailId}
        flat={!!resolvedTemplateKey}
        usageDate={date}
        className="h-6 max-w-[200px] py-0 text-2xs"
      />
      <div className="ml-auto flex items-center gap-1">
        {occurrence.slot && (
          <button
            type="button"
            onClick={() => onApply(null)}
            className="rounded-sm px-1.5 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            清除
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm px-1.5 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          取消
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => {
            if (!canApply) return;
            onApply({ cycleId: `cycle-${date}`, date, railId });
          }}
          className={clsx(
            'rounded-sm px-1.5 py-0.5 text-2xs transition',
            canApply
              ? 'bg-ink-primary text-surface-0 hover:bg-ink-secondary'
              : 'cursor-not-allowed bg-surface-2 text-ink-tertiary',
          )}
        >
          应用
        </button>
      </div>
    </div>
  );
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function HabitPhasePanel({ lineId }: { lineId: string }) {
  const habitPhasesMap = useStore((s) => s.habitPhases);
  const upsertHabitPhase = useStore((s) => s.upsertHabitPhase);
  const removeHabitPhase = useStore((s) => s.removeHabitPhase);
  const phases = useMemo(
    () => selectHabitPhasesByLine({ habitPhases: habitPhasesMap }, lineId),
    [habitPhasesMap, lineId],
  );
  const todayIso = useMemo(() => toIsoDateStr(new Date()), []);
  const currentPhaseId = useMemo(
    () =>
      selectCurrentHabitPhase({ habitPhases: habitPhasesMap }, lineId, todayIso)
        ?.id,
    [habitPhasesMap, lineId, todayIso],
  );

  const [formMode, setFormMode] = useState<null | 'new' | string>(null);
  const editingPhase = phases.find((p) => p.id === formMode);

  if (phases.length === 0) {
    return (
      <section className="flex flex-col gap-3 rounded-md bg-surface-1 px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Phase tracking
          </span>
          <p className="text-sm text-ink-secondary">
            这条 habit 目前按固定节奏运行。如果你有阶段性目标（比如训练比赛、
            分期提量），可以启用 phase 追踪，按时间段记录不同阶段的目标。
          </p>
        </div>
        {formMode === 'new' ? (
          <PhaseForm
            lineId={lineId}
            onSubmit={async (opts) => {
              await upsertHabitPhase(opts);
              setFormMode(null);
            }}
            onCancel={() => setFormMode(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setFormMode('new')}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-dashed border-ink-tertiary/50 px-3 py-1.5 text-xs text-ink-secondary transition hover:border-ink-secondary hover:text-ink-primary"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
            启用 phase 追踪
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-md bg-surface-1 px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Phases
        </span>
        {formMode !== 'new' && (
          <button
            type="button"
            onClick={() => setFormMode('new')}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink-tertiary/40 px-2 py-0.5 text-xs text-ink-tertiary transition hover:border-ink-secondary hover:text-ink-secondary"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
            新 phase
          </button>
        )}
      </div>

      {formMode === 'new' && (
        <PhaseForm
          lineId={lineId}
          onSubmit={async (opts) => {
            await upsertHabitPhase(opts);
            setFormMode(null);
          }}
          onCancel={() => setFormMode(null)}
        />
      )}

      <ul className="flex flex-col gap-1.5">
        {phases.map((p) => {
          const isCurrent = p.id === currentPhaseId;
          const isFuture = p.startDate > todayIso;
          if (editingPhase?.id === p.id) {
            return (
              <li key={p.id}>
                <PhaseForm
                  lineId={lineId}
                  initial={{
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    startDate: p.startDate,
                  }}
                  onSubmit={async (opts) => {
                    await upsertHabitPhase(opts);
                    setFormMode(null);
                  }}
                  onCancel={() => setFormMode(null)}
                />
              </li>
            );
          }
          return (
            <li
              key={p.id}
              className={clsx(
                'flex items-start justify-between gap-2 rounded-md bg-surface-0 px-3 py-2',
                isCurrent && 'ring-1 ring-inset ring-ink-primary/20',
                isFuture && 'opacity-70',
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="truncate text-sm text-ink-primary">
                    {p.name}
                  </span>
                  {isCurrent && (
                    <span className="rounded-sm bg-ink-primary px-1 font-mono text-[9px] uppercase tracking-widest text-surface-0">
                      当前
                    </span>
                  )}
                  {isFuture && (
                    <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                      计划于 {p.startDate}
                    </span>
                  )}
                  {!isFuture && !isCurrent && (
                    <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                      起 {p.startDate}
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="text-xs text-ink-secondary">
                    {p.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Edit phase"
                  onClick={() => setFormMode(p.id)}
                  className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
                >
                  <Pencil className="h-3 w-3" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  aria-label="Delete phase"
                  onClick={() => void removeHabitPhase(p.id)}
                  className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
                >
                  <X className="h-3 w-3" strokeWidth={1.8} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PhaseForm({
  lineId,
  initial,
  onSubmit,
  onCancel,
}: {
  lineId: string;
  initial?: {
    id: string;
    name: string;
    description?: string;
    startDate: string;
  };
  onSubmit: (opts: {
    id?: string;
    lineId: string;
    name: string;
    description?: string;
    startDate: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startDate, setStartDate] = useState(
    initial?.startDate ?? new Date().toISOString().slice(0, 10),
  );
  const ime = useIme();
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || !startDate) return;
    void onSubmit({
      ...(initial?.id && { id: initial.id }),
      lineId,
      name: trimmed,
      startDate,
      ...(description.trim() && { description: description.trim() }),
    });
  };
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-0 p-3">
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-20">名称</span>
        <input
          type="text"
          value={name}
          autoFocus
          placeholder="例：基础期"
          onChange={(e) => setName(e.target.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !ime.isComposing(e)) {
              e.preventDefault();
              submit();
            }
          }}
          className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
        />
      </label>
      <label className="flex items-start gap-2 text-xs text-ink-secondary">
        <span className="w-20 pt-1">目标</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="可选：例：每周 3 次 30 分钟慢跑"
          rows={2}
          className="flex-1 resize-none rounded-sm border border-hairline/60 bg-surface-0 px-2 py-1 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-20">开始日期</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 font-mono text-xs text-ink-primary outline-none focus:border-ink-secondary"
        />
      </label>
      <div className="flex items-center justify-end gap-1.5 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-sm bg-ink-primary px-2 py-0.5 text-2xs text-surface-0 transition hover:bg-ink-primary/90"
        >
          保存
        </button>
      </div>
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
  shiftsMap,
  onToggleDone,
  onArchive,
  onRestore,
  onDelete,
  onPurge,
  onOpenDetail,
}: {
  openTasks: Task[];
  doneTasks: Task[];
  searchActive: boolean;
  selection: Selection;
  hasQuery: boolean;
  linesMap: Record<string, Line>;
  shiftsMap: Record<string, Shift>;
  onToggleDone: (task: Task) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  onDelete: (task: Task) => void;
  onPurge: (task: Task) => void;
  onOpenDetail?: (task: Task) => void;
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
    shiftsMap,
    onToggleDone,
    onArchive,
    onRestore,
    onDelete,
    onPurge,
    ...(onOpenDetail && { onOpenDetail }),
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
  onOpenDetail,
  isTrash,
  isArchived,
  shiftsMap,
}: {
  tasks: Task[];
  linesMap: Record<string, Line>;
  showProjectPill: boolean;
  onToggleDone: (task: Task) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  onDelete: (task: Task) => void;
  onPurge: (task: Task) => void;
  onOpenDetail?: (task: Task) => void;
  isTrash: boolean;
  isArchived: boolean;
  shiftsMap: Record<string, Shift>;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskRow
            task={task}
            line={showProjectPill ? linesMap[task.lineId] : undefined}
            tags={latestTagsForTask(task.id, shiftsMap)}
            onToggleDone={() => onToggleDone(task)}
            onArchive={() => onArchive(task)}
            onRestore={() => onRestore(task)}
            onDelete={() => onDelete(task)}
            onPurge={() => onPurge(task)}
            {...(onOpenDetail && {
              onOpenDetail: () => onOpenDetail(task),
            })}
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
  tags,
  onToggleDone,
  onArchive,
  onRestore,
  onDelete,
  onPurge,
  onOpenDetail,
  isTrash,
  isArchived,
}: {
  task: Task;
  line: Line | undefined;
  tags: string[];
  onToggleDone: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onPurge: () => void;
  onOpenDetail?: () => void;
  isTrash: boolean;
  isArchived: boolean;
}) {
  // ERD §10.6 — derive status/progress from occurrences. For an
  // occurrence-managed task the raw `task.status` / `milestonePercent`
  // are stale (the store never writes them back), so done-ness,
  // strikethrough, and the milestone badge must all read the rollup.
  // `taskIsManaged` also drives v0.11.5's task-level Schedule hiding.
  const taskOccurrencesMap = useStore((s) => s.taskOccurrences);
  const occs = useMemo(
    () =>
      selectOccurrencesForTask({ taskOccurrences: taskOccurrencesMap }, task.id),
    [taskOccurrencesMap, task.id],
  );
  const taskIsManaged = isOccurrenceManaged(occs);
  const effectiveStatus = deriveTaskStatus(task, occs);
  const effectiveProgress = deriveTaskProgress(task, occs);
  const isDone = effectiveStatus === 'done';
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
      {showStatusToggle &&
        (taskIsManaged ? (
          // ERD §10.6 — completion of an occurrence-managed task is
          // derived from its occurrences; a task-level toggle would
          // write the (ignored) raw status and appear to do nothing.
          // Show the derived status read-only and route completion to
          // the detail drawer's 切分 section (mirrors v0.11.5 disabling
          // the task-level Schedule entry).
          <span
            aria-label="已切分 · 在任务详情里逐条完成"
            title="已切分 · 在任务详情里逐条完成"
            className="shrink-0 text-ink-tertiary"
          >
            <StatusIcon status={effectiveStatus} />
          </span>
        ) : (
          <button
            type="button"
            onClick={onToggleDone}
            aria-label={isDone ? 'Mark as open' : 'Mark as done'}
            className="shrink-0 transition hover:text-ink-primary"
          >
            <StatusIcon status={effectiveStatus} />
          </button>
        ))}

      <button
        type="button"
        onClick={onOpenDetail}
        disabled={!onOpenDetail}
        className={clsx(
          'flex min-w-0 flex-1 flex-col gap-0.5 text-left',
          onOpenDetail && 'cursor-pointer',
        )}
      >
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
          {effectiveProgress != null && (
            <span className="font-mono text-2xs tabular-nums text-ink-secondary">
              · milestone {effectiveProgress}%
            </span>
          )}
          <TaskOccurrenceCountBadge taskId={task.id} />
          {/* Legacy `task.subItems` count removed — occurrences are the
              v0.11+ source of truth. The migration auto-maps subItems
              into occurrences at hydrate, so historical data is reflected. */}
          {tags.length > 0 && (isDone || isArchived || effectiveStatus === 'deferred') && (
            <span className="flex items-center gap-1">
              {tags.map((tag) => (
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
      </button>

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
            {!taskIsManaged && (
              <SchedulePopover task={task}>
                <IconActionButton
                  label="排期"
                  icon={
                    <CalendarIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  }
                />
              </SchedulePopover>
            )}
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
  // §10.5 Phase 3 · the rail label resolves via railAtDate(slot.date)
  // so a past slot shows the rail's name as it was on that date.
  const railRevisions = useStore((s) => s.railRevisions);
  const railTombstones = useStore((s) => s.railTombstones);
  const adhocs = useStore((s) => s.adhocEvents);

  if (task.slot) {
    const rev = railAtDate(
      { railRevisions, railTombstones },
      task.slot.railId,
      task.slot.date,
    );
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums text-ink-secondary">
        <CalendarIcon className="h-2.5 w-2.5" strokeWidth={1.8} />
        {task.slot.date.slice(5)}
        <span className="text-ink-tertiary">·</span>
        {rev?.name ?? task.slot.railId}
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

// minutesToHHMM is defined earlier next to OccurrenceSlotPicker.

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

