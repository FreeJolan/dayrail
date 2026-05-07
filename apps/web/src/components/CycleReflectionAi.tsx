// ERD §6.6.2 v0.8.2 — Cycle-scoped AI reflection wrapper.
//
// Aggregates per-rail stats + concatenated multi-day reflections +
// cycle-wide ExternalEvent summary into a CycleReviewInput, then hands
// the prepared call to AiObservationCard.
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
  selectExternalEventsOn,
  useStore,
  type AiObservation,
  type CycleReviewInput,
  type PromptRailAggregate,
} from '@dayrail/core';
import {
  AiObservationCard,
  type PreparedAiCall,
} from '@/components/AiObservationCard';
import type { HeatmapRow } from '@/data/sampleReview';

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

    // Per-rail aggregates: count statuses across the cycle's dates.
    const byRail: PromptRailAggregate[] = rows.map((row) =>
      aggregateRow(row),
    );

    // External events across all dates in the cycle.
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

    // Reflections in chronological order, only the ones the user
    // actually wrote (empty-content reflections don't materialize).
    const reflections: Array<{ date: string; content: string }> = [];
    for (const date of dates) {
      const r = state.reflections[date];
      if (r && r.content.trim().length > 0) {
        reflections.push({ date, content: r.content });
      }
    }

    const background = state.userProfile?.background ?? '';

    const input: CycleReviewInput = {
      background,
      startDate: cycleStartDate,
      endDate: cycleEndDate,
      byRail,
      externalEventSummary,
      reflections,
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
    const promptDescription = `${bgSegment} · ${rows.length} 条 rail · ${reflections.length} 天 reflection · ${reflectionLen} 字`;

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

function aggregateRow(row: HeatmapRow): PromptRailAggregate {
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
  return {
    railName: row.railName,
    completed: done,
    deferred,
    pending,
    ...(matchPct !== undefined && { matchPct }),
  };
}
