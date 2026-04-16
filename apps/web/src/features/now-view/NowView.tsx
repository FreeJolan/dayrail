import { useTranslation } from 'react-i18next';
import { Button } from '@dayrail/ui';
import {
  selectCurrentAndNext,
  selectRailById,
  selectTodayCycle,
  selectTodaySlotForRail,
  useStore,
} from '../../store';
import type { Rail, RailInstance, Slot } from '@dayrail/core';

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

const PROGRESS_STEPS = [0, 25, 50, 75, 100];

export function NowView() {
  const { t, i18n } = useTranslation();
  const { current, next } = useStore(selectCurrentAndNext);
  const findRail = useStore((s) => (id: string) => selectRailById(id)(s));
  const getSlot = useStore((s) => (railId: string) => selectTodaySlotForRail(railId)(s));
  const setSlot = useStore((s) => s.setSlot);
  const todayCycle = useStore(selectTodayCycle);
  const trackDate = useStore((s) => s.track.date);
  const now = useStore((s) => s.now);
  const markDone = useStore((s) => s.markDone);
  const skip = useStore((s) => s.skip);

  if (!current) {
    return (
      <section className="rounded-lg border border-slate-200 p-6 text-center text-slate-500 dark:border-slate-800">
        {t('nothing_more_today')}
      </section>
    );
  }

  const currentRail = findRail(current.railId);
  const nextRail = next ? findRail(next.railId) : null;
  const start = new Date(current.plannedStart).getTime();
  const end = new Date(current.plannedEnd).getTime();
  const isLive = now >= start && now < end;
  const remainingMin = Math.max(0, Math.round((end - now) / 60_000));
  const startsInMin = Math.max(0, Math.round((start - now) / 60_000));

  const slot = currentRail ? getSlot(currentRail.id) : undefined;

  const advanceProgress = () => {
    if (!currentRail || !todayCycle) return;
    const cur = slot?.progress ?? 0;
    const idx = PROGRESS_STEPS.indexOf(cur);
    const nextVal = PROGRESS_STEPS[(idx + 1) % PROGRESS_STEPS.length]!;
    setSlot(todayCycle.id, trackDate, currentRail.id, { progress: nextVal });
  };

  return (
    <section className="flex flex-col gap-6">
      <CurrentCard
        rail={currentRail}
        instance={current}
        slot={slot}
        isLive={isLive}
        remainingMin={remainingMin}
        startsInMin={startsInMin}
        locale={i18n.language}
        onProgressClick={advanceProgress}
      />
      <div className="flex gap-3">
        <Button size="lg" className="flex-1" onClick={() => markDone(current.id)}>
          {t('rail:action_done')}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="flex-1"
          onClick={() => skip(current.id)}
        >
          {t('rail:action_skip')}
        </Button>
      </div>
      {nextRail && next && (
        <NextRow rail={nextRail} instance={next} locale={i18n.language} />
      )}
    </section>
  );
}

function CurrentCard(props: {
  rail: Rail | undefined;
  instance: RailInstance;
  slot: Slot | undefined;
  isLive: boolean;
  remainingMin: number;
  startsInMin: number;
  locale: string;
  onProgressClick: () => void;
}) {
  const { t } = useTranslation('rail');
  const { rail, instance, slot, isLive, remainingMin, startsInMin, locale, onProgressClick } = props;
  if (!rail) return null;
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const accent = COLOR_MAP[rail.color] ?? '#C97B4A';
  const taskName = slot?.taskName?.trim();
  const progress = slot?.progress ?? 0;

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-6 dark:border-slate-800"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
          {isLive ? 'NOW' : 'UP NEXT'}
        </span>
        <span className="font-mono text-xs text-slate-400">
          {timeFmt.format(new Date(instance.plannedStart))} – {timeFmt.format(new Date(instance.plannedEnd))}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="font-mono text-xs uppercase tracking-widest text-slate-500">{rail.name}</div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {taskName || <span className="text-slate-400">—</span>}
        </h2>
      </div>
      <div className="text-sm text-slate-500">
        {isLive
          ? t('remaining', { minutes: remainingMin })
          : t('starts_in', { minutes: startsInMin })}
      </div>
      {isLive && <TimeBar total={new Date(instance.plannedEnd).getTime() - new Date(instance.plannedStart).getTime()} remainingMs={remainingMin * 60_000} />}
      <button
        type="button"
        onClick={onProgressClick}
        className="group flex items-center gap-2 text-left font-mono text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      >
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="h-full transition-[width]" style={{ width: `${progress}%`, background: accent }} />
        </div>
        <span>{progress}%</span>
      </button>
    </div>
  );
}

function TimeBar({ total, remainingMs }: { total: number; remainingMs: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(((total - remainingMs) / total) * 100)));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="h-full bg-slate-500 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

function NextRow({ rail, instance, locale }: { rail: Rail; instance: RailInstance; locale: string }) {
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-4 text-sm text-slate-500 dark:border-slate-800">
      <span className="font-mono text-xs uppercase tracking-widest">NEXT</span>
      <span>{rail.name}</span>
      <span className="font-mono text-xs text-slate-400">{timeFmt.format(new Date(instance.plannedStart))}</span>
    </div>
  );
}

