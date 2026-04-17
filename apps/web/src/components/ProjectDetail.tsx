import { clsx } from 'clsx';
import {
  Archive,
  Calendar as CalendarIcon,
  Check,
  CircleDot,
  Circle,
  Flag,
  MoreHorizontal,
  Plus,
  Sparkles,
} from 'lucide-react';
import {
  computeProjectProgress,
  countDoneChunks,
  type Chunk,
  type ChunkStatus,
  type ProjectLine,
} from '@/data/sampleProjects';
import { RAIL_COLOR_HEX } from './railColors';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/DropdownMenu';

// ERD §5.5 F1 — right pane of the Projects master-detail.
//   · Project header: name + description + dates + overall progress
//   · "Backlog" region at top (unscheduled Chunks)
//   · Scheduled Chunks below, ordered; each row shows title +
//     milestone mark + status + sub-item completion + Slot ref
//   · Bottom: `+ 添加 Chunk` and `AI 协助拆解`

interface Props {
  line: ProjectLine;
}

export function ProjectDetail({ line }: Props) {
  const progress = computeProjectProgress(line);
  const { done, total } = countDoneChunks(line);

  const backlog = line.chunks.filter((c) => !c.slot && c.status !== 'done');
  const scheduled = line.chunks.filter((c) => c.slot || c.status === 'done');

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <Header
        line={line}
        progress={progress}
        done={done}
        total={total}
      />

      <div className="flex flex-col gap-8 px-10 pb-16 pt-6 xl:pl-14">
        {backlog.length > 0 && (
          <ChunkGroup
            title="Backlog"
            subtitle="未排入 Slot"
            line={line}
            chunks={backlog}
          />
        )}
        <ChunkGroup
          title="Chunks"
          subtitle={`按 order 排 · ${total} 条`}
          line={line}
          chunks={scheduled}
          showOrder
        />

        <ActionFooter disabled={line.status === 'archived'} />
      </div>
    </section>
  );
}

// ---------- header ----------

