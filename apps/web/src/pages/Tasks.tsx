import { useState } from 'react';
import { clsx } from 'clsx';
import { Inbox, Plus, Archive, Trash2 } from 'lucide-react';
import {
  INBOX_LINE_ID,
  selectLinesByKind,
  useStore,
  type Line,
} from '@dayrail/core';
import { RAIL_COLOR_HEX } from '@/components/railColors';

// ERD §5.5 — Tasks view scaffold.
//   Left nav tree: Inbox · Projects · Habits (placeholder) · Tags
//   (placeholder) · Archived / Trash collapsed footer.
//   Right main: placeholder until Chunks E/F/G land.
//
// This commit wires the skeleton + selection state. The list, filters,
// scheduling popover, and trash surfaces arrive in subsequent chunks.

type Selection =
  | { kind: 'inbox' }
  | { kind: 'line'; lineId: string }
  | { kind: 'archived' }
  | { kind: 'trash' };

const DEFAULT_SELECTION: Selection = { kind: 'inbox' };

export function Tasks() {
  const [selection, setSelection] = useState<Selection>(DEFAULT_SELECTION);
  const inbox = useStore((s) => s.lines[INBOX_LINE_ID]);
  const projects = useStore((s) => selectLinesByKind(s, 'project', 'active'));
  const otherProjects = projects.filter((l) => l.id !== INBOX_LINE_ID);

  return (
    <div className="flex min-h-screen w-full">
      <NavTree
        selection={selection}
        onSelect={setSelection}
        inbox={inbox}
        projects={otherProjects}
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
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  inbox: Line | undefined;
  projects: Line[];
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

      <NavGroup label="Projects" actionLabel="+ 新建" onAction={() => undefined}>
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

      <NavGroup label="Tags">
        <p className="px-3 py-1.5 text-xs text-ink-tertiary">v0.3+</p>
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
// Main panel — placeholder content until list + filters land (chunk E).
// ------------------------------------------------------------------

function MainPanel({
  selection,
  inbox,
  projects,
}: {
  selection: Selection;
  inbox: Line | undefined;
  projects: Line[];
}) {
  const title =
    selection.kind === 'inbox'
      ? (inbox?.name ?? '收件箱')
      : selection.kind === 'line'
        ? (projects.find((p) => p.id === selection.lineId)?.name ?? 'Project')
        : selection.kind === 'archived'
          ? '已归档'
          : '回收站';
  return (
    <div className="flex w-full max-w-[960px] flex-col gap-6 px-10 py-10">
      <header className="flex items-baseline justify-between">
        <div>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {selection.kind === 'inbox'
              ? 'Inbox'
              : selection.kind === 'line'
                ? 'Project'
                : selection.kind === 'archived'
                  ? 'Archived'
                  : 'Trash'}
          </span>
          <h2 className="mt-1 text-2xl font-medium text-ink-primary">{title}</h2>
        </div>
      </header>

      <div className="flex flex-col gap-2 rounded-md border border-dashed border-hairline/60 bg-surface-1 px-6 py-8 text-sm text-ink-tertiary">
        <p>Tasks 列表、搜索、过滤、排期 popover 在接下来的 chunk 里接入。</p>
        <p>当前仅为导航骨架 —— 左栏切换能感觉到选择态。</p>
      </div>
    </div>
  );
}
