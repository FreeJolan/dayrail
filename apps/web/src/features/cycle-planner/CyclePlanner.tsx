import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Cycle, CycleDay, Rail, Slot, TemplateKey } from '@dayrail/core';
import { selectActiveCycle, useStore } from '../../store';

const PROGRESS_STEPS = [0, 25, 50, 75, 100];
const COLOR_MAP: Record<string, string> = {
  sand: '#AFA18B',
  sage: '#868E82',
  olive: '#8B8D7A',
  teal: '#12A594',
  mauve: '#86848D',
  brown: '#AD7F58',
  amber: '#FFB224',
  pink: '#D6409F',
  slate: '#8B8D98',
};

const pad = (n: number) => n.toString().padStart(2, '0');
const minutesToHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

const shortDateFmt = (date: string, locale: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(dt);
};

const mmdd = (date: string) => {
  const [, m, d] = date.split('-');
  return `${m}/${d}`;
};

// Week-of-month: W1 starts on the first Monday of the cycle's start month.
// Dates before the first Monday roll into the previous month's last week.
function weekOfMonth(date: string): { month: number; week: number } {
  const [y, m, d] = date.split('-').map(Number);
  const firstOfMonth = new Date(y!, (m ?? 1) - 1, 1);
  const firstMondayDay = 1 + ((8 - firstOfMonth.getDay()) % 7);
  if ((d ?? 1) < firstMondayDay) {
    const prev = new Date(y!, (m ?? 1) - 1, 0);
    return weekOfMonth(
      `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`
    );
  }
  const week = Math.floor(((d ?? 1) - firstMondayDay) / 7) + 1;
  return { month: m ?? 1, week };
}

const cycleLabel = (c: Cycle, suffix?: string) => {
  const { month, week } = weekOfMonth(c.startDate);
  const range = `${mmdd(c.startDate)}~${mmdd(c.endDate)}`;
  return `M${month} W${week} (${range})${suffix ? ` · ${suffix}` : ''}`;
};

