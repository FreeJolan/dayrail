import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  NotebookPen,
} from 'lucide-react';
import {
  selectHabitPhasesByLine,
  useStore,
  type DailyReflection,
  type Line,
} from '@dayrail/core';
import { type ReviewScopeData } from '@/data/sampleReview';
import { MarkdownView } from '@/components/MarkdownField';
import { RhythmHeatmap } from '@/components/RhythmHeatmap';
import { ReflectionCard } from '@/components/ReflectionCard';
import { ShiftTagBars } from '@/components/ShiftTagBars';
import { CycleReflectionAi } from '@/components/CycleReflectionAi';
import { MonthReflectionAi } from '@/components/MonthReflectionAi';
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
  const railRevisions = useStore((s) => s.railRevisions);
  const railTombstones = useStore((s) => s.railTombstones);
  const tasks = useStore((s) => s.tasks);
  const templates = useStore((s) => s.templates);
  const calendarRules = useStore((s) => s.calendarRules);
  const calendarRuleRevisions = useStore((s) => s.calendarRuleRevisions);
  const calendarRuleTombstones = useStore((s) => s.calendarRuleTombstones);
  const shifts = useStore((s) => s.shifts);
  const adhocEvents = useStore((s) => s.adhocEvents);
  const lines = useStore((s) => s.lines);
  const habitPhases = useStore((s) => s.habitPhases);
  const habitBindings = useStore((s) => s.habitBindings);
  const userDayNotes = useStore((s) => s.userDayNotes);
  const userProfile = useStore((s) => s.userProfile);

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
      railRevisions,
      railTombstones,
      tasks,
      templates,
      calendarRules,
      calendarRuleRevisions,
      calendarRuleTombstones,
      shifts,
      adhocEvents,
      habitBindings,
      userDayNotes,
      userProfile,
    }),
    [
      rails,
      railRevisions,
      railTombstones,
      tasks,
      templates,
      calendarRules,
      calendarRuleRevisions,
      calendarRuleTombstones,
      shifts,
      adhocEvents,
      habitBindings,
      userDayNotes,
      userProfile,
    ],
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

        {scope === 'day' ? (
          <ReflectionCard
            date={toIsoDate(anchor)}
            title="Daily Reflection · 今日复盘"
          />
        ) : (
          <>
            {scope === 'cycle' && data.dates.length > 0 && (
              <CycleReflectionAi
                cycleStartDate={data.dates[0]!}
                cycleEndDate={data.dates[data.dates.length - 1]!}
                rows={data.rows}
                dates={data.dates}
              />
            )}
            {scope === 'month' && data.dates.length > 0 && (
              <MonthReflectionAi
                monthStart={data.dates[0]!}
                monthEnd={data.dates[data.dates.length - 1]!}
                rows={data.rows}
                dates={data.dates}
              />
            )}
            <ReflectionLog dates={data.dates} />
          </>
        )}

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

// ERD §5.8 · Cycle / Month tab entry into per-day reflections. Lists
// only the dates in the current scope that already have content — a
// pure deep-link surface, not an editor. Empty state shows a single
// muted line so the section still anchors the eye on a quiet period.
// Aggregating / summarising reflections is intentionally out of scope
// (deferred to v0.5+); this is just navigation.
function ReflectionLog({ dates }: { dates: string[] }) {
  const reflections = useStore((s) => s.reflections);
  const entries = useMemo(() => {
    const out: Array<{ date: string; reflection: DailyReflection }> = [];
    for (const d of dates) {
      const r = reflections[d];
      if (r) out.push({ date: d, reflection: r });
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }, [dates, reflections]);

  return (
    <section
      aria-label="Reflection log"
      className="flex flex-col gap-3 rounded-md border border-hairline/60 bg-surface-0 p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink-primary">
          <NotebookPen className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.8} />
          复盘记录 · Reflection log
        </h2>
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {entries.length} / {dates.length} days
        </span>
      </header>
      {entries.length === 0 ? (
        <p className="text-xs text-ink-tertiary">
          本周期未写复盘 —— 在 Today Track 或 Day scope 写一段，将在这里出现。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/40">
          {entries.map(({ date, reflection }) => (
            <ReflectionLogRow
              key={date}
              date={date}
              reflection={reflection}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// One reflection-log row · §5.8.
//   • Click the date / chevron → row expands inline, embedding the
//     full MarkdownView so users can keep reading without leaving scope.
//   • Right-side `open ↗` deep-links to `/review/day/<date>` for editing.
// Editing stays anchored in the day-scope card; this surface is
// strictly a reader.
function ReflectionLogRow({
  date,
  reflection,
}: {
  date: string;
  reflection: DailyReflection;
}) {
  const [expanded, setExpanded] = useState(false);
  const weekday = WEEKDAY_LABELS[isoWeekday(date)] ?? '';
  return (
    <li className="flex flex-col">
      <div className="flex items-baseline gap-3 rounded-sm px-2 py-2 transition hover:bg-surface-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起' : '展开'}
          className="flex items-baseline gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={clsx(
              'h-3 w-3 self-center text-ink-tertiary transition-transform',
              expanded && 'rotate-90',
            )}
            strokeWidth={1.8}
          />
          <span className="font-mono text-xs tabular-nums text-ink-secondary">
            {date} · {weekday}
          </span>
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-tertiary">
          {previewLine(reflection.content)}
        </span>
        <Link
          to={`/review/day/${date}`}
          className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:text-ink-primary"
        >
          open ↗
        </Link>
      </div>
      {expanded && (
        <div className="rounded-sm bg-surface-1/60 px-6 py-3">
          <MarkdownView source={reflection.content} />
        </div>
      )}
    </li>
  );
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getDay();
}

function previewLine(markdown: string): string {
  const firstLine = markdown.split('\n').find((l) => l.trim().length > 0) ?? '';
  // Strip leading Markdown noise (#, -, >, *) so the preview reads like
  // prose. Cap at ~80 chars; the `truncate` class handles overflow.
  const stripped = firstLine.replace(/^[#>\-*\s]+/, '').trim();
  return stripped.length > 0 ? stripped : '(no preview)';
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
