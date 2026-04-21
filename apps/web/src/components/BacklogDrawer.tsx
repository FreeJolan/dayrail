import { clsx } from 'clsx';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { INBOX_LINE_ID, useStore, type Line, type Task } from '@dayrail/core';
import { selectBacklogTasks } from '@/pages/cycleFromStore';
import { TaskDetailDrawer } from '@/pages/Tasks';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';
import { RAIL_COLOR_HEX } from './railColors';

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
  const linesMap = useStore((s) => s.lines);
  const adhocEventsMap = useStore((s) => s.adhocEvents);
  const createTask = useStore((s) => s.createTask);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [groupBy, setGroupBy] = useState<BacklogGroupBy>('none');
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
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

  const tasks = useMemo(
    () => selectBacklogTasks({ tasks: tasksMap, adhocEvents: adhocEventsMap }),
    [tasksMap, adhocEventsMap],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.note?.toLowerCase().includes(q) ?? false),
    );
  }, [tasks, query]);

  // Backlog can be viewed flat or broken into sections. Group order
  // is deterministic so the drawer doesn't jitter across edits:
  //   - priority: P0 → P1 → P2 → 未设置
  //   - project:  Inbox first (pinned), then Lines by name
  const groups = useMemo<Array<{ key: string; label: string; items: Task[] }>>(() => {
    if (groupBy === 'none' || filtered.length === 0) return [];
    if (groupBy === 'priority') {
      const buckets = new Map<string, Task[]>();
      const order = ['P0', 'P1', 'P2', '__none'];
      for (const k of order) buckets.set(k, []);
      for (const t of filtered) {
        const key = t.priority ?? '__none';
        buckets.get(key)!.push(t);
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
    const byLine = new Map<string, Task[]>();
    for (const t of filtered) {
      const arr = byLine.get(t.lineId) ?? [];
      arr.push(t);
      byLine.set(t.lineId, arr);
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
              {tasks.length}
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
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              分组
            </span>
            <GroupBySwitch value={groupBy} onChange={setGroupBy} />
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-6 text-sm text-ink-tertiary">
              {query.trim()
                ? '没有匹配的任务'
                : '所有任务都已排期或归档 —— 在 Tasks 视图里建几个试试。'}
            </div>
          ) : groupBy === 'none' ? (
            <ul className="flex-1 overflow-y-auto px-2">
              {filtered.map((task) => (
                <li key={task.id} className="px-2 py-1">
                  <BacklogCard
                    task={task}
                    projectName={linesMap[task.lineId]?.name}
                    projectColor={linesMap[task.lineId]?.color}
                    onOpen={() => setDetailTaskId(task.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex-1 overflow-y-auto px-2">
              {groups.map((g) => (
                <section key={g.key} className="pb-2 pt-1">
                  <div className="flex items-baseline gap-2 px-2 pb-1 pt-1">
                    <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                      {g.label}
                    </span>
                    <span className="font-mono text-2xs tabular-nums text-ink-tertiary/70">
                      {g.items.length}
                    </span>
                  </div>
                  <ul className="flex flex-col">
                    {g.items.map((task) => (
                      <li key={task.id} className="px-2 py-1">
                        <BacklogCard
                          task={task}
                          projectName={linesMap[task.lineId]?.name}
                          projectColor={linesMap[task.lineId]?.color}
                          onOpen={() => setDetailTaskId(task.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
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
      {detailTaskId &&
        tasksMap[detailTaskId] &&
        createPortal(
          <TaskDetailDrawer
            task={tasksMap[detailTaskId]!}
            line={linesMap[tasksMap[detailTaskId]!.lineId]}
            onClose={() => setDetailTaskId(null)}
          />,
          document.body,
        )}
    </aside>
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

/** Mime type our drag uses to pass a task id between the Backlog
 *  drawer and Cycle-section drop targets. Keeping it exported here
 *  so the drop side can reference the same string. */
export const TASK_DRAG_MIME = 'application/x-dayrail-task';

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
        onKeyDown={(e) => {
          // nativeEvent.isComposing = IME candidate window open; Enter
          // there picks the pinyin, doesn't submit.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
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
  task,
  projectName,
  projectColor,
  onOpen,
}: {
  task: Task;
  projectName: string | undefined;
  projectColor: string | undefined;
  onOpen?: () => void;
}) {
  const accent = projectColor
    ? RAIL_COLOR_HEX[projectColor as keyof typeof RAIL_COLOR_HEX]
    : undefined;
  const isDeferred = task.status === 'deferred';
  // HTML5 drag suppresses the click that follows a drag gesture, so a
  // plain onClick works correctly for "tap opens detail, drag to a
  // Cycle cell to schedule" without extra disambiguation logic.
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_DRAG_MIME, task.id);
        e.dataTransfer.setData('text/plain', task.title);
        e.dataTransfer.effectAllowed = 'move';
      }}
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
      className="group flex cursor-grab items-start gap-2 rounded-md bg-surface-1 px-2 py-2 transition hover:bg-surface-2 active:cursor-grabbing"
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
          <span className="text-sm leading-snug text-ink-primary">
            {task.title}
          </span>
        </div>
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
          {isDeferred && (
            <span className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-tertiary">
              以后
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
