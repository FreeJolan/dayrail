import { clsx } from 'clsx';
import type { SampleCycle } from '@/data/sampleCycle';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.3 D5 — 36 px sticky summary strip below the Cycle top bar.
// Shows the Top-3 Line progress bars: <LineName> N/M. Numbers derived
// live from scheduled slots + done counts. Mono to match Template
// Editor's strip grammar (E5 sibling).

interface Props {
  cycle: SampleCycle;
}

export function CycleSummaryStrip({ cycle }: Props) {
  return (
    <div className="hairline-b sticky top-[52px] z-20 -mx-10 flex h-9 items-center gap-6 bg-surface-0 px-10">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Top Lines
      </span>
      <div className="flex flex-1 items-center gap-5">
        {cycle.topLines.map((line) => (
          <LineBar
            key={line.id}
            name={line.name}
            done={line.done}
            planned={line.planned}
            color={RAIL_COLOR_HEX[line.color]}
          />
        ))}
      </div>
    </div>
  );
}

function LineBar({
  name,
  done,
  planned,
  color,
}: {
  name: string;
  done: number;
  planned: number;
  color: string;
}) {
  const pct = planned > 0 ? Math.round((done / planned) * 100) : 0;
  return (
    <div className="flex min-w-[180px] items-center gap-3">
      <span className="font-mono text-xs text-ink-secondary whitespace-nowrap">
        {name}
      </span>
      <div
        className={clsx(
          'relative h-1 flex-1 overflow-hidden bg-surface-2',
        )}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-ink-secondary whitespace-nowrap">
        {done}
        <span className="text-ink-tertiary">/{planned}</span>
      </span>
    </div>
  );
}
