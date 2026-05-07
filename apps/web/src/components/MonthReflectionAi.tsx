// ERD §6.6.2 v0.8.2 — Month-scoped AI reflection wrapper.
//
// Same data slicing as Cycle (per-rail aggregates / shift tag
// distribution / day-by-day match% / habit phase boundaries +
// concatenated reflections). Differences:
//   - Date range is the full calendar month (~28-31 days)
//   - Cache id uses `month-${YYYY-MM}` synthetic Cycle entity id
//     (Cycle is the ERD §10 primitive for "labeled date range";
//     `upsertCycle` accepts custom id + endDate as of v0.8.2).
//   - Token budget is larger; the >8k warning in AiObservationCard
//     fires more often and that's intentional.

import { useCallback, useMemo } from 'react';
import {
  buildCycleReviewUserMessage,
  buildMessages,
  buildSystemPrompt,
  estimateTokens,
  selectCurrentHabitPhase,
  selectExternalEventsOn,
  useStore,
  type AiObservation,
  type CycleReviewInput,
  type HabitPhase,
  type Line,
  type PromptHabitPhaseBoundary,
  type PromptRailAggregate,
} from '@dayrail/core';
import {
  AiObservationCard,
  type PreparedAiCall,
} from '@/components/AiObservationCard';
import type { HeatmapRow, HeatmapState } from '@/data/sampleReview';

const OUTPUT_LOCALE = 'zh-CN';

export interface MonthReflectionAiProps {
  /** First day of the month, ISO YYYY-MM-DD (e.g. `2026-04-01`). */
  monthStart: string;
  /** Last day of the month, inclusive ISO YYYY-MM-DD (e.g. `2026-04-30`). */
  monthEnd: string;
  /** Heatmap rows already computed by Review's deriveReviewData,
   *  reused here for per-rail aggregates so we don't recompute. */
  rows: HeatmapRow[];
  /** ISO dates spanned by this month (typically 28-31). */
  dates: string[];
}

