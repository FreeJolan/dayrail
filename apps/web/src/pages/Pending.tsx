import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Inbox, Wind } from 'lucide-react';
import {
  SAMPLE_QUEUE,
  groupByDate,
  isOlderThan7d,
  summary,
  type QueueItem,
} from '@/data/sampleQueue';
import { RAIL_COLOR_HEX } from '@/components/railColors';

// ERD §5.7 F3 — pending-decisions queue.
// Single-column page; date-reverse groups; each row carries the same
// 4-action vocabulary as the §5.6 check-in strip (完成 / 跳过 / Shift /
// 忽略) — zero-cost mental carry-over. No multi-select, no batch bar;
// the only batch path is "Let these pass" for items > 7 days old.

export function Pending() {
  const [items, setItems] = useState<QueueItem[]>(SAMPLE_QUEUE);
  const s = useMemo(() => summary(items), [items]);
  const groups = useMemo(() => groupByDate(items), [items]);

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  const letThemPass = () => {
    if (s.eligible === 0) return;
    const msg = `把超过 7 天的事都过去？\n过去的日子不会被改写，只是把这份待办缩短一些（影响 ${s.eligible} 条）。`;
    if (window.confirm(msg)) {
      setItems((prev) => prev.filter((i) => !isOlderThan7d(i)));
    }
  };

  return (
    <div className="flex w-full max-w-[920px] flex-col gap-6 py-10 pl-10 pr-10 lg:pl-14 xl:pl-20">
      <TopBar
        total={s.total}
        eligible={s.eligible}
        oldest={s.oldest}
        onLetThemPass={letThemPass}
      />

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="flex flex-col gap-8">
          {groups.map((g) => (
            <DateGroup
              key={g.date}
              date={g.date}
              relative={g.relative}
              weekdayShort={g.weekdayShort}
              dayLabel={g.dayLabel}
              items={g.items}
              onResolve={removeItem}
            />
          ))}
        </section>
      )}

      <Footnote />
    </div>
  );
}

// ---------- top ----------

function TopBar({
  total,
  eligible,
  oldest,
  onLetThemPass,
}: {
  total: number;
  eligible: number;
  oldest: string | undefined;
  onLetThemPass: () => void;
}) {
  return (
    <header className="flex items-end justify-between gap-6 pt-2">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-xs uppercase tracking-widest text-ink-tertiary">
          Pending
        </span>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-medium text-ink-primary">待决定</h1>
          <span className="font-mono text-sm tabular-nums text-ink-secondary">
            {total} 条
          </span>
          {oldest && (
            <span className="font-mono text-xs tabular-nums text-ink-tertiary">
              · 最早 {oldest.slice(5)}
            </span>
          )}
        </div>
      </div>

      <LetThemPassButton
        eligible={eligible}
        onClick={onLetThemPass}
      />
    </header>
  );
}

function LetThemPassButton({
  eligible,
  onClick,
}: {
  eligible: number;
  onClick: () => void;
}) {
  const disabled = eligible === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="把超过 7 天的事都过去（默认阈值：7 天，可在 设置 → 高级 调整）"
      className={clsx(
        'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
        disabled
          ? 'cursor-not-allowed text-ink-tertiary/50'
          : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
      )}
    >
      <Wind className="h-3.5 w-3.5" strokeWidth={1.8} />
      <span>让它们都过去吧</span>
      {eligible > 0 && (
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          影响 {eligible}
        </span>
      )}
    </button>
  );
}

// ---------- date group ----------

function DateGroup({
  date,
  relative,
  weekdayShort,
  dayLabel,
  items,
  onResolve,
}: {
  date: string;
  relative: string;
  weekdayShort: string;
  dayLabel: string;
  items: QueueItem[];
  onResolve: (id: string) => void;
}) {
  return (
    <section aria-label={date} className="flex flex-col gap-2">
      <header className="flex items-baseline gap-3">
        <span className="font-mono text-sm tabular-nums text-ink-primary">
          {dayLabel}
        </span>
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-secondary">
          {weekdayShort}
        </span>
        <span className="text-xs text-ink-tertiary">· {relative}</span>
        <span className="text-xs text-ink-tertiary">· {items.length} 条</span>
      </header>
      <ul className="flex flex-col gap-1">
        {items.map((it, idx) => (
          <li key={it.id}>
            <QueueRow item={it} eligible={isOlderThan7d(it)} onResolve={onResolve} first={idx === 0} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueRow({
  item,
  eligible,
  onResolve,
}: {
  item: QueueItem;
  eligible: boolean;
  onResolve: (id: string) => void;
  first: boolean;
}) {
  const strip = RAIL_COLOR_HEX[item.railColor];
  const act = (verb: string) => () => {
    if (verb === 'shift') {
      // Static mock: the shift sheet lives elsewhere; this row vanishes.
      window.alert('Shift sheet 未实装 · mock 行为：直接从队列移除');
    }
    onResolve(item.id);
  };

  return (
    <div
      className={clsx(
        'group flex items-center gap-3 rounded-md bg-surface-1 px-3 py-2.5 transition hover:bg-surface-2',
        eligible && 'opacity-85',
      )}
    >
      <span
        aria-hidden
        className="h-5 w-1 shrink-0 rounded-sm"
        style={{ background: strip }}
      />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-tertiary">
          {item.start}–{item.end}
        </span>
        <span className="truncate text-sm text-ink-primary">
          {item.railName}
        </span>
        {item.task && (
          <span className="truncate text-sm text-ink-tertiary">· {item.task}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ActionChip variant="primary" onClick={act('done')}>
          完成
        </ActionChip>
        <ActionChip onClick={act('skip')}>跳过</ActionChip>
        <ActionChip onClick={act('shift')}>Shift</ActionChip>
        <ActionChip variant="ghost" onClick={act('ignore')}>
          忽略
        </ActionChip>
      </div>
    </div>
  );
}

function ActionChip({
  children,
  variant = 'default',
  onClick,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'ghost';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-sm px-2.5 py-1 text-xs font-medium transition',
        variant === 'primary' &&
          'bg-ink-primary text-surface-0 hover:bg-ink-secondary',
        variant === 'default' &&
          'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
        variant === 'ghost' && 'text-ink-tertiary hover:text-ink-secondary',
      )}
    >
      {children}
    </button>
  );
}

// ---------- empty ----------

function EmptyState() {
  return (
    <section className="flex min-h-[240px] flex-col items-start justify-center gap-2 rounded-md bg-surface-1 px-8 py-12">
      <Inbox className="h-6 w-6 text-ink-tertiary" strokeWidth={1.4} />
      <h2 className="text-lg font-medium text-ink-primary">一切清空了</h2>
      <p className="text-sm text-ink-secondary">
        下次漏标记的 Rail 会出现在这里 —— 你可以挑某个闲下来的时刻一次性清掉。
      </p>
    </section>
  );
}

function Footnote() {
  return (
    <footer className="mt-4 flex justify-between font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>ERD §5.7 · 未标记的 Rail 永不自动改写</span>
      <span>Let-them-pass threshold: 7 days · 设置 → 高级</span>
    </footer>
  );
}
