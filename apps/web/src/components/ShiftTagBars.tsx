import type { ShiftTagStat } from '@/data/sampleReview';

// ERD §5.8 F2 — Top-5 Shift tags as a flat horizontal bar list.
// "Observational framing only" — no completion rate, no judgment.

interface Props {
  tags: ShiftTagStat[];
}

export function ShiftTagBars({ tags }: Props) {
  const max = tags.reduce((m, t) => Math.max(m, t.count), 0);
  const total = tags.reduce((s, t) => s + t.count, 0);
  return (
    <section aria-label="Shift tag frequency" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Shift Tags
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {total} total
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {tags.map((t) => {
          const widthPct = max > 0 ? (t.count / max) * 100 : 0;
          return (
            <li key={t.name} className="grid grid-cols-[140px_1fr_36px] items-center gap-3">
              <span className="truncate text-sm text-ink-secondary">{t.name}</span>
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
    </section>
  );
}
