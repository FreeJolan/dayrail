import { clsx } from 'clsx';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatDayLabel } from '@/data/sampleCycle';
import type { HeatmapRow, HeatmapState, ReviewScopeData } from '@/data/sampleReview';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
  RAIL_COLOR_STEP_7,
} from './railColors';
import { HeatmapLegend } from './HeatmapLegend';

// ERD §5.8 F2 rhythm heatmap.
// - rows = Rails sorted by frequency desc
// - cols = dates in the scope
// - cell = status (done / shifted / skipped / unmarked / empty)
// Cells are READ-ONLY. Smaller than CycleCell (the editor). Hover
// tooltip surfaces `{Rail name} · {date} · status`.

interface PhaseBand {
  phaseId: string;
  label: string;
  startCol: number;
  endCol: number;
}

interface Props {
  data: ReviewScopeData;
  /** Optional habit-phase overlay. When present, a thin band row
   *  renders above the weekday header showing which phase was
   *  active across each column. */
  phaseBands?: PhaseBand[];
  /** Previous period (prev cycle / prev month / prev day) — used for
   *  period-over-period delta on the aggregate match%. Omit when no
   *  meaningful prior exists (e.g. first-ever period). */
  prev?: ReviewScopeData;
}

export function RhythmHeatmap({ data, phaseBands = [], prev }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <Header
        label={data.label}
        match={data.rhythmMatchPct}
        done={data.totalDone}
        total={data.totalSlots}
        {...(prev && {
          prevMatch: prev.rhythmMatchPct,
          prevTotal: prev.totalSlots,
        })}
      />

      <HeatmapLegend />

      <table className="w-full table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[180px]" />
          {data.dates.map((d) => (
            <col key={d} />
          ))}
        </colgroup>

        <thead>
          {phaseBands.length > 0 && (
            <PhaseBandRow
              bands={phaseBands}
              totalCols={data.dates.length}
              dates={data.dates}
              rows={data.rows}
            />
          )}
          <tr>
            <th className="pb-2 text-left align-bottom">
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                Rail
              </span>
            </th>
            {data.dates.map((d) => {
              const { weekday, dayNum } = formatDayLabel({
                date: d,
                weekday: 0,
                templateKey: 'workday',
                overridden: false,
              });
              return (
                <th key={d} className="pb-2 text-left align-bottom">
                  <div className="flex flex-col leading-tight">
                    <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                      {weekday}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-ink-secondary">
                      {dayNum}
                    </span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td
                colSpan={1 + data.dates.length}
                className="py-8 text-center text-xs text-ink-tertiary"
              >
                这个周期内此 habit 没有对应的 Rail 实例
              </td>
            </tr>
          ) : (
            renderGroupedRows(data.rows, data.dates)
          )}
        </tbody>
      </table>
    </div>
  );
}

function renderGroupedRows(
  rows: HeatmapRow[],
  dates: string[],
): React.ReactNode {
  // Walk the (already template-sorted) rows list and emit a subheader
  // row whenever the templateKey changes. Preserves the assumption
  // reviewFromStore already sorted: same template rows are contiguous.
  const nodes: React.ReactNode[] = [];
  let seenTemplate: string | null = null;
  for (const r of rows) {
    if (r.templateKey !== seenTemplate) {
      nodes.push(
        <tr key={`header-${r.templateKey}`}>
          <th
            colSpan={1 + dates.length}
            scope="colgroup"
            className="pt-3 pb-1 text-left"
          >
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {r.templateName}
            </span>
          </th>
        </tr>,
      );
      seenTemplate = r.templateKey;
    }
    nodes.push(<HeatRow key={r.railId} row={r} dates={dates} />);
  }
  return nodes;
}

function PhaseBandRow({
  bands,
  totalCols,
  dates,
  rows,
}: {
  bands: PhaseBand[];
  totalCols: number;
  dates: string[];
  rows: HeatmapRow[];
}) {
  // Layout: one <th> spanning the row-label column (empty), then
  // colSpan-merged <th>s for each band + any uncovered columns.
  // Walk left→right, filling gaps between bands with empty cells so
  // the layout aligns with the weekday header row below. Per-band
  // match% computed across every heatmap row for the band's column
  // range.
  const sorted = [...bands].sort((a, b) => a.startCol - b.startCol);
  const cells: React.ReactNode[] = [];
  let cursor = 0;
  for (const band of sorted) {
    if (band.startCol > cursor) {
      cells.push(
        <th
          key={`gap-${cursor}`}
          colSpan={band.startCol - cursor}
          aria-hidden
        />,
      );
    }
    const span = band.endCol - band.startCol + 1;
    const stats = bandStatsAcrossRows(band, dates, rows);
    cells.push(
      <th
        key={`band-${band.phaseId}`}
        colSpan={span}
        className="pb-1 align-bottom"
      >
        <div
          title={
            stats.applied > 0
              ? `${band.label} · ${stats.done}/${stats.applied} · ${stats.matchPct}% match`
              : band.label
          }
          className="flex items-center justify-between gap-1.5 rounded-sm bg-surface-3 px-1.5 py-0.5"
        >
          <span className="min-w-0 truncate font-mono text-2xs uppercase tracking-widest text-ink-secondary">
            {band.label}
          </span>
          {stats.applied > 0 && (
            <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-tertiary">
              {stats.matchPct}%
            </span>
          )}
        </div>
      </th>,
    );
    cursor = band.endCol + 1;
  }
  if (cursor < totalCols) {
    cells.push(
      <th key={`gap-${cursor}-tail`} colSpan={totalCols - cursor} aria-hidden />,
    );
  }
  return (
    <tr>
      <th aria-hidden />
      {cells}
    </tr>
  );
}

/** done / applied across every heatmap row for a band's column range.
 *  `empty` cells (the rail didn't apply that day) are excluded from
 *  the denominator. Same rule as HeatRow's rowStats — consistent
 *  "applied" semantics everywhere. */
function bandStatsAcrossRows(
  band: PhaseBand,
  dates: string[],
  rows: HeatmapRow[],
): { done: number; applied: number; matchPct: number } {
  let done = 0;
  let applied = 0;
  for (let col = band.startCol; col <= band.endCol; col++) {
    const date = dates[col];
    if (!date) continue;
    for (const r of rows) {
      const state = r.byDate[date];
      if (!state || state === 'empty') continue;
      applied++;
      if (state === 'done') done++;
    }
  }
  return {
    done,
    applied,
    matchPct: applied === 0 ? 0 : Math.round((done / applied) * 100),
  };
}

function Header({
  label,
  match,
  done,
  total,
  prevMatch,
  prevTotal,
}: {
  label: string;
  match: number;
  done: number;
  total: number;
  prevMatch?: number;
  prevTotal?: number;
}) {
  // Delta only meaningful when BOTH periods had applied days. Prev
  // with zero slots (user hadn't started tracking) should not rend
  // as "vs 0%" — that's misleading.
  const hasDelta =
    prevMatch != null && prevTotal != null && prevTotal > 0 && total > 0;
  const delta = hasDelta ? match - prevMatch! : 0;
  return (
    <div className="flex items-baseline justify-between">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Rhythm
        </span>
        <span className="font-mono text-sm tabular-nums text-ink-primary">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-3 font-mono text-xs tabular-nums text-ink-secondary">
        <span>
          <span className="text-ink-primary">{done}</span>
          <span className="text-ink-tertiary">/{total}</span> done
        </span>
        <span className="text-ink-tertiary">·</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-ink-primary">{match}%</span>
          <span className="text-ink-tertiary">match</span>
          {hasDelta && <DeltaChip delta={delta} prevMatch={prevMatch!} />}
        </span>
      </div>
    </div>
  );
}

function DeltaChip({
  delta,
  prevMatch,
}: {
  delta: number;
  prevMatch: number;
}) {
  if (delta === 0) {
    return (
      <span
        title={`与上一周期持平 · 上周期 ${prevMatch}%`}
        className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary"
      >
        · flat
      </span>
    );
  }
  const positive = delta > 0;
  const abs = Math.abs(delta);
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title={`与上一周期相比 · 上周期 ${prevMatch}%`}
      className={clsx(
        'inline-flex items-baseline gap-0.5 font-mono text-2xs tabular-nums',
        // Stay on the design palette: `rail-grass` (step 9) is the
        // project's green token; `warn` is the amber anything-alarming
        // semantic slot — both theme-aware via token swap in dark mode.
        positive ? 'text-rail-grass' : 'text-warn',
      )}
    >
      <Icon className="h-2.5 w-2.5 translate-y-0.5" strokeWidth={2} />
      {positive ? '+' : '-'}
      {abs}pt
    </span>
  );
}

