import { CheckInStrip } from '@/components/CheckInStrip';
import { RailCard } from '@/components/RailCard';
import { CHECKIN_QUEUE, MOCK_NOW, SAMPLE_RAILS } from '@/data/sample';

// Page layout — ERD A/B/C decisions:
//   • left sidebar nav (provided by App.tsx)
//   • simple `NOW` header, Mono date subtitle
//   • §5.6 check-in strip at top when queue is non-empty
//   • single vertical timeline of Rail cards (no bento, no side visualizer)

export function TodayTrack() {
  // Intentional Asymmetry (G6): content sits left-weighted, never centered.
  // Left pad echoes book-margin proportions; extra width on ultrawides
  // stays empty rather than diluting focus.
  return (
    <div className="flex w-full max-w-[780px] flex-col gap-8 py-10 pl-10 pr-10 lg:pl-14 xl:pl-20">
      <PageHeader />
      <CheckInStrip queue={CHECKIN_QUEUE} />
      <Timeline />
      <Footnote />
    </div>
  );
}

function PageHeader() {
  const time = `${pad(MOCK_NOW.hh)}:${pad(MOCK_NOW.mm)}`;
  return (
    <header className="flex items-end justify-between gap-6 pt-2">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-ink-tertiary">
          Now
        </span>
        <div className="flex items-baseline gap-4">
          <h1 className="font-mono text-3xl text-ink-primary tabular-nums">
            {time}
          </h1>
          <span className="font-mono text-sm text-ink-secondary tabular-nums">
            {MOCK_NOW.weekdayShort} · {MOCK_NOW.dayLabel}
          </span>
        </div>
      </div>
      <DayProgressBar />
    </header>
  );
}

/** A slim Mono-labelled progress slice — the day as a ruler.
 *  Treat this as a navigation echo, not a task-completion bar. */
function DayProgressBar() {
  const dayStartMin = 6 * 60; // 06:00
  const dayEndMin = 24 * 60; // 24:00
  const nowMin = MOCK_NOW.hh * 60 + MOCK_NOW.mm;
  const pct = Math.max(0, Math.min(100, ((nowMin - dayStartMin) / (dayEndMin - dayStartMin)) * 100));
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Day · 06 → 24
      </span>
      <div className="relative h-[3px] w-[180px] overflow-hidden bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 bg-ink-secondary/70"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute -top-[3px] h-[9px] w-[1.5px] bg-cta"
          style={{ left: `calc(${pct}% - 0.75px)` }}
        />
      </div>
    </div>
  );
}

function Timeline() {
  const visible = SAMPLE_RAILS.filter((r) => r.state !== 'unmarked');
  //                       ^— unmarked rails live in the §5.6 strip until the
  //                          user processes them, so they drop out of the
  //                          main timeline to keep visual weight on
  //                          "what's next" rather than "what you missed."

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel text="Today" right={`${visible.length} rails`} />
      <ul className="flex flex-col gap-2.5">
        {visible.map((r) => (
          <li key={r.id}>
            <RailCard rail={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionLabel({ text, right }: { text: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {text}
      </span>
      {right && (
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {right}
        </span>
      )}
    </div>
  );
}

function Footnote() {
  return (
    <footer className="mt-4 flex justify-between font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>DayRail · v0.1-pre (static mock)</span>
      <span>Press · to jump to pending queue</span>
    </footer>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
