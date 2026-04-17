import { useState } from 'react';
import { clsx } from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  MessageSquareQuote,
  Sparkles,
} from 'lucide-react';
import {
  SAMPLE_CYCLE_REVIEW,
  SAMPLE_DAY_REVIEW,
  SAMPLE_MONTH_REVIEW,
  type ReviewScopeData,
} from '@/data/sampleReview';
import { RhythmHeatmap } from '@/components/RhythmHeatmap';
import { ShiftTagBars } from '@/components/ShiftTagBars';

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

export function Review() {
  const [scope, setScope] = useState<Scope>('cycle');
  const data = pickData(scope);
  const [aiEnabled, setAiEnabled] = useState(false);

  return (
    <div className="flex w-full flex-col pl-10 pr-8 xl:pl-14">
      <TopBar scope={scope} onScopeChange={setScope} />

      <PeriodPager data={data} />

      <div className="flex flex-col gap-10 pb-16 pt-8">
        {/* Per-scope waterfall */}
        <RhythmHeatmap data={data} />
        <ShiftTagBars tags={data.shiftTags} />
        {data.adhocHint && <AdhocHintCard hint={data.adhocHint} />}
        <AISection enabled={aiEnabled} onToggle={() => setAiEnabled((v) => !v)} />

        <Footer scope={scope} data={data} />
      </div>
    </div>
  );
}

function pickData(scope: Scope): ReviewScopeData {
  if (scope === 'day') return SAMPLE_DAY_REVIEW;
  if (scope === 'month') return SAMPLE_MONTH_REVIEW;
  return SAMPLE_CYCLE_REVIEW;
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
    <header className="sticky top-0 z-40 -mx-10 flex h-[52px] items-center justify-between gap-4 bg-surface-0 px-10">
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

function PeriodPager({ data }: { data: ReviewScopeData }) {
  return (
    <div className="hairline-b sticky top-[52px] z-20 -mx-10 flex h-9 items-center gap-3 bg-surface-0 px-10">
      <button
        type="button"
        aria-label="Previous period"
        title="上一周期（v0.2 启用）"
        disabled
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-tertiary/50 transition hover:bg-surface-2 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <span className="font-mono text-sm tabular-nums text-ink-primary">
        {data.label}
      </span>
      <button
        type="button"
        aria-label="Next period"
        title="下一周期（v0.2 启用）"
        disabled
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-tertiary/50 transition hover:bg-surface-2 disabled:cursor-not-allowed"
      >
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
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
          Line 进度方面：DayRail 开发本周期推进 2 条 Chunk（Template Editor 静态页 + Cycle View 静态页），
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
