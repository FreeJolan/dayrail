import type { ShiftTagStat } from '@/data/sampleReview';

// ERD §5.8 F2 — Top-5 偏离原因 tags as a flat horizontal bar list.
// "Observational framing only" — no completion rate, no judgment.
// Tags come from the 6-second Reason toast: whenever the user defers
// or archives a rail, they can tap one of three chip suggestions
// (天气 / 太累 / 会议 by default) or type a custom one. The aggregation
// counts those picks across the scope and surfaces the Top-5.

interface Props {
  tags: ShiftTagStat[];
}

export function ShiftTagBars({ tags }: Props) {
  const max = tags.reduce((m, t) => Math.max(m, t.count), 0);
  const total = tags.reduce((s, t) => s + t.count, 0);
  return (
    <section aria-label="偏离原因" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span
          className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary"
          title="在 check-in / Pending 里点「以后再说」或「归档」时,6 秒 toast 里选的原因标签"
        >
          偏离原因
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {total} total
        </span>
      </div>
      {tags.length === 0 ? (
        <p className="rounded-md bg-surface-1 px-3 py-2 text-xs text-ink-tertiary">
          这个周期内没有记录偏离原因。点「以后再说」/「归档」时,toast
          里的原因 chip 会在这里汇总。
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tags.map((t) => {
            const widthPct = max > 0 ? (t.count / max) * 100 : 0;
            return (
              <li
                key={t.name}
                className="grid grid-cols-[140px_1fr_36px] items-center gap-3"
              >
                <span className="truncate text-sm text-ink-secondary">
                  {t.name}
                </span>
                <span className="relative block h-2 overflow-hidden bg-surface-2">
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-ink-primary/60"
                    style={{ width: `${widthPct}%` }}
                  />
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-ink-secondary">
                  {t.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