function Header({
  line,
  progress,
  done,
  total,
}: {
  line: ProjectLine;
  progress: number;
  done: number;
  total: number;
}) {
  const strip = RAIL_COLOR_HEX[line.color];
  return (
    <header className="sticky top-0 z-30 bg-surface-0 px-10 pb-4 pt-6 xl:pl-14">
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <span
            aria-hidden
            className="h-6 w-1 shrink-0 rounded-sm"
            style={{ background: strip }}
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="truncate text-xl font-medium text-ink-primary">
                {line.name}
              </h2>
              {line.status === 'archived' && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  <Archive className="h-2.5 w-2.5" strokeWidth={1.8} />
                  Archived
                </span>
              )}
            </div>
            {line.subtitle && (
              <p className="mt-0.5 truncate text-sm text-ink-tertiary">
                {line.subtitle}
              </p>
            )}
          </div>
        </div>

        <HeaderMenu archived={line.status === 'archived'} />
      </div>

      <div className="mt-4 flex items-center gap-5">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative h-1.5 flex-1 overflow-hidden bg-surface-2">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 transition-[width] duration-500"
              style={{ width: `${progress}%`, background: strip, opacity: 0.85 }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink-primary">
            {progress}%
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-ink-secondary">
          <span>
            {done}
            <span className="text-ink-tertiary">/{total}</span> chunks
          </span>
          {line.plannedEnd && (
            <>
              <span aria-hidden className="text-ink-tertiary">
                ·
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarIcon
                  className="h-3 w-3 text-ink-tertiary"
                  strokeWidth={1.6}
                />
                due {line.plannedEnd}
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderMenu({ archived }: { archived: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Project menu"
          className="shrink-0 rounded-sm p-1 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary data-[state=open]:bg-surface-2 data-[state=open]:text-ink-primary"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>重命名</DropdownMenuItem>
        <DropdownMenuItem>改颜色</DropdownMenuItem>
        <DropdownMenuItem>改时间窗</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>{archived ? '恢复 Active' : '归档'}</DropdownMenuItem>
        <DropdownMenuItem destructive>删除 Project</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- chunk group ----------

function ChunkGroup({
  title,
  subtitle,
  line,
  chunks,
  showOrder,
}: {
  title: string;
  subtitle?: string;
  line: ProjectLine;
  chunks: Chunk[];
  showOrder?: boolean;
}) {
  if (chunks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-secondary">
          {title}{' '}
          {subtitle && (
            <span className="text-ink-tertiary">· {subtitle}</span>
          )}
        </span>
      </header>
      <ul className="flex flex-col gap-1.5">
        {chunks.map((chunk) => (
          <li key={chunk.id}>
            <ChunkRow line={line} chunk={chunk} showOrder={showOrder} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChunkRow({
  line,
  chunk,
  showOrder,
}: {
  line: ProjectLine;
  chunk: Chunk;
  showOrder?: boolean;
}) {
  const subDone = chunk.subItems?.filter((s) => s.done).length ?? 0;
  const subTotal = chunk.subItems?.length ?? 0;
  const strip = RAIL_COLOR_HEX[line.color];

  return (
    <div
      className={clsx(
        'group flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2',
        chunk.status === 'done' && 'opacity-70',
      )}
    >
      {showOrder && (
        <span className="w-6 shrink-0 text-right font-mono text-2xs tabular-nums text-ink-tertiary">
          {String(chunk.order).padStart(2, '0')}
        </span>
      )}

      <StatusIcon status={chunk.status} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {chunk.milestonePercent != null && (
            <MilestoneBadge pct={chunk.milestonePercent} color={strip} />
          )}
          <span
            className={clsx(
              'truncate text-sm',
              chunk.status === 'done'
                ? 'text-ink-tertiary line-through decoration-ink-tertiary/40'
                : 'text-ink-primary',
            )}
          >
            {chunk.title}
          </span>
        </div>
        {(chunk.slot || subTotal > 0 || chunk.note) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
            {chunk.slot && (
              <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums">
                <CalendarIcon className="h-2.5 w-2.5" strokeWidth={1.8} />
                {chunk.slot.date.slice(5)} · {chunk.slot.railName}
              </span>
            )}
            {subTotal > 0 && (
              <span className="font-mono text-2xs tabular-nums">
                {subDone}/{subTotal} sub-items
              </span>
            )}
            {chunk.note && <span>· {chunk.note}</span>}
          </div>
        )}
      </div>

      {/* Row hover actions */}
      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          aria-label="Reschedule"
          title="安排到 Slot"
          className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
        >
          <CalendarIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="More"
          className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ChunkStatus }) {
  if (status === 'done') {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-primary/10">
        <Check className="h-3 w-3 text-ink-primary/70" strokeWidth={2.2} />
      </span>
    );
  }
  if (status === 'in-progress') {
    return (
      <CircleDot
        aria-hidden
        className="h-4 w-4 shrink-0 text-cta"
        strokeWidth={2}
      />
    );
  }
  return (
    <Circle
      aria-hidden
      className="h-4 w-4 shrink-0 text-ink-tertiary"
      strokeWidth={1.8}
    />
  );
}

function MilestoneBadge({ pct, color }: { pct: number; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-ink-secondary"
      title={`milestone ${pct}%`}
    >
      <Flag
        aria-hidden
        className="h-2.5 w-2.5"
        strokeWidth={1.8}
        style={{ color }}
      />
      {pct}%
    </span>
  );
}

// ---------- footer actions ----------

function ActionFooter({ disabled }: { disabled: boolean }) {
  return (
    <section className="flex flex-col gap-2 pt-2">
      <button
        type="button"
        disabled={disabled}
        className={clsx(
          'flex items-center justify-center gap-2 rounded-md border border-dashed border-ink-tertiary/40 px-4 py-3 text-sm transition',
          disabled
            ? 'cursor-not-allowed text-ink-tertiary/50'
            : 'text-ink-tertiary hover:border-ink-secondary hover:bg-surface-1 hover:text-ink-secondary',
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        添加 Chunk
      </button>
      <button
        type="button"
        disabled={disabled}
        title="AI 默认关闭（§6.4）· Settings → AI 辅助 启用后可用"
        className={clsx(
          'flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs text-ink-tertiary transition',
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'hover:bg-surface-1 hover:text-ink-secondary',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.6} />
        AI 协助拆解
      </button>
    </section>
  );
}
