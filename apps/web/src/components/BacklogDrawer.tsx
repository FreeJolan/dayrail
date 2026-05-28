import { clsx } from 'clsx';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDraggable } from '@dnd-kit/core';
import {
  INBOX_LINE_ID,
  useStore,
  type Line,
  type Task,
  type TaskOccurrence,
} from '@dayrail/core';
import {
  backlogItemId,
  backlogItemTitle,
  selectBacklogItems,
  type BacklogItem,
} from '@/pages/cycleFromStore';
import { useDragMirror } from '@/lib/dragMirror';
import { TaskDetailDrawer } from '@/pages/Tasks';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';
import { RAIL_COLOR_HEX } from './railColors';
import { useIme } from '@/lib/ime';

// ERD §5.3 D8 — split drawer docked on the right. Items are un-
// scheduled Tasks waiting to be dragged onto a Cycle slot.
//
// Chunk 2 of the Cycle-View wire-up: reads live tasks from the store
// via `selectBacklogTasks` (open-status tasks with no slot + no
// active Ad-hoc). Drag-drop itself ships in chunk 3.

interface Props {
  open: boolean;
  onToggle: () => void;
}

type BacklogGroupBy = 'none' | 'priority' | 'project';

export function BacklogDrawer({ open, onToggle }: Props) {
  const tasksMap = useStore((s) => s.tasks);
  const taskOccurrencesMap = useStore((s) => s.taskOccurrences);
  const linesMap = useStore((s) => s.lines);
  const adhocEventsMap = useStore((s) => s.adhocEvents);
  const createTask = useStore((s) => s.createTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [groupBy, setGroupBy] = useState<BacklogGroupBy>('none');
  // Per-group collapse state. Lives in component state (not store) —
  // backlog is a session-scoped tool surface; on next open the user
  // gets a fresh fully-expanded view, which fits the "no hidden
  // state" stance. Keys re-namespace by groupBy so flipping mode
  // doesn't leak collapse from one dimension to another.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Reset whenever the grouping dimension changes — same key string
  // can mean different things across modes.
  useEffect(() => {
    setCollapsed(new Set());
  }, [groupBy]);
  const [detailTarget, setDetailTarget] = useState<{
    taskId: string;
    occurrenceId?: string;
    requestId: number;
  } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Task | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const onCyclePage = location.pathname === '/cycle';

  const handleQuickCreate = async (title: string, lineId: string) => {
    // Writes a pending task with no slot. Line defaults to Inbox but
    // the picker lets the user route to any active Project. Habits
    // are excluded — they don't accept hand-built tasks (§5.5.0).
    const maxOrder = Object.values(tasksMap)
      .filter((t) => t.lineId === lineId)
      .reduce((m, t) => Math.max(m, t.order), 0);
    await createTask({
      id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      lineId,
      title,
      order: maxOrder + 1,
      status: 'pending',
    });
    setAdding(false);
  };
  const openDetail = (taskId: string, occurrenceId?: string) => {
    setDetailTarget((prev) => ({
      taskId,
      ...(occurrenceId && { occurrenceId }),
      requestId: (prev?.requestId ?? 0) + 1,
    }));
  };
  const handleDeleteTask = (task: Task) => {
    setDeleteCandidate(task);
  };
  const confirmDeleteTask = () => {
    if (!deleteCandidate) return;
    void deleteTask(deleteCandidate.id);
    setDetailTarget((prev) =>
      prev?.taskId === deleteCandidate.id ? null : prev,
    );
    setDeleteCandidate(null);
  };

  // ERD §10.6 v0.11 — items are a discriminated union: either a bare
  // legacy Task, or a single TaskOccurrence (with its parent Task).
  // Title / note search and grouping operate on the parent Task's
  // fields (priority, lineId), with the title fallback going through
  // `backlogItemTitle` so occurrence labels surface correctly.
  const allItems = useMemo(
    () =>
      selectBacklogItems({
        tasks: tasksMap,
        taskOccurrences: taskOccurrencesMap,
        adhocEvents: adhocEventsMap,
      }),
    [tasksMap, taskOccurrencesMap, adhocEventsMap],
  );

  // dnd-kit "multipleContainers" pattern — when a backlog row is being
  // dragged AND its active has entered some cycle cell (mirror.activeCellKey
  // is set), the destination cell is rendering a SortableTaskPillRow for
  // the SAME id. Two registrations of one id in dnd-kit's manager → the
  // newer one (cell) "captures" the active and the source registration
  // is left orphaned; if the user then drops outside the cell the source
  // can never re-arm. Fix: unmount the source row during cross-container
  // drag so dnd-kit transfers the active cleanly to the cell. We DON'T
  // filter when activeCellKey is null (drag just started, hasn't entered
  // a cell yet) — keeping the source mounted ensures dnd-kit has the
  // initial registration anchored.
  const { mirror } = useDragMirror();
  const items = useMemo(() => {
    if (!mirror?.activeId || !mirror.activeCellKey) return allItems;
    const activeId = mirror.activeId;
    return allItems.filter((it) => backlogItemId(it) !== activeId);
  }, [allItems, mirror?.activeId, mirror?.activeCellKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      if (backlogItemTitle(it).toLowerCase().includes(q)) return true;
      if (it.task.note?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [items, query]);

  // ERD §10.6 v0.11 — group runs of consecutive same-task occurrence
  // rows into a compound visual ("split-task" card with parent header
  // + per-occurrence sub-rows). Single legacy task rows render as the
  // existing simple card. The selectBacklogItems sort already keeps
  // same-task occurrences adjacent (priority + task.order ties), and
  // priority/project bucketing doesn't break that invariant since
  // occurrences inherit their parent's priority/lineId.
  type BacklogVisualGroup =
    | { kind: 'single-task'; task: Task; item: Extract<BacklogItem, { kind: 'task' }> }
    | {
        kind: 'split-task';
        task: Task;
        occurrences: Array<Extract<BacklogItem, { kind: 'occurrence' }>>;
      };
  const visuallyGroup = (rows: BacklogItem[]): BacklogVisualGroup[] => {
    const out: BacklogVisualGroup[] = [];
    let i = 0;
    while (i < rows.length) {
      const first = rows[i]!;
      if (first.kind === 'task') {
        out.push({ kind: 'single-task', task: first.task, item: first });
        i++;
        continue;
      }
      const taskId = first.task.id;
      const occs: Array<Extract<BacklogItem, { kind: 'occurrence' }>> = [];
      while (
        i < rows.length &&
        rows[i]!.kind === 'occurrence' &&
        rows[i]!.task.id === taskId
      ) {
        occs.push(rows[i] as Extract<BacklogItem, { kind: 'occurrence' }>);
        i++;
      }
      out.push({ kind: 'split-task', task: first.task, occurrences: occs });
    }
    return out;
  };

  // Backlog can be viewed flat or broken into sections. Group order
  // is deterministic so the drawer doesn't jitter across edits:
  //   - priority: P0 → P1 → P2 → 未设置 (priority lives on the parent Task)
  //   - project:  Inbox first (pinned), then Lines by name
  const groups = useMemo<
    Array<{ key: string; label: string; items: BacklogItem[] }>
  >(() => {
    if (groupBy === 'none' || filtered.length === 0) return [];
    if (groupBy === 'priority') {
      const buckets = new Map<string, BacklogItem[]>();
      const order = ['P0', 'P1', 'P2', '__none'];
      for (const k of order) buckets.set(k, []);
      for (const it of filtered) {
        const key = it.task.priority ?? '__none';
        buckets.get(key)!.push(it);
      }
      return order
        .filter((k) => (buckets.get(k) ?? []).length > 0)
        .map((k) => ({
          key: k,
          label: k === '__none' ? '未设优先级' : k,
          items: buckets.get(k)!,
        }));
    }
    // groupBy === 'project'
    const byLine = new Map<string, BacklogItem[]>();
    for (const it of filtered) {
      const arr = byLine.get(it.task.lineId) ?? [];
      arr.push(it);
      byLine.set(it.task.lineId, arr);
    }
    const entries = [...byLine.entries()];
    entries.sort(([a], [b]) => {
      if (a === INBOX_LINE_ID) return -1;
      if (b === INBOX_LINE_ID) return 1;
      const nameA = linesMap[a]?.name ?? a;
      const nameB = linesMap[b]?.name ?? b;
      return nameA.localeCompare(nameB);
    });
    return entries.map(([lineId, items]) => ({
      key: lineId,
      label: linesMap[lineId]?.name ?? '未知项目',
      items,
    }));
  }, [filtered, groupBy, linesMap]);

  return (
    <aside
      aria-label="Backlog drawer"
      className={clsx(
        // mr-6 keeps the drawer from pressing flush against the viewport
        // edge regardless of open / collapsed state.
        'sticky top-0 mr-6 flex h-screen shrink-0 flex-col rounded-l-md bg-surface-1 transition-[width] duration-200',
        open ? 'w-[320px]' : 'w-[48px]',
      )}
    >
      <div
        className={clsx(
          'flex h-[52px] items-center',
          open ? 'gap-2 px-4' : 'justify-center',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Collapse backlog' : 'Expand backlog'}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          {open ? (
            <PanelRightClose className="h-4 w-4" strokeWidth={1.6} />
          ) : (
            <PanelRightOpen className="h-4 w-4" strokeWidth={1.6} />
          )}
        </button>
        {open && (
          <>
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
              Backlog
            </span>
            <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
              {items.length}
            </span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              aria-label="新建任务"
              title="新建任务到 Inbox"
              className={clsx(
                'inline-flex h-7 w-7 items-center justify-center rounded-md transition',
                adding
                  ? 'bg-surface-2 text-ink-primary'
                  : 'text-ink-tertiary hover:bg-surface-2 hover:text-ink-primary',
              )}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      {open && (
        <>
          {adding && (
            <div className="px-4 pb-3">
              <QuickCreateInput
                linesMap={linesMap}
                onSubmit={handleQuickCreate}
                onCancel={() => setAdding(false)}
              />
            </div>
          )}

          <div className="px-4 pb-2">
            <label className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5">
              <Search
                className="h-3.5 w-3.5 text-ink-tertiary"
                strokeWidth={1.6}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="找一个任务…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-tertiary"
              />
            </label>
          </div>

          <div className="flex items-center gap-1.5 px-4 pb-3">
            <span className="shrink-0 whitespace-nowrap font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              分组
            </span>
            <div className="min-w-0 shrink">
              <GroupBySwitch value={groupBy} onChange={setGroupBy} />
            </div>
            {groupBy !== 'none' && groups.length > 0 && (() => {
              const allCollapsed = groups.every((g) => collapsed.has(g.key));
              return (
                <button
                  type="button"
                  onClick={() => {
                    setCollapsed(
                      allCollapsed
                        ? new Set()
                        : new Set(groups.map((g) => g.key)),
                    );
                  }}
                  aria-label={allCollapsed ? '展开全部' : '折叠全部'}
                  title={allCollapsed ? '展开全部' : '折叠全部'}
                  className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
                >
                  {allCollapsed ? (
                    <ChevronsDownUp
                      className="h-3.5 w-3.5 rotate-180"
                      strokeWidth={1.8}
                    />
                  ) : (
                    <ChevronsDownUp className="h-3.5 w-3.5" strokeWidth={1.8} />
                  )}
                </button>
              );
            })()}
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-6 text-sm text-ink-tertiary">
              {query.trim()
                ? '没有匹配的任务'
                : '所有任务都已排期或归档 —— 在 Tasks 视图里建几个试试。'}
            </div>
          ) : groupBy === 'none' ? (
            <ul className="flex-1 overflow-y-auto px-2">
              {visuallyGroup(filtered).map((g) => (
                <li
                  key={
                    g.kind === 'single-task'
                      ? backlogItemId(g.item)
                      : `split-${g.task.id}`
                  }
                  className="px-2 py-1"
                >
                  {g.kind === 'single-task' ? (
                    <BacklogCard
                      item={g.item}
                      projectName={linesMap[g.task.lineId]?.name}
                      projectColor={linesMap[g.task.lineId]?.color}
                      onOpen={() => openDetail(g.task.id)}
                      onDelete={() => handleDeleteTask(g.task)}
                    />
                  ) : (
                    <BacklogTaskGroupCard
                      task={g.task}
                      occurrences={g.occurrences}
                      projectName={linesMap[g.task.lineId]?.name}
                      projectColor={linesMap[g.task.lineId]?.color}
                      onOpen={() => openDetail(g.task.id)}
                      onOpenOccurrence={(occurrenceId) =>
                        openDetail(g.task.id, occurrenceId)
                      }
                      onDelete={() => handleDeleteTask(g.task)}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex-1 overflow-y-auto px-2">
              {groups.map((g) => {
                const isCollapsed = collapsed.has(g.key);
                return (
                  <section key={g.key} className="pb-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.key)) next.delete(g.key);
                          else next.add(g.key);
                          return next;
                        });
                      }}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-baseline gap-2 rounded-sm px-2 pb-1 pt-1 text-left transition hover:bg-surface-2"
                    >
                      {isCollapsed ? (
                        <ChevronRight
                          aria-hidden
                          className="h-3 w-3 self-center text-ink-tertiary"
                          strokeWidth={1.8}
                        />
                      ) : (
                        <ChevronDown
                          aria-hidden
                          className="h-3 w-3 self-center text-ink-tertiary"
                          strokeWidth={1.8}
                        />
                      )}
                      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                        {g.label}
                      </span>
                      <span className="font-mono text-2xs tabular-nums text-ink-tertiary/70">
                        {g.items.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <ul className="flex flex-col">
                        {visuallyGroup(g.items).map((vg) => (
                          <li
                            key={
                              vg.kind === 'single-task'
                                ? backlogItemId(vg.item)
                                : `split-${vg.task.id}`
                            }
                            className="px-2 py-1"
                          >
                            {vg.kind === 'single-task' ? (
                              <BacklogCard
                                item={vg.item}
                                projectName={linesMap[vg.task.lineId]?.name}
                                projectColor={linesMap[vg.task.lineId]?.color}
                                onOpen={() => openDetail(vg.task.id)}
                                onDelete={() => handleDeleteTask(vg.task)}
                              />
                            ) : (
                              <BacklogTaskGroupCard
                                task={vg.task}
                                occurrences={vg.occurrences}
                                projectName={linesMap[vg.task.lineId]?.name}
                                projectColor={linesMap[vg.task.lineId]?.color}
                                onOpen={() => openDetail(vg.task.id)}
                                onOpenOccurrence={(occurrenceId) =>
                                  openDetail(vg.task.id, occurrenceId)
                                }
                                onDelete={() => handleDeleteTask(vg.task)}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <div className="hairline-t px-4 py-3">
            {onCyclePage ? (
              <>
                <p className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  Drag → day cell
                </p>
                <p className="mt-1 text-xs text-ink-tertiary">
                  把任务拖到左侧某天某条 Rail 的格子上即可排期。
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  Drag only on Cycle
                </p>
                <p className="mt-1 text-xs text-ink-tertiary">
                  当前页面没有 drop 目标 —— 切到 Cycle 视图才能拖动排期。
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/cycle')}
                  className="mt-2 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-mono text-2xs uppercase tracking-widest text-ink-secondary transition hover:text-ink-primary"
                >
                  去 Cycle
                  <ArrowRight className="h-3 w-3" strokeWidth={1.8} />
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Portal the detail drawer out to document.body. The aside is
          `position: sticky top-0` which creates a stacking context;
          rendering TaskDetailDrawer as a descendant traps its
          `fixed / z-50` backdrop + panel inside that local layer
          (invisible/un-clickable). Portal resolves against the
          document root so the drawer lands where it should. */}
      {detailTarget &&
        tasksMap[detailTarget.taskId] &&
        createPortal(
          <TaskDetailDrawer
            task={tasksMap[detailTarget.taskId]!}
            line={linesMap[tasksMap[detailTarget.taskId]!.lineId]}
            highlightOccurrenceId={detailTarget.occurrenceId}
            highlightRequestId={detailTarget.requestId}
            onClose={() => setDetailTarget(null)}
          />,
          document.body,
        )}
      {deleteCandidate &&
        createPortal(
          <BacklogDeleteConfirm
            task={deleteCandidate}
            onCancel={() => setDeleteCandidate(null)}
            onConfirm={confirmDeleteTask}
          />,
          document.body,
        )}
    </aside>
  );
}

function BacklogDeleteConfirm({
  task,
  onCancel,
  onConfirm,
}: {
  task: Task;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`删除任务 · ${task.title}`}
      className="fixed inset-0 z-[260] flex items-center justify-center bg-ink-primary/35 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-md bg-surface-0 shadow-xl">
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Backlog
            </span>
            <p className="text-base text-ink-primary">
              删除「{task.title || '未命名任务'}」？
            </p>
            <p className="text-xs leading-relaxed text-ink-secondary">
              会移到回收站，可以从 Tasks → 回收站恢复。
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-2 text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md bg-ink-primary px-3 py-2 text-sm font-medium text-surface-0 transition hover:bg-red-500"
            >
              移到回收站
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupBySwitch({
  value,
  onChange,
}: {
  value: BacklogGroupBy;
  onChange: (v: BacklogGroupBy) => void;
}) {
  const opts: Array<{ key: BacklogGroupBy; label: string }> = [
    { key: 'none', label: 'None' },
    { key: 'priority', label: 'Priority' },
    { key: 'project', label: 'Project' },
  ];
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-sm border border-hairline/60">
      {opts.map((o, i) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={clsx(
              'px-2 py-0.5 font-mono text-2xs tabular-nums transition',
              i > 0 && 'border-l border-hairline/60',
              active
                ? 'bg-surface-2 text-ink-primary'
                : 'text-ink-tertiary hover:bg-surface-2/70 hover:text-ink-primary',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// (Drag MIME removed in the dnd-kit migration — drag IDs now flow
// through `active.id` + `data.type === 'task'` instead of HTML5
// dataTransfer payloads.)

function QuickCreateInput({
  linesMap,
  onSubmit,
  onCancel,
}: {
  linesMap: Record<string, Line>;
  onSubmit: (title: string, lineId: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [lineId, setLineId] = useState<string>(INBOX_LINE_ID);
  const [pickerOpen, setPickerOpen] = useState(false);
  const ime = useIme();
  const targets = useMemo(
    () =>
      Object.values(linesMap)
        .filter((l) => l.status === 'active')
        // Habits reject hand-built tasks (§5.5.0). Inbox always first
        // so default case reads at the top of the list.
        .filter((l) => l.isDefault || l.kind === 'project')
        .sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1;
          if (!a.isDefault && b.isDefault) return 1;
          return a.name.localeCompare(b.name);
        }),
    [linesMap],
  );
  const currentLine = linesMap[lineId];
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed, lineId);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="text"
        value={value}
        autoFocus
        placeholder="新任务 · Enter 添加"
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={(e) => {
          // ime.isComposing covers both the Chromium fast path AND the
          // WKWebView race where compositionend fires before keydown.
          if (e.key === 'Enter' && !ime.isComposing(e)) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-8 w-full rounded-md border border-hairline/60 bg-surface-0 px-2 text-sm text-ink-primary outline-none transition focus:border-ink-secondary"
      />
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 self-start rounded-sm px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            → {currentLine?.name ?? 'Inbox'}
            <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="max-h-[240px] w-[220px] overflow-y-auto p-1"
        >
          <ul className="flex flex-col">
            {targets.map((line) => {
              const active = line.id === lineId;
              return (
                <li key={line.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setLineId(line.id);
                      setPickerOpen(false);
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition',
                      active ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}
                  >
                    {line.color && (
                      <span
                        aria-hidden
                        className="h-3 w-[3px] shrink-0 rounded-sm"
                        style={{
                          background:
                            RAIL_COLOR_HEX[
                              line.color as keyof typeof RAIL_COLOR_HEX
                            ] ?? RAIL_COLOR_HEX.slate,
                        }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{line.name}</span>
                    {line.isDefault && (
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-ink-tertiary">
                        inbox
                      </span>
                    )}
                    {active && (
                      <Check
                        className="h-3.5 w-3.5 text-ink-tertiary"
                        strokeWidth={2}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function BacklogCard({
  item,
  projectName,
  projectColor,
  onOpen,
  onDelete,
}: {
  item: BacklogItem;
  projectName: string | undefined;
  projectColor: string | undefined;
  onOpen?: () => void;
  onDelete?: () => void;
}) {
  const { task } = item;
  const accent = projectColor
    ? RAIL_COLOR_HEX[projectColor as keyof typeof RAIL_COLOR_HEX]
    : undefined;
  // ERD §10.6 v0.11 — `deferred` is a Task-level state; occurrences
  // can't be deferred. Only legacy task rows show the "以后" badge.
  const isDeferred = item.kind === 'task' && task.status === 'deferred';
  const title = backlogItemTitle(item);
  // For occurrence rows, render the parent Task title as a small
  // sub-line so the user sees the context — pure occurrence label
  // alone ("写正文") would be ambiguous when many tasks are split.
  const showParentTaskLine =
    item.kind === 'occurrence' &&
    item.occurrence.label?.trim() &&
    item.occurrence.label.trim() !== task.title;
  // dnd-kit drag source. Backlog pills are useDraggable (not useSortable):
  // they don't reorder among themselves via drag, just get dragged to
  // CycleView cells. App-level handleDragEnd (App.tsx) reads
  // `data.current.type = 'task'` and dispatches scheduleTaskToRail OR
  // scheduleTaskOccurrence based on whether `active.id` matches an
  // entry in taskOccurrences. PointerSensor's 4px activation constraint
  // (set in App.tsx) means a plain click on the card to open detail
  // doesn't accidentally start a drag.
  // Build a SlotTaskSummary preview so the multi-container mirror
  // (dragMirror.tsx) can render this pill inside a cycle cell during
  // drag without reaching back into the store. Backlog rows are
  // pending by definition.
  const dndId = backlogItemId(item);
  const summary = {
    rowId: dndId,
    taskId: task.id,
    ...(item.kind === 'occurrence' && {
      occurrenceId: item.occurrence.id,
    }),
    title,
    state: 'pending' as const,
    isAutoTask: false,
    hasNote: false,
    subItemsDone: 0,
    subItemsTotal: 0,
    ...(item.kind === 'occurrence' &&
      item.occurrence.percent != null && {
        milestonePercent: item.occurrence.percent,
      }),
    ...(item.kind === 'task' &&
      task.milestonePercent != null && {
        milestonePercent: task.milestonePercent,
      }),
    ...(task.priority && { priority: task.priority }),
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dndId,
    data: { type: 'task', source: 'backlog', summary },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      title={
        isDeferred
          ? '之前标记为「以后再说」· 拖到格子即重新排期,点开查看详情'
          : '拖到格子即排期,点开查看详情'
      }
      className={clsx(
        'group flex cursor-grab items-start gap-2 rounded-md bg-surface-1 px-2 py-2 transition hover:bg-surface-2 active:cursor-grabbing',
        isDragging && 'opacity-60',
      )}
    >
      {accent && (
        <span
          aria-hidden
          className="mt-0.5 h-3.5 w-[3px] shrink-0 rounded-sm"
          style={{ background: accent }}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          {isDeferred && (
            <ArrowUpRight
              aria-hidden
              className="h-3 w-3 shrink-0 text-ink-tertiary"
              strokeWidth={1.8}
            />
          )}
          <span className="text-sm leading-snug text-ink-primary">{title}</span>
        </div>
        {showParentTaskLine && (
          <span className="truncate text-2xs text-ink-tertiary">
            {task.title}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {task.priority && (
            <span
              className={clsx(
                'inline-flex h-3.5 min-w-[1.25rem] items-center justify-center rounded-sm px-1 font-mono text-[9px] font-medium uppercase tracking-wider text-white',
                task.priority === 'P0' && 'bg-red-500/90',
                task.priority === 'P1' && 'bg-amber-500/90',
                task.priority === 'P2' && 'bg-slate-400/80',
              )}
            >
              {task.priority}
            </span>
          )}
          {item.kind === 'occurrence' && item.occurrence.percent != null && (
            <span className="font-mono text-2xs tabular-nums text-ink-secondary">
              {item.occurrence.percent}%
            </span>
          )}
          {projectName && (
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {projectName}
            </span>
          )}
          {item.kind === 'occurrence' && (
            <span className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-tertiary">
              切分
            </span>
          )}
          {isDeferred && (
            <span className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-tertiary">
              以后
            </span>
          )}
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="删除任务"
          title="移到回收站"
          className="shrink-0 rounded-sm p-1 text-ink-tertiary opacity-0 transition hover:bg-surface-3 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

// ERD §10.6 v0.11 — compound card for an occurrence-managed Task with
// one or more unscheduled occurrences in the Backlog. Header carries
// the parent Task title + project + priority + 切分 count; sub-rows
// are the individual draggable occurrences. Header itself is NOT a
// drag source (the user drags individual occurrences onto slots);
// clicking the header (or any sub-row) opens the parent Task detail
// drawer.
function BacklogTaskGroupCard({
  task,
  occurrences,
  projectName,
  projectColor,
  onOpen,
  onOpenOccurrence,
  onDelete,
}: {
  task: Task;
  occurrences: Array<Extract<BacklogItem, { kind: 'occurrence' }>>;
  projectName: string | undefined;
  projectColor: string | undefined;
  onOpen?: () => void;
  onOpenOccurrence?: (occurrenceId: string) => void;
  onDelete?: () => void;
}) {
  const accent = projectColor
    ? RAIL_COLOR_HEX[projectColor as keyof typeof RAIL_COLOR_HEX]
    : undefined;
  return (
    <div className="overflow-hidden rounded-md bg-surface-1">
      <div className="group/header flex items-start gap-1 px-2 py-2 transition hover:bg-surface-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          title="点击打开任务详情"
        >
          {accent && (
            <span
              aria-hidden
              className="mt-0.5 h-3.5 w-[3px] shrink-0 rounded-sm"
              style={{ background: accent }}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm leading-snug text-ink-primary">
              {task.title}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {task.priority && (
                <span
                  className={clsx(
                    'inline-flex h-3.5 min-w-[1.25rem] items-center justify-center rounded-sm px-1 font-mono text-[9px] font-medium uppercase tracking-wider text-white',
                    task.priority === 'P0' && 'bg-red-500/90',
                    task.priority === 'P1' && 'bg-amber-500/90',
                    task.priority === 'P2' && 'bg-slate-400/80',
                  )}
                >
                  {task.priority}
                </span>
              )}
              {projectName && (
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  {projectName}
                </span>
              )}
              <span className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-tertiary">
                切分 · {occurrences.length}
              </span>
            </div>
          </div>
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="删除任务"
            title="移到回收站"
            className="shrink-0 rounded-sm p-1 text-ink-tertiary opacity-0 transition hover:bg-surface-3 hover:text-red-500 group-hover/header:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )}
      </div>
      <ul className="flex flex-col border-t border-hairline/40">
        {occurrences.map((it) => (
          <li key={it.occurrence.id}>
            <BacklogOccurrenceSubRow
              task={task}
              occurrence={it.occurrence}
              onOpen={() => onOpenOccurrence?.(it.occurrence.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BacklogOccurrenceSubRow({
  task,
  occurrence,
  onOpen,
}: {
  task: Task;
  occurrence: TaskOccurrence;
  onOpen?: () => void;
}) {
  const title =
    (occurrence.label?.trim() && occurrence.label.trim().length > 0
      ? occurrence.label.trim()
      : task.title) || task.title;
  const summary = {
    rowId: occurrence.id,
    taskId: task.id,
    occurrenceId: occurrence.id,
    title,
    state: 'pending' as const,
    isAutoTask: false,
    hasNote: false,
    subItemsDone: 0,
    subItemsTotal: 0,
    ...(occurrence.percent != null && { milestonePercent: occurrence.percent }),
    ...(task.priority && { priority: task.priority }),
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: occurrence.id,
    data: { type: 'task', source: 'backlog', summary },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      title="拖到 cycle 格子即排期，点击打开对应切分"
      className={clsx(
        'group flex cursor-grab items-center gap-2 px-3 py-1.5 transition hover:bg-surface-2 active:cursor-grabbing',
        isDragging && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className="ml-1 h-3 w-[2px] shrink-0 rounded-sm bg-hairline/70"
      />
      <span className="min-w-0 flex-1 truncate text-xs leading-snug text-ink-primary">
        {title}
      </span>
      {occurrence.percent != null && (
        <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-tertiary">
          {occurrence.percent}%
        </span>
      )}
    </div>
  );
}
