import { useMemo, useState } from 'react';
import { ProjectsList } from '@/components/ProjectsList';
import { ProjectDetail } from '@/components/ProjectDetail';
import {
  SAMPLE_PROJECTS,
  type LineKind,
  type LineStatus,
  type ProjectLine,
} from '@/data/sampleProjects';

// ERD §5.5 F1 — Projects / Lines master-detail page.
// Left 320 px list (ProjectsList) + right flex-1 detail (ProjectDetail).
// On narrow screens we'll switch to a push-style single-column later
// (v0.2 responsive pass).

export function Projects() {
  const [typeFilter, setTypeFilter] = useState<LineKind>('project');
  const [statusFilter, setStatusFilter] = useState<LineStatus>('active');
  const [selectedId, setSelectedId] = useState<string | null>(
    SAMPLE_PROJECTS.find(
      (l) => l.kind === 'project' && l.status === 'active',
    )?.id ?? null,
  );

  const selected = useMemo<ProjectLine | null>(
    () => SAMPLE_PROJECTS.find((l) => l.id === selectedId) ?? null,
    [selectedId],
  );

  const handleSelect = (line: ProjectLine) => setSelectedId(line.id);

  // When filters change and the current selection no longer matches,
  // auto-select the first visible project in the new filter (or null).
  const selectionMatchesFilter =
    selected?.kind === typeFilter && selected?.status === statusFilter;
  if (selected && !selectionMatchesFilter) {
    const first = SAMPLE_PROJECTS.find(
      (l) => l.kind === typeFilter && l.status === statusFilter,
    );
    if (first?.id !== selectedId) {
      // deferred set via render path — this is safe as per React's guarded
      // pattern for "derived state from props" but guarded by id equality
      // to avoid loops.
      queueMicrotask(() => setSelectedId(first?.id ?? null));
    }
  }

  return (
    <div className="flex min-h-screen w-full">
      <ProjectsList
        activeId={selected?.id}
        onSelect={handleSelect}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        onNew={() => {
          /* static mock — intentionally no-op */
        }}
      />

      {selected ? (
        <ProjectDetail line={selected} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center px-10 py-16 xl:pl-14">
      <div className="flex max-w-sm flex-col items-start gap-2">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Nothing selected
        </span>
        <h2 className="text-lg font-medium text-ink-primary">
          从左边选一个 Project 开始
        </h2>
        <p className="text-sm text-ink-secondary">
          或点左上 <span className="font-mono text-xs text-ink-primary">+</span> 新建一个 Project。
          Project 是所有规划活动的容器 —— 里程碑任务决定主进度条，
          辅助任务帮你把项目拆成可排到 Slot 的小块。
        </p>
      </div>
    </section>
  );
}