function HeatRow({ row, dates }: { row: HeatmapRow; dates: string[] }) {
  const stats = rowStats(row);
  return (
    <tr>
      <th scope="row" className="pr-3 py-0.5 text-left align-middle">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-3 w-[3px] shrink-0 rounded-sm"
            style={{ background: RAIL_COLOR_HEX[row.color] }}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-ink-secondary">
            {row.railName}
          </span>
          {stats.total > 0 && (
            <span
              title={`${stats.done}/${stats.total} · ${stats.matchPct}% match`}
              className="shrink-0 font-mono text-2xs tabular-nums text-ink-tertiary"
            >
              {stats.done}/{stats.total}
              <span className="ml-1 text-ink-tertiary/70">
                · {stats.matchPct}%
              </span>
            </span>
          )}
        </div>
      </th>
      {dates.map((d) => {
        const state = row.byDate[d] ?? 'empty';
        return (
          <td key={d} className="px-0.5 py-0.5">
            <HeatCell state={state} color={row.color} dateISO={d} railName={row.railName} />
          </td>
        );
      })}
    </tr>
  );
}

/** Done count / applied-day count for a row. `empty` cells represent
 *  days the rail didn't apply (template mismatch / binding filter), so
 *  they don't count toward the denominator. */
function rowStats(row: HeatmapRow): {
  done: number;
  total: number;
  matchPct: number;
} {
  let done = 0;
  let total = 0;
  for (const state of Object.values(row.byDate)) {
    if (state === 'empty') continue;
    total++;
    if (state === 'done') done++;
  }
  return {
    done,
    total,
    matchPct: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

function HeatCell({
  state,
  color,
  dateISO,
  railName,
}: {
  state: HeatmapState;
  color: HeatmapRow['color'];
  dateISO: string;
  railName: string;
}) {
  const tip = `${railName} · ${dateISO} · ${STATE_LABEL[state]}`;
  return (
    <div
      title={tip}
      role="gridcell"
      aria-label={tip}
      className={clsx(
        'relative h-5 w-full rounded-sm transition',
        state === 'empty' && 'bg-transparent',
      )}
      style={styleFor(state, color)}
    >
      {state === 'shifted' && (
        <ArrowUpRight
          aria-hidden
          className="h-2.5 w-2.5 text-ink-secondary"
          strokeWidth={2}
          style={{ position: 'absolute', top: 4, left: 4 }}
        />
      )}
    </div>
  );
}

const STATE_LABEL: Record<HeatmapState, string> = {
  done: '完成',
  shifted: 'Shift',
  skipped: '跳过',
  unmarked: '未标记',
  empty: '不参与',
};

function styleFor(state: HeatmapState, color: HeatmapRow['color']): React.CSSProperties | undefined {
  if (state === 'done') return { background: RAIL_COLOR_HEX[color] };
  if (state === 'shifted') return { background: RAIL_COLOR_STEP_7[color] };
  if (state === 'skipped')
    return {
      background: 'var(--surface-1, #F9F9F8)',
      backgroundImage: `repeating-linear-gradient(-45deg, ${RAIL_COLOR_STEP_6[color]} 0 1.5px, transparent 1.5px 6px)`,
    };
  if (state === 'unmarked')
    return {
      background: 'var(--surface-1, #F9F9F8)',
      backgroundImage: `repeating-linear-gradient(-45deg, ${RAIL_COLOR_STEP_4[color]} 0 1px, transparent 1px 6px)`,
    };
  return undefined;
}
