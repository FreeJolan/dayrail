import { useCallback } from 'react';
import { selectReflection, useStore } from '@dayrail/core';
import { MarkdownField } from '@/components/MarkdownField';

// ERD §4.1 / §10.4 — DailyReflection card. Shared between
//   • Today Track (mounted at the bottom, hard-wired to today)
//   • Review · Day scope (anchor follows the URL)
// Both surfaces read the same `state.reflections[date]` row, so writes
// from either side are reflected live in the other.

export interface ReflectionCardProps {
  date: string; // YYYY-MM-DD
  /** Card title — surfaces add their own date subtitle below. */
  title?: string;
  /** Subtitle override; defaults to the formatted `date`. */
  subtitle?: string;
}

export function ReflectionCard({
  date,
  title = '今日复盘',
  subtitle,
}: ReflectionCardProps) {
  const reflection = useStore((s) => selectReflection(s, date));
  const setReflection = useStore((s) => s.setReflection);

  const handleCommit = useCallback(
    (next: string | undefined) => {
      void setReflection(date, next ?? '');
    },
    [date, setReflection],
  );

  return (
    <section
      aria-label={`Reflection · ${date}`}
      className="flex flex-col gap-3 rounded-md border border-hairline/60 bg-surface-0 p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-ink-primary">{title}</h2>
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {subtitle ?? formatDateLabel(date)}
        </span>
      </header>
      <MarkdownField
        value={reflection?.content}
        onCommit={handleCommit}
        placeholder="+ 写点什么 · 日记 / 复盘 / 心情，全凭你 · Markdown"
        dialogTitle={`${title} · ${date}`}
        ariaLabel={`Reflection editor for ${date}`}
      />
    </section>
  );
}

// Friendly subtitle: `2026-04-27 · Mon`. The card sits below other
// timestamped content, so a short Mono label is enough — no need to
// localize fully.
function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const weekday = WEEKDAYS[date.getDay()] ?? '';
  return `${iso} · ${weekday}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
