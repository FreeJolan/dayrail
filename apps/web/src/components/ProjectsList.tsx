import { clsx } from 'clsx';
import { Plus, Archive } from 'lucide-react';
import {
  SAMPLE_PROJECTS,
  computeProjectProgress,
  countDoneChunks,
  isOverdue,
  type LineKind,
  type LineStatus,
  type ProjectLine,
} from '@/data/sampleProjects';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.5 F1 — left list in the master-detail layout.
//   - top: Type tabs (Project / Habit / Group), MVP delivers Project.
//   - below: Active / Archived sub-tabs.
//   - main: Line cards (color strip + name + subtitle + time window +
//           primary progress bar + chunk count).

interface Props {
  activeId?: string;
  onSelect: (line: ProjectLine) => void;
  typeFilter: LineKind;
  onTypeFilter: (next: LineKind) => void;
  statusFilter: LineStatus;
  onStatusFilter: (next: LineStatus) => void;
  onNew: () => void;
}

const TYPE_TABS: Array<{ key: LineKind; label: string; count: number }> = [
  { key: 'project', label: 'Project', count: SAMPLE_PROJECTS.filter((l) => l.kind === 'project').length },
  { key: 'habit', label: 'Habit', count: 0 },
  { key: 'group', label: 'Group', count: 0 },
];

export function ProjectsList({
  activeId,
  onSelect,
  typeFilter,
  onTypeFilter,
  statusFilter,
  onStatusFilter,
  onNew,
}: Props) {
  const visible = SAMPLE_PROJECTS.filter(
    (l) => l.kind === typeFilter && l.status === statusFilter,
  );

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-transparent">
      <header className="flex items-center justify-between px-4 pt-6">
        <h1 className="font-mono text-sm font-medium tracking-wide text-ink-primary">
          Projects
        </h1>
        <button
          type="button"
          onClick={onNew}
          aria-label="New project"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-4">
        <TypeTabs value={typeFilter} onChange={onTypeFilter} />
        <StatusSubTabs value={statusFilter} onChange={onStatusFilter} />
      </div>

      <ul className="mt-3 flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-6">
        {visible.length === 0 ? (
          <EmptyListNote kind={typeFilter} status={statusFilter} />
        ) : (
          visible.map((line) => (
            <li key={line.id}>
              <LineCard
                line={line}
                active={line.id === activeId}
                onClick={() => onSelect(line)}
              />
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}

// ---------- sub-parts ----------

function TypeTabs({
  value,
  onChange,
}: {
  value: LineKind;
  onChange: (next: LineKind) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-surface-1 p-0.5">
      {TYPE_TABS.map((t) => {
        const active = t.key === value;
        const disabled = t.key !== 'project';
        return (
          <button
            key={t.key}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(t.key)}
            title={disabled ? 'v0.4 roadmap' : undefined}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs transition',
              active
                ? 'bg-surface-3 font-medium text-ink-primary'
                : disabled
                  ? 'cursor-not-allowed text-ink-tertiary/50'
                  : 'text-ink-secondary hover:text-ink-primary',
            )}
          >
            {t.label}
            {disabled ? (
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-tertiary/60">
                v0.4
              </span>
            ) : (
              <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StatusSubTabs({
  value,
  onChange,
}: {
  value: LineStatus;
  onChange: (next: LineStatus) => void;
}) {
  const activeCount = SAMPLE_PROJECTS.filter(
    (l) => l.kind === 'project' && l.status === 'active',
  ).length;
  const archivedCount = SAMPLE_PROJECTS.filter(
    (l) => l.kind === 'project' && l.status === 'archived',
  ).length;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange('active')}
        className={clsx(
          'font-mono text-2xs uppercase tracking-widest transition',
          value === 'active' ? 'text-ink-primary' : 'text-ink-tertiary hover:text-ink-secondary',
        )}
      >
        Active <span className="tabular-nums">· {activeCount}</span>
      </button>
      <span aria-hidden className="h-3 w-px bg-surface-3" />
      <button
        type="button"
        onClick={() => onChange('archived')}
        className={clsx(
          'inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-widest transition',
          value === 'archived' ? 'text-ink-primary' : 'text-ink-tertiary hover:text-ink-secondary',
        )}
      >
        <Archive className="h-2.5 w-2.5" strokeWidth={1.8} />
        Archived <span className="tabular-nums">· {archivedCount}</span>
      </button>
    </div>
  );
}

function LineCard({
  line,
  active,
  onClick,
}: {
  line: ProjectLine;
  active: boolean;
  onClick: () => void;
}) {
  const progress = computeProjectProgress(line);
  const { done, total } = countDoneChunks(line);
  const overdue = isOverdue(line);
  const strip = RAIL_COLOR_HEX[line.color];

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'relative flex w-full flex-col gap-2 overflow-hidden rounded-md px-3 py-3 text-left transition',
        active ? 'bg-surface-2' : 'hover:bg-surface-1',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-[3px] rounded-sm"
        style={{ background: strip }}
      />

      <div className="pl-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink-primary">
            {line.name}
          </span>
          {overdue && (
            <span className="shrink-0 rounded-sm bg-warn-soft px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-warn">
              延期
            </span>
          )}
        </div>
        {line.subtitle && (
          <p className="mt-0.5 line-clamp-1 text-xs text-ink-tertiary">
            {line.subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 pl-2">
        {/* Progress bar — main progress (max milestonePercent among done) */}
        <div className="relative h-1 flex-1 overflow-hidden bg-surface-2">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 transition-[width] duration-300"
            style={{ width: `${progress}%`, background: strip, opacity: 0.7 }}
          />
        </div>
        <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-secondary">
          {progress}%
        </span>
      </div>

      <div className="flex items-center gap-3 pl-2 font-mono text-2xs tabular-nums text-ink-tertiary">
        <span>
          {done}/{total} chunks
        </span>
        {line.plannedEnd && (
          <>
            <span aria-hidden>·</span>
            <span>due {line.plannedEnd.slice(5)}</span>
          </>
        )}
      </div>
    </button>
  );
}

function EmptyListNote({
  kind,
  status,
}: {
  kind: LineKind;
  status: LineStatus;
}) {
  const msg =
    kind !== 'project'
      ? `${kind[0]!.toUpperCase()}${kind.slice(1)} 在 v0.4 的 roadmap 里 —— 当前阶段只交付 Project`
      : status === 'archived'
        ? '暂无归档 Project'
        : '还没有 Project · 点右上 + 新建一个';
  return (
    <li className="px-3 py-6 text-center text-xs text-ink-tertiary">{msg}</li>
  );
}
