import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  MessageSquareQuote,
  Sparkles,
} from 'lucide-react';
import { selectHabitPhasesByLine, useStore, type Line } from '@dayrail/core';
import { type ReviewScopeData } from '@/data/sampleReview';
import { RhythmHeatmap } from '@/components/RhythmHeatmap';
import { ShiftTagBars } from '@/components/ShiftTagBars';
import {
  buildPhaseBands,
  cycleDatesFor,
  deriveReviewData,
  monthDatesFor,
  type PhaseBand,
} from './reviewFromStore';
import { toIsoDate } from './cycleFromStore';

// ERD §5.8 F2 Review: per-scope top-to-bottom waterfall.
//   title → rhythm heatmap → Top-5 Shift tags → Ad-hoc hint → AI cards
//
// Desktop side-by-side of day/week/month is the target per §5.8, but
// the static mock renders one scope at a time via a segmented control
// (that's the spec for mobile; desktop side-by-side needs a wider-than-
// 1440 layout and real data, both arriving later).

type Scope = 'day' | 'cycle' | 'month';

const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: 'day', label: 'Day' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'month', label: 'Month' },
];

const VALID_SCOPES: Scope[] = ['day', 'cycle', 'month'];

function isScope(s: string | undefined): s is Scope {
  return !!s && (VALID_SCOPES as string[]).includes(s);
}