export function CyclePlanner() {
  const { t, i18n } = useTranslation();
  const cycle = useStore(selectActiveCycle);
  const cycles = useStore((s) => s.cycles);
  const trackDate = useStore((s) => s.track.date);
  const railsByTemplate = useStore((s) => s.railsByTemplate);
  const setCycleDayTemplate = useStore((s) => s.setCycleDayTemplate);
  const setSlot = useStore((s) => s.setSlot);
  const updateCycleRange = useStore((s) => s.updateCycleRange);
  const navigateCycle = useStore((s) => s.navigateCycle);
  const setActiveCycle = useStore((s) => s.setActiveCycle);

  const timeBlocks = useMemo(() => {
    const merged = new Map<string, { key: string; startMinutes: number; labels: Set<string> }>();
    for (const key of Object.keys(railsByTemplate) as TemplateKey[]) {
      for (const rail of railsByTemplate[key]) {
        const bucket = `${minutesToHHMM(rail.startMinutes)}-${minutesToHHMM(rail.startMinutes + rail.durationMinutes)}`;
        const existing = merged.get(bucket);
        if (existing) {
          existing.labels.add(rail.name);
        } else {
          merged.set(bucket, {
            key: bucket,
            startMinutes: rail.startMinutes,
            labels: new Set([rail.name]),
          });
        }
      }
    }
    return [...merged.values()].sort((a, b) => a.startMinutes - b.startMinutes);
  }, [railsByTemplate]);

  if (!cycle) return null;

  const sortedCycles = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <section className="flex flex-col gap-4">
      <CycleHeader
        key={cycle.id}
        cycle={cycle}
        cycles={sortedCycles}
        trackDate={trackDate}
        onSelect={(id) => setActiveCycle(id)}
        onNext={() => navigateCycle('next')}
        onToday={() => navigateCycle('today')}
        onRangeChange={(start, end) => updateCycleRange(cycle.id, start, end)}
        currentLabel={t('cycle_current_tag')}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-canvas-light p-2 text-left font-mono text-xs uppercase tracking-widest text-slate-400 dark:bg-canvas-dark">
                {' '}
              </th>
              {cycle.days.map((day) => {
                const isToday = day.date === trackDate;
                return (
                  <th
                    key={day.date}
                    className={`relative min-w-[140px] p-2 align-top ${
                      isToday ? 'bg-slate-50/80 dark:bg-slate-900/60' : ''
                    }`}
                  >
                    {isToday && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-slate-900 dark:bg-slate-100"
                      />
                    )}
                    <DayHeader
                      day={day}
                      locale={i18n.language}
                      isToday={isToday}
                      onToggleTemplate={() =>
                        setCycleDayTemplate(
                          cycle.id,
                          day.date,
                          day.templateKey === 'workday' ? 'restday' : 'workday'
                        )
                      }
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {timeBlocks.map((block) => (
              <tr key={block.key}>
                <th className="sticky left-0 z-10 bg-canvas-light p-2 text-left align-top font-mono text-xs text-slate-400 dark:bg-canvas-dark">
                  <div>{block.key}</div>
                  <div className="font-sans text-[11px] normal-case text-slate-500">
                    {[...block.labels].join(' / ')}
                  </div>
                </th>
                {cycle.days.map((day) => {
                  const rails = railsByTemplate[day.templateKey];
                  const [bucketStart, bucketEnd] = block.key.split('-');
                  const rail = rails.find(
                    (r) =>
                      minutesToHHMM(r.startMinutes) === bucketStart &&
                      minutesToHHMM(r.startMinutes + r.durationMinutes) === bucketEnd
                  );
                  const isToday = day.date === trackDate;
                  return (
                    <td
                      key={day.date}
                      className={`border-t border-slate-100 p-1 align-top dark:border-slate-800 ${
                        isToday ? 'bg-slate-50/60 dark:bg-slate-900/40' : ''
                      }`}
                    >
                      {rail ? (
                        <SlotCell
                          key={`${cycle.id}:${day.date}:${rail.id}`}
                          rail={rail}
                          slot={day.slots.find((x) => x.railId === rail.id)}
                          onSet={(patch) => setSlot(cycle.id, day.date, rail.id, patch)}
                        />
                      ) : (
                        <div className="h-10 rounded bg-slate-100/40 dark:bg-slate-900/40" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CycleHeader({
  cycle,
  cycles,
  trackDate,
  onSelect,
  onNext,
  onToday,
  onRangeChange,
  currentLabel,
}: {
  cycle: Cycle;
  cycles: Cycle[];
  trackDate: string;
  onSelect: (id: string) => void;
  onNext: () => void;
  onToday: () => void;
  onRangeChange: (startDate: string, endDate: string) => void;
  currentLabel: string;
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState(cycle.startDate);
  const [end, setEnd] = useState(cycle.endDate);

  const commitStart = () => {
    if (start !== cycle.startDate) onRangeChange(start, end);
  };
  const commitEnd = () => {
    if (end !== cycle.endDate) onRangeChange(start, end);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <select
          value={cycle.id}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded border border-slate-200 bg-transparent px-3 py-1 font-mono text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          {cycles.map((c) => {
            const isCurrent = trackDate >= c.startDate && trackDate <= c.endDate;
            return (
              <option key={c.id} value={c.id}>
                {cycleLabel(c, isCurrent ? currentLabel : undefined)}
              </option>
            );
          })}
        </select>
        <NavButton onClick={onNext}>{t('cycle_next')} →</NavButton>
        <NavButton onClick={onToday}>{t('cycle_today')}</NavButton>
      </div>

      <div className="flex items-center gap-2 font-mono text-xs">
        <input
          type="date"
          value={start}
          max={end}
          onChange={(e) => setStart(e.target.value)}
          onBlur={commitStart}
          className="rounded border border-slate-200 bg-transparent px-2 py-1 dark:border-slate-700"
        />
        <span className="text-slate-400">—</span>
        <input
          type="date"
          value={end}
          min={start}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={commitEnd}
          className="rounded border border-slate-200 bg-transparent px-2 py-1 dark:border-slate-700"
        />
      </div>
    </div>
  );
}

function NavButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-slate-200 px-3 py-1 font-mono text-xs text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
    >
      {children}
    </button>
  );
}

function DayHeader({
  day,
  locale,
  isToday,
  onToggleTemplate,
}: {
  day: CycleDay;
  locale: string;
  isToday: boolean;
  onToggleTemplate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div
        className={`font-mono text-xs ${
          isToday
            ? 'font-semibold text-slate-900 dark:text-slate-100'
            : 'text-slate-500'
        }`}
      >
        {shortDateFmt(day.date, locale)}
      </div>
      <button
        type="button"
        onClick={onToggleTemplate}
        className="rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest transition"
        style={{
          background: day.templateKey === 'workday' ? '#12A594' : '#FFB224',
          color: day.templateKey === 'workday' ? '#fff' : '#1f1f1f',
        }}
      >
        {day.templateKey === 'workday' ? t('template_workday') : t('template_restday')}
      </button>
    </div>
  );
}

function SlotCell({
  rail,
  slot,
  onSet,
}: {
  rail: Rail;
  slot: Slot | undefined;
  onSet: (patch: Partial<Slot>) => void;
}) {
  const [value, setValue] = useState(slot?.taskName ?? '');
  const progress = slot?.progress ?? 0;

  const cycleProgress = () => {
    const idx = PROGRESS_STEPS.indexOf(progress);
    const nextVal = PROGRESS_STEPS[(idx + 1) % PROGRESS_STEPS.length]!;
    onSet({ progress: nextVal });
  };

  return (
    <div className="flex flex-col gap-1 rounded p-1">
      <input
        value={value}
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== (slot?.taskName ?? '')) onSet({ taskName: value });
        }}
        className="w-full bg-transparent text-xs outline-none placeholder:text-slate-300 focus:border-b focus:border-slate-400 dark:placeholder:text-slate-600"
      />
      <button
        type="button"
        onClick={cycleProgress}
        className="flex items-center gap-1 font-mono text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      >
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full transition-[width]"
            style={{ width: `${progress}%`, background: COLOR_MAP[rail.color] ?? '#64748b' }}
          />
        </div>
        <span>{progress}%</span>
      </button>
    </div>
  );
}
