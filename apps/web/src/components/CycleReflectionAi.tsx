// ERD §6.6.2 v0.8.2 — Cycle-scoped AI reflection wrapper.
//
// Aggregates per-rail stats + concatenated multi-day reflections +
// cycle-wide ExternalEvent summary into a CycleReviewInput, then hands
// the prepared call to AiObservationCard.
//
// v0.8.2 enrichment per design discussion:
//   - Shift reason tag distribution across the cycle (DayRail's
//     "why didn't it happen" signal at cycle scale).
//   - Day-by-day match% trajectory (peaks, valleys, trend).
//   - Habit phase boundaries within the cycle window (so the AI
//     doesn't read a mid-cycle phase change as a continuous series).
//   - Habit phase tag on per-rail aggregates (interpretation differs
//     by phase).
//
// Cache target: `Cycle.lastAiObservation` (LWW). Cycle entities are
// upserted on demand — most calendar weeks don't have an entity until
// the user labels them or runs AI; the wrapper auto-upserts the
// entity before writing the observation so the cache write doesn't
// no-op.

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

export interface CycleReflectionAiProps {
  /** Monday-anchored ISO YYYY-MM-DD. Identifies the cycle entity
   *  (id = `cycle-${cycleStartDate}`). */
  cycleStartDate: string;
  /** Inclusive end date (Sunday for v0.3.2). */
  cycleEndDate: string;
  /** Heatmap rows already computed by Review's deriveReviewData,
   *  reused here for per-rail aggregates so we don't recompute. */
  rows: HeatmapRow[];
  /** ISO dates spanned by this cycle (typically 7). */
  dates: string[];
}

export function CycleReflectionAi({
  cycleStartDate,
  cycleEndDate,
  rows,
  dates,
}: CycleReflectionAiProps) {
  const aiEnabled = useStore((s) => s.userProfile?.aiEnabled === true);
  const cycles = useStore((s) => s.cycles);
  const upsertCycle = useStore((s) => s.upsertCycle);
  const setCycleAiObservation = useStore((s) => s.setCycleAiObservation);

  const cycleId = `cycle-${cycleStartDate}`;
  const cycleEntity = cycles[cycleId];
  const cached = cycleEntity?.lastAiObservation;
  const cardCached = useMemo(() => cached, [cached]);

  const prepareCall = useCallback((): PreparedAiCall => {
    const state = useStore.getState();
    const dateSet = new Set(dates);

    // ----- Per-rail aggregate (with optional habit phase) -----
    const byRail: PromptRailAggregate[] = rows.map((row) =>
      aggregateRow(row, state, cycleEndDate),
    );

    // ----- External events across cycle dates -----
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

    // ----- Reflections in chronological order -----
    const reflections: Array<{ date: string; content: string }> = [];
    for (const date of dates) {
      const r = state.reflections[date];
      if (r && r.content.trim().length > 0) {
        reflections.push({ date, content: r.content });
      }
    }

    // ----- Shift tag distribution within cycle window -----
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

    // ----- Day-by-day match% trajectory -----
    const dailyMatchTrajectory = dates.map((date) => ({
      date,
      ...(computeDailyMatchPct(rows, date) !== undefined && {
        matchPct: computeDailyMatchPct(rows, date),
      }),
    }));

    // ----- Habit phase boundaries within cycle window -----
    const habitPhaseBoundaries = collectPhaseBoundaries(state, dates);

    const background = state.userProfile?.background ?? '';

    const input: CycleReviewInput = {
      background,
      startDate: cycleStartDate,
      endDate: cycleEndDate,
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
    const promptDescription = `${bgSegment} · ${rows.length} 条 rail · ${reflections.length} 天 reflection (${reflectionLen} 字) · shift tags ${shiftTagDistribution.length} 类 · phase 切换 ${habitPhaseBoundaries.length} 次`;

    return { messages, tokensEstimate, promptDescription };
  }, [cycleStartDate, cycleEndDate, rows, dates]);

  const handleCommit = useCallback(
    (observation: AiObservation) => {
      // Auto-upsert the cycle entity before writing the cache. Most
      // visible cycles don't have an entity until the user labels
      // them or runs AI — without the upsert, setCycleAiObservation
      // would no-op silently.
      void (async () => {
        await upsertCycle({ startDate: cycleStartDate });
        await setCycleAiObservation(cycleId, observation);
      })();
    },
    [cycleStartDate, cycleId, setCycleAiObservation, upsertCycle],
  );

  if (!aiEnabled) return null;

  return (
    <AiObservationCard
      available={aiEnabled}
      cached={cardCached}
      prepareCall={prepareCall}
      onCommit={handleCommit}
      scopeLabel={`Cycle · ${cycleStartDate} → ${cycleEndDate}`}
    />
  );
}

// ============ Helpers ============

function aggregateRow(
  row: HeatmapRow,
  state: ReturnType<typeof useStore.getState>,
  cycleEndDate: string,
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

  // Habit phase, if this rail is bound to a habit Line via name match.
  // Heuristic — HeatmapRow doesn't carry lineId today; we look up by
  // name in the habit Lines. Acceptable for the prompt (false negatives
  // just omit the phase tag, which is what we want).
  const phase = habitPhaseForRailName(state, row.railName, cycleEndDate);

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
  // Find a habit Line whose name matches the rail name.
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