export function MonthReflectionAi({
  monthStart,
  monthEnd,
  rows,
  dates,
}: MonthReflectionAiProps) {
  const aiEnabled = useStore((s) => s.userProfile?.aiEnabled === true);
  const cycles = useStore((s) => s.cycles);
  const upsertCycle = useStore((s) => s.upsertCycle);
  const setCycleAiObservation = useStore((s) => s.setCycleAiObservation);

  // Synthetic id keyed by year-month so the cache survives across
  // sessions and is naturally segregated from 7-day Cycle entries.
  const yearMonth = monthStart.slice(0, 7); // "YYYY-MM"
  const cycleId = `month-${yearMonth}`;
  const cycleEntity = cycles[cycleId];
  const cached = cycleEntity?.lastAiObservation;
  const cardCached = useMemo(() => cached, [cached]);

  const prepareCall = useCallback((): PreparedAiCall => {
    const state = useStore.getState();
    const dateSet = new Set(dates);

    // Per-rail aggregate (with optional habit phase) — reuses Cycle
    // shaping; the prompt builder is scope-agnostic about whether the
    // range is 7 or 30 days.
    const byRail: PromptRailAggregate[] = rows.map((row) =>
      aggregateRow(row, state, monthEnd),
    );

    // External events across all dates in the month.
    const externalEventsByDate: Array<{ date: string; labels: string[] }> = [];
    for (const date of dates) {
      const evts = selectExternalEventsOn(date, {
        enabledHolidayRegions:
          state.userProfile?.enabledHolidayRegions ?? [],
        userDayNotes: state.userDayNotes,
      });
      if (evts.length === 0) continue;
      const labels = evts.map((ev) =>
        ev.kind === 'user-note'
          ? ev.label
          : `${ev.label}${ev.regionCode ? ` · ${ev.regionCode}` : ''}`,
      );
      externalEventsByDate.push({ date, labels });
    }
    const externalEventSummary = externalEventsByDate
      .map((e) => `${e.date}: ${e.labels.join(', ')}`)
      .join(' · ');

    // Reflections in chronological order, only the days the user
    // actually wrote on.
    const reflections: Array<{ date: string; content: string }> = [];
    for (const date of dates) {
      const r = state.reflections[date];
      if (r && r.content.trim().length > 0) {
        reflections.push({ date, content: r.content });
      }
    }

    // Shift tag distribution within month window.
    const tagCounts = new Map<string, number>();
    for (const shift of Object.values(state.shifts)) {
      if (!shift.tags || shift.tags.length === 0) continue;
      const day = shift.at.slice(0, 10);
      if (!dateSet.has(day)) continue;
      for (const tag of shift.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const shiftTagDistribution = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    // Day-by-day match% trajectory across the month.
    const dailyMatchTrajectory = dates.map((date) => ({
      date,
      ...(computeDailyMatchPct(rows, date) !== undefined && {
        matchPct: computeDailyMatchPct(rows, date),
      }),
    }));

    // Habit phase boundaries within month window.
    const habitPhaseBoundaries = collectPhaseBoundaries(state, dates);

    const background = state.userProfile?.background ?? '';

    const input: CycleReviewInput = {
      background,
      startDate: monthStart,
      endDate: monthEnd,
      byRail,
      externalEventSummary,
      reflections,
      shiftTagDistribution,
      dailyMatchTrajectory,
      habitPhaseBoundaries,
      outputLocale: OUTPUT_LOCALE,
    };

    const systemContent = buildSystemPrompt(OUTPUT_LOCALE);
    const userContent = buildCycleReviewUserMessage(input);
    const messages = buildMessages(systemContent, userContent);
    const tokensEstimate =
      estimateTokens(systemContent) + estimateTokens(userContent);

    const bgSegment = background.trim().length > 0 ? '含背景' : '无背景';
    const reflectionLen = reflections.reduce(
      (sum, r) => sum + r.content.length,
      0,
    );
    const promptDescription = `${bgSegment} · ${rows.length} 条 rail · ${reflections.length} 天 reflection (${reflectionLen} 字) · shift tags ${shiftTagDistribution.length} 类 · phase 切换 ${habitPhaseBoundaries.length} 次 · ${dates.length} 天跨度`;

    return { messages, tokensEstimate, promptDescription };
  }, [monthStart, monthEnd, rows, dates]);

  const handleCommit = useCallback(
    (observation: AiObservation) => {
      // Synthetic Month-scope Cycle entity. v0.8.2 upsertCycle
      // accepts custom id + endDate so the entity gets stored as
      // `{ id: 'month-2026-04', startDate: '2026-04-01', endDate:
      // '2026-04-30' }` — segregated from 7-day cycles by id prefix.
      void (async () => {
        await upsertCycle({
          id: cycleId,
          startDate: monthStart,
          endDate: monthEnd,
        });
        await setCycleAiObservation(cycleId, observation);
      })();
    },
    [cycleId, monthStart, monthEnd, setCycleAiObservation, upsertCycle],
  );

  if (!aiEnabled) return null;

  return (
    <AiObservationCard
      available={aiEnabled}
      cached={cardCached}
      prepareCall={prepareCall}
      onCommit={handleCommit}
      scopeLabel={`Month · ${yearMonth}`}
    />
  );
}

// ============ Helpers (mirror CycleReflectionAi) ============

function aggregateRow(
  row: HeatmapRow,
  state: ReturnType<typeof useStore.getState>,
  asOfDate: string,
): PromptRailAggregate {
  let done = 0;
  let deferred = 0;
  let pending = 0;
  let total = 0;
  for (const status of Object.values(row.byDate)) {
    if (status === 'empty') continue;
    total += 1;
    if (status === 'done') done += 1;
    else if (status === 'shifted' || status === 'skipped') deferred += 1;
    else if (status === 'unmarked') pending += 1;
  }
  const matchPct = total > 0 ? (done / total) * 100 : undefined;
  const phase = habitPhaseForRailName(state, row.railName, asOfDate);
  return {
    railName: row.railName,
    completed: done,
    deferred,
    pending,
    ...(matchPct !== undefined && { matchPct }),
    ...(phase && { habitPhase: phase }),
  };
}

function habitPhaseForRailName(
  state: ReturnType<typeof useStore.getState>,
  railName: string,
  asOfDate: string,
): string | undefined {
  const habitLine = Object.values(state.lines as Record<string, Line>).find(
    (l) => l.kind === 'habit' && l.name === railName,
  );
  if (!habitLine) return undefined;
  const phase = selectCurrentHabitPhase(state, habitLine.id, asOfDate);
  return phase?.name;
}

function computeDailyMatchPct(
  rows: HeatmapRow[],
  date: string,
): number | undefined {
  let done = 0;
  let total = 0;
  for (const row of rows) {
    const status: HeatmapState | undefined = row.byDate[date];
    if (!status || status === 'empty') continue;
    total += 1;
    if (status === 'done') done += 1;
  }
  if (total === 0) return undefined;
  return (done / total) * 100;
}

function collectPhaseBoundaries(
  state: ReturnType<typeof useStore.getState>,
  dates: string[],
): PromptHabitPhaseBoundary[] {
  if (dates.length === 0) return [];
  const dateSet = new Set(dates);
  const out: PromptHabitPhaseBoundary[] = [];
  for (const phase of Object.values(state.habitPhases) as HabitPhase[]) {
    if (!dateSet.has(phase.startDate)) continue;
    const habitLine = state.lines[phase.lineId];
    if (!habitLine) continue;
    out.push({
      habitName: habitLine.name,
      date: phase.startDate,
      newPhase: phase.name,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
