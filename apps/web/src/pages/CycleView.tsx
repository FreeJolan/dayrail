import { useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  SAMPLE_CYCLE,
  buildSlotMap,
  groupDaysByTemplate,
  type CycleDay,
  type SampleCycle,
} from '@/data/sampleCycle';
import type { TemplateKey } from '@/data/sampleTemplate';
import { EditSessionIndicator } from '@/components/EditSessionIndicator';
import { CyclePagerPicker } from '@/components/CyclePagerPicker';
import { CycleSummaryStrip } from '@/components/CycleSummaryStrip';
import { CycleMasterDayHeader } from '@/components/CycleMasterDayHeader';
import { CycleSection } from '@/components/CycleSection';
import { BacklogDrawer } from '@/components/BacklogDrawer';

// ERD §5.3 Cycle View static mock (D1–D8).
// Layout:
//   ┌── Left main column ────────────────────────────────┬── Backlog ──┐
//   │ Top bar: Cycle pager · edit-session indicator · ⋯  │             │
//   │ Summary strip (Top-3 Line progress bars)           │  Unpinned   │
//   │ Master day header (7 columns, click → pop)         │  Chunks     │
//   │                                                    │             │
//   │  ▓ Workday section (Mon → Thu, 4 days grid)        │             │
//   │  ▓ Restday section (Fri–Sun, 3 days grid)          │             │
//   │                                                    │             │
//   └────────────────────────────────────────────────────┴─────────────┘

const TODAY_ISO = '2026-04-17';

export function CycleView() {
  const [cycle, setCycle] = useState<SampleCycle>(SAMPLE_CYCLE);
  // Backlog default-closed: the 320 px drawer was eating main content
  // width; most users only open it when actively scheduling.
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [changeCount, setChangeCount] = useState(2);

  const groups = useMemo(() => groupDaysByTemplate(cycle), [cycle]);
  const slotMap = useMemo(() => buildSlotMap(cycle), [cycle]);

  const overrideDay = (date: string, nextTemplate: TemplateKey) => {
    setCycle((prev) => ({
      ...prev,
      days: prev.days.map((d) =>
        d.date === date
          ? { ...d, templateKey: nextTemplate, overridden: true }
          : d,
      ),
    }));
    setChangeCount((c) => c + 1);
  };

  const clearOverride = (date: string) => {
    setCycle((prev) => ({
      ...prev,
      days: prev.days.map((d) => {
        if (d.date !== date) return d;
        // "clear override" — revert to weekday default
        const defaultTpl: TemplateKey =
          d.weekday === 0 || d.weekday === 6 ? 'restday' : 'workday';
        return { ...d, templateKey: defaultTpl, overridden: false };
      }),
    }));
    setChangeCount((c) => c + 1);
  };

  return (
    <div className="flex min-h-screen w-full">
      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col pl-10 pr-6 xl:pl-14">
        <TopBar
          cycle={cycle}
          onSelectCycle={(c) => setCycle(c)}
          changeCount={changeCount}
        />

        <CycleSummaryStrip cycle={cycle} />

        <div className="pt-6">
          <CycleMasterDayHeader
            days={cycle.days}
            todayISO={TODAY_ISO}
            onOverride={overrideDay}
            onClearOverride={clearOverride}
          />
        </div>

        <div className="flex flex-col gap-5 pt-6 pb-16">
          {groups.map(({ templateKey, days }) => (
            <CycleSection
              key={templateKey}
              templateKey={templateKey}
              days={days}
              slotsByKey={slotMap}
              todayISO={TODAY_ISO}
            />
          ))}

          <CycleFooter groups={groups} cycle={cycle} />
        </div>
      </div>

      <BacklogDrawer
        open={backlogOpen}
        onToggle={() => setBacklogOpen((v) => !v)}
      />
    </div>
  );
}

function TopBar({
  cycle,
  onSelectCycle,
  changeCount,
}: {
  cycle: SampleCycle;
  onSelectCycle: (c: SampleCycle) => void;
  changeCount: number;
}) {
  return (
    <header className="sticky top-0 z-40 -mx-10 flex h-[52px] items-center justify-between gap-4 bg-surface-0 px-10">
      <div className="flex items-center gap-3">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Cycle
        </span>
        <CyclePagerPicker current={cycle} onSelect={onSelectCycle} />
      </div>

      <div className="flex items-center gap-3">
        <EditSessionIndicator changeCount={changeCount} />
        <button
          type="button"
          aria-label="Cycle menu"
          className="rounded-sm p-1 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          title="Cycle menu (未实装)"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}

function CycleFooter({
  groups,
  cycle,
}: {
  groups: Array<{ templateKey: TemplateKey; days: CycleDay[] }>;
  cycle: SampleCycle;
}) {
  return (
    <footer className="flex items-center justify-between pt-3 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>
        {cycle.days.length} days · {groups.length} sections ·{' '}
        {cycle.slots.length} slots
      </span>
      <span>
        static mock · ERD §5.3
      </span>
    </footer>
  );
}