function parseAnchor(iso: string | undefined): Date | null {
  if (!iso) return null;
  // Strict YYYY-MM-DD; reject anything else so the URL stays predictable.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function Review() {
  const { scope: scopeParam, anchor: anchorParam } = useParams<{
    scope?: string;
    anchor?: string;
  }>();
  const navigate = useNavigate();
  const scope: Scope = isScope(scopeParam) ? scopeParam : 'cycle';
  const anchor = useMemo(
    () => parseAnchor(anchorParam) ?? new Date(),
    [anchorParam],
  );
  const [aiEnabled, setAiEnabled] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const habitLineId = searchParams.get('habit') ?? undefined;

  // Keep the URL the source of truth. Anchor edits produce a navigate()
  // call; a scope change carries the current anchor along so you
  // don't lose your place switching between Day / Cycle / Month.
  const setScope = useCallback(
    (next: Scope) => {
      // Preserve any ?habit= filter when changing scope.
      const query = searchParams.toString();
      navigate(
        `/review/${next}/${toIsoDate(anchor)}${query ? `?${query}` : ''}`,
      );
    },
    [anchor, navigate, searchParams],
  );
  const setAnchor = useCallback(
    (next: Date) => {
      const query = searchParams.toString();
      navigate(
        `/review/${scope}/${toIsoDate(next)}${query ? `?${query}` : ''}`,
      );
    },
    [scope, navigate, searchParams],
  );
  const setHabitLineId = useCallback(
    (next: string | undefined) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (next) n.set('habit', next);
          else n.delete('habit');
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const rails = useStore((s) => s.rails);
  const tasks = useStore((s) => s.tasks);
  const templates = useStore((s) => s.templates);
  const calendarRules = useStore((s) => s.calendarRules);
  const shifts = useStore((s) => s.shifts);
  const adhocEvents = useStore((s) => s.adhocEvents);
  const lines = useStore((s) => s.lines);
  const habitPhases = useStore((s) => s.habitPhases);
  const habitBindings = useStore((s) => s.habitBindings);

  const habits = useMemo<Line[]>(
    () =>
      Object.values(lines)
        .filter((l) => l.kind === 'habit' && l.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lines],
  );

  const stateSlice = useMemo(
    () => ({
      rails,
      tasks,
      templates,
      calendarRules,
      shifts,
      adhocEvents,
      habitBindings,
    }),
    [rails, tasks, templates, calendarRules, shifts, adhocEvents, habitBindings],
  );

  const data = useMemo<ReviewScopeData>(
    () => computeReviewData(stateSlice, scope, anchor, habitLineId),
    [stateSlice, scope, anchor, habitLineId],
  );

  // Previous period — lets the header show "62% this cycle · +5pt vs
  // last". Only the match / done / total numbers are read, so we drop
  // the rest of the deriveReviewData output on the floor.
  const prevData = useMemo<ReviewScopeData>(() => {
    const prevAnchor = shiftAnchorDate(anchor, scope, -1);
    return computeReviewData(stateSlice, scope, prevAnchor, habitLineId);
  }, [stateSlice, scope, anchor, habitLineId]);

  const phaseBands = useMemo<PhaseBand[]>(() => {
    if (!habitLineId) return [];
    const phases = selectHabitPhasesByLine({ habitPhases }, habitLineId);
    return buildPhaseBands(phases, data.dates);
  }, [habitLineId, habitPhases, data.dates]);

  const shiftAnchor = (direction: -1 | 1) => {
    setAnchor(shiftAnchorDate(anchor, scope, direction));
  };

  return (
    <div className="flex w-full flex-col px-10 xl:px-14">
      <TopBar scope={scope} onScopeChange={setScope} />

      <PeriodPager
        data={data}
        onPrev={() => shiftAnchor(-1)}
        onNext={() => shiftAnchor(1)}
        onToday={() => setAnchor(new Date())}
      />

      {habits.length > 0 && (
        <HabitFilterRow
          habits={habits}
          value={habitLineId}
          onChange={setHabitLineId}
        />
      )}

      <div className="flex flex-col gap-10 pb-16 pt-8">
        {/* Per-scope waterfall */}
        <RhythmHeatmap data={data} prev={prevData} phaseBands={phaseBands} />
        <ShiftTagBars tags={data.shiftTags} />
        {data.adhocHint && <AdhocHintCard hint={data.adhocHint} />}
        <AISection enabled={aiEnabled} onToggle={() => setAiEnabled((v) => !v)} />

        <Footer scope={scope} data={data} />
      </div>
    </div>
  );
}

function computeReviewData(
  stateSlice: Parameters<typeof deriveReviewData>[0],
  scope: Scope,
  anchor: Date,
  habitLineId: string | undefined,
): ReviewScopeData {
  if (scope === 'day') {
    const date = toIsoDate(anchor);
    return deriveReviewData(stateSlice, {
      scope,
      label: formatDayLabel(anchor),
      dates: [date],
      ...(habitLineId && { habitLineId }),
    });
  }
  if (scope === 'cycle') {
    const dates = cycleDatesFor(anchor);
    return deriveReviewData(stateSlice, {
      scope,
      label: formatCycleLabel(dates[0]!, dates[6]!),
      dates,
      ...(habitLineId && { habitLineId }),
    });
  }
  const dates = monthDatesFor(anchor.getFullYear(), anchor.getMonth() + 1);
  return deriveReviewData(stateSlice, {
    scope,
    label: formatMonthLabel(anchor),
    dates,
    ...(habitLineId && { habitLineId }),
  });
}

function shiftAnchorDate(anchor: Date, scope: Scope, delta: number): Date {
  const next = new Date(anchor);
  if (scope === 'day') next.setDate(next.getDate() + delta);
  else if (scope === 'cycle') next.setDate(next.getDate() + delta * 7);
  else next.setMonth(next.getMonth() + delta);
  return next;
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCycleLabel(startIso: string, endIso: string): string {
  const s = new Date(`${startIso}T00:00:00`);
  const e = new Date(`${endIso}T00:00:00`);
  const fmt = (x: Date) =>
    x.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function HabitFilterRow({
  habits,
  value,
  onChange,
}: {
  habits: Line[];
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  return (
    <div className="hairline-b flex flex-wrap items-center gap-2 -mx-10 px-10 pb-3 xl:-mx-14 xl:px-14">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Habit 节奏
      </span>
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className={clsx(
          'rounded-sm px-2 py-0.5 text-xs transition',
          value == null
            ? 'bg-ink-primary text-surface-0'
            : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
        )}
      >
        所有 Rail
      </button>
      {habits.map((h) => {
        const active = value === h.id;
        return (
          <button
            key={h.id}
            type="button"
            onClick={() => onChange(active ? undefined : h.id)}
            className={clsx(
              'rounded-sm px-2 py-0.5 text-xs transition',
              active
                ? 'bg-ink-primary text-surface-0'
                : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
            )}
          >
            {h.name}
          </button>
        );
      })}
    </div>
  );
}

function TopBar({
  scope,
  onScopeChange,
}: {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
}) {
  // "Review" reads as the page title. A thin vertical rule + wider gap
  // separate it from the Day/Cycle/Month segmented so the three scopes
  // don't appear to be a 4-option row with "Review" as sibling.
  return (
    <header className="sticky top-0 z-40 -mx-10 flex h-[52px] items-center justify-between gap-4 bg-surface-0 px-10 xl:-mx-14 xl:px-14">
      <div className="flex items-center gap-4">
        <span className="font-mono text-sm font-medium tracking-wide text-ink-primary">
          Review
        </span>
        <span
          aria-hidden
          className="h-4 w-px bg-hairline"
        />
        <ScopeSegmented value={scope} onChange={onScopeChange} />
      </div>

      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        §5.8 · Rhythm
      </span>
    </header>
  );
}

function ScopeSegmented({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (s: Scope) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-surface-1 p-0.5">
      {SCOPES.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          className={clsx(
            'rounded-sm px-3 py-1 font-mono text-2xs uppercase tracking-widest transition',
            value === s.key
              ? 'bg-surface-3 text-ink-primary'
              : 'text-ink-secondary hover:text-ink-primary',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function PeriodPager({
  data,
  onPrev,
  onNext,
  onToday,
}: {
  data: ReviewScopeData;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="hairline-b sticky top-[52px] z-20 -mx-10 flex h-9 items-center gap-3 bg-surface-0 px-10 xl:-mx-14 xl:px-14">
      <button
        type="button"
        aria-label="Previous period"
        onClick={onPrev}
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <span className="font-mono text-sm tabular-nums text-ink-primary">
        {data.label}
      </span>
      <button
        type="button"
        aria-label="Next period"
        onClick={onNext}
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={onToday}
        className="rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        Today
      </button>
      <span className="ml-2 text-xs text-ink-tertiary">
        {describeScope(data.scope)}
      </span>
    </div>
  );
}

function describeScope(scope: Scope): string {
  if (scope === 'day') return '当日回放';
  if (scope === 'cycle') return '本周期节奏';
  return '本月节奏';
}

function AdhocHintCard({
  hint,
}: {
  hint: NonNullable<ReviewScopeData['adhocHint']>;
}) {
  return (
    <section aria-label="Ad-hoc → Template suggestion" className="rounded-md bg-surface-1 p-4">
      <header className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-ink-tertiary" strokeWidth={1.6} />
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Ad-hoc → Template
        </span>
      </header>
      <p className="mt-2 text-sm text-ink-primary">
        《{hint.eventName}》连续{' '}
        <span className="font-mono tabular-nums text-ink-primary">
          {hint.occurrences}
        </span>{' '}
        周出现在 <span className="font-mono">{hint.weekdayLabel}</span>。考虑把它放进模板吗？
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-sm bg-ink-primary px-2.5 py-1 text-xs font-medium text-surface-0 transition hover:bg-ink-secondary"
        >
          加入模板
        </button>
        <button
          type="button"
          className="rounded-sm px-2.5 py-1 text-xs font-medium text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-secondary"
        >
          保持 Ad-hoc
        </button>
        <button
          type="button"
          className="rounded-sm px-2.5 py-1 text-xs font-medium text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-secondary"
        >
          不再提示
        </button>
      </div>
    </section>
  );
}

function AISection({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  if (!enabled) {
    return (
      <section className="rounded-md bg-surface-1 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="group flex w-full items-center gap-2 text-left"
          aria-label="Toggle AI preview"
        >
          <Sparkles className="h-4 w-4 text-ink-tertiary" strokeWidth={1.6} />
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            AI Observe · Review
          </span>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary/60">
            · off
          </span>
          <span className="ml-auto text-xs text-ink-tertiary opacity-0 transition group-hover:opacity-100">
            ▾ preview mock
          </span>
        </button>
        <p className="mt-2 text-sm text-ink-secondary">
          AI 默认关闭（§6.4）。启用后这里会出现 AI Observe 的模式观察 + AI Review 的结构化周期回顾。
          自备 OpenRouter API Key，见 Settings → AI 辅助。
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <MockObserveCard />
      <MockReviewCard />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-sm px-2.5 py-1 text-xs font-medium text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-secondary"
        >
          关闭预览
        </button>
      </div>
    </div>
  );
}

function MockObserveCard() {
  return (
    <section className="rounded-md bg-surface-1 p-4">
      <header className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-ink-tertiary" strokeWidth={1.6} />
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
          AI Observe
        </span>
      </header>
      <ul className="mt-2 flex flex-col gap-2 text-sm text-ink-secondary">
        <li>
          · <span className="text-ink-primary">周三下午</span> 的
          《工作 · 编码》连续 3 周被挤压 ——
          考虑缩短到 90 min 或挪到其他时段？
        </li>
        <li>
          · 晨跑 5 天中 <span className="text-ink-primary">4 次完成</span>，
          目前处于建立期，保持节奏即可。
        </li>
        <li>
          · <span className="text-ink-primary">会议冲突</span> 标签本周出现 5 次 ——
          比上周 (2) 明显上升。
        </li>
      </ul>
    </section>
  );
}

function MockReviewCard() {
  return (
    <section className="rounded-md bg-surface-1 p-4">
      <header className="flex items-center gap-2">
        <MessageSquareQuote className="h-4 w-4 text-ink-tertiary" strokeWidth={1.6} />
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
          AI Review · Cycle 回顾
        </span>
      </header>
      <div className="mt-2 flex flex-col gap-2 text-sm text-ink-primary">
        <p>
          本周期节奏匹配度 <span className="font-mono tabular-nums">62%</span>，
          与过去四个 cycle 平均值 <span className="font-mono tabular-nums">65%</span> 相近。
        </p>
        <p className="text-ink-secondary">
          变动最集中在
          <span className="text-ink-primary"> 工作·深度任务 </span>
          与
          <span className="text-ink-primary"> 英语 </span>
          两条 Rail；其它 Rail 均处于稳定节律。
        </p>
        <p className="text-ink-secondary">
          Project 进度方面：DayRail 开发本周期推进 2 条任务（Template Editor 静态页 + Cycle View 静态页），
          符合原计划；考研 408 完成 4 节，略低于预期（5）。
        </p>
      </div>
    </section>
  );
}

function Footer({ scope, data }: { scope: Scope; data: ReviewScopeData }) {
  return (
    <footer className="flex items-center justify-between pt-3 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>
        {scope} · {data.rows.length} rails · {data.totalSlots} slots
      </span>
      <span>static mock · ERD §5.8</span>
    </footer>
  );
}
