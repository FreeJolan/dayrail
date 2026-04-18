import { clsx } from 'clsx';
import {
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore, type Task } from '@dayrail/core';
import { selectBacklogTasks } from '@/pages/cycleFromStore';
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

export function BacklogDrawer({ open, onToggle }: Props) {
  const tasksMap = useStore((s) => s.tasks);
  const linesMap = useStore((s) => s.lines);
  const adhocEventsMap = useStore((s) => s.adhocEvents);
  const [query, setQuery] = useState('');

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
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
              aria-label="新建任务"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      {open && (
        <>
          <div className="px-4 pb-3">
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

          {filtered.length === 0 ? (
            <div className="px-5 py-6 text-sm text-ink-tertiary">
              {query.trim()
                ? '没有匹配的任务'
                : '所有任务都已排期或归档 —— 在 Tasks 视图里建几个试试。'}
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto px-2">
              {filtered.map((task) => (
                <li key={task.id} className="px-2 py-1">
                  <BacklogCard
                    task={task}
                    projectName={linesMap[task.lineId]?.name}
                    projectColor={linesMap[task.lineId]?.color}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="hairline-t px-4 py-3">
            <p className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Drag → day cell
            </p>
            <p className="mt-1 text-xs text-ink-tertiary">
              拖拽在 chunk 3 接入；当前可在 Tasks 视图用排期按钮设定。
            </p>
          </div>
        </>
      )}
    </aside>
  );
}

function BacklogCard({
  task,
  projectName,
  projectColor,
}: {
  task: Task;
  projectName: string | undefined;
  projectColor: string | undefined;
}) {
  const accent = projectColor
    ? RAIL_COLOR_HEX[projectColor as keyof typeof RAIL_COLOR_HEX]
    : undefined;
  return (
    <div className="group flex items-start gap-2 rounded-md bg-surface-1 px-2 py-2 transition hover:bg-surface-2">
      {accent && (
        <span
          aria-hidden
          className="mt-0.5 h-3.5 w-[3px] shrink-0 rounded-sm"
          style={{ background: accent }}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm leading-snug text-ink-primary">
          {task.title}
        </span>
        {projectName && (
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {projectName}
          </span>
        )}
      </div>
    </div>
  );
}
