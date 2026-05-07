// ERD §6.6.2 v0.8.2 — Day-scoped AI reflection wrapper.
//
// Slices store data into a DayReviewInput, builds the prompt, and
// hands a PreparedAiCall to AiObservationCard. Renders nothing when
// the UX gate fails (aiEnabled off OR reflection empty).
//
// v0.8.2 enrichment per design discussion:
//   - Shift reason tags joined onto deferred tasks (DayRail's most
//     unique signal: WHY a task didn't happen).
//   - Habit phase context for auto-tasks (different completion
//     expectations during 备赛冲刺期 vs 基础期).
//   - 7-day baseline so single-day numbers can be read against the
//     user's typical rhythm.
//   - Day's resolved template (workday / restday) so AI can ground
//     "low completion is by design" vs "low completion is concerning".
//
// Cache target: `DailyReflection.lastAiObservation` (LWW, single field
// per ERD §6.6.2 — "retap overwrites; no history array").
// AI 输出语言: hardcoded zh-CN for v0.8.2 (Settings → 高级 → AI 输出语言
// is mocked; v0.8.3+ wires it through).

import { useCallback, useMemo } from 'react';
import {
  buildDayReviewUserMessage,
  buildMessages,
  buildSystemPrompt,
  estimateTokens,
  selectActiveTemplateKey,
  selectCurrentHabitPhase,
  selectExternalEventsOn,
  selectReflection,
  selectTodayTimeline,
  useStore,
  type AiObservation,
  type DayBaseline,
  type DayReviewInput,
  type DayRailState,
  type Line,
  type PromptTaskLine,
  type Shift,
  type Task,
} from '@dayrail/core';
import {
  AiObservationCard,
  type PreparedAiCall,
} from '@/components/AiObservationCard';

const OUTPUT_LOCALE = 'zh-CN';
const BASELINE_WINDOW_DAYS = 7;

export interface DayReflectionAiProps {
  /** ISO YYYY-MM-DD — anchored to the reflection's date. */
  date: string;
}

export function DayReflectionAi({ date }: DayReflectionAiProps) {
  const aiEnabled = useStore((s) => s.userProfile?.aiEnabled === true);
  const reflection = useStore((s) => selectReflection(s, date));
  const setDailyReflectionAiObservation = useStore(
    (s) => s.setDailyReflectionAiObservation,
  );

  const prepareCall = useCallback((): PreparedAiCall => {
    const state = useStore.getState();
    const timeline = selectTodayTimeline(state, date);
    const externalEvents = selectExternalEventsOn(date, {
      enabledHolidayRegions:
        state.userProfile?.enabledHolidayRegions ?? [],
      userDayNotes: state.userDayNotes,
    });

    // ----- Shift tag index (taskId → most-recent shift's tags) -----
    const shiftTagsByTaskId = indexShiftTagsByTask(state.shifts);

    // ----- Today's tasks, partitioned + enriched -----
    const completed: PromptTaskLine[] = [];
    const deferred: PromptTaskLine[] = [];
    const pendingLines: PromptTaskLine[] = [];

    for (const row of timeline) {
      const time = formatTimeWindow(row.plannedStart, row.plannedEnd);
      for (const task of row.tasks) {
        const line = enrichTaskLine(state, task, time, shiftTagsByTaskId, date);
        if (task.status === 'done') {
          completed.push(line);
        } else if (task.status === 'deferred') {
          deferred.push(line);
        } else if (task.status === 'pending' || task.status === 'in-progress') {
          pendingLines.push(line);
        }
      }
    }

    // ----- 7-day baseline -----
    const baseline = computeBaseline(state, date);

    // ----- Day template -----
    const templateKey = selectActiveTemplateKey(state, date) ?? undefined;

    const externalEventLabels = externalEvents.map((ev) => {
      if (ev.kind === 'user-note') return ev.label;
      const region = ev.regionCode ? ` · ${ev.regionCode}` : '';
      return `${ev.label}${region}`;
    });

    const reflectionContent = reflection?.content ?? '';
    const background = state.userProfile?.background ?? '';

    const input: DayReviewInput = {
      background,
      date,
      weekday: weekdayLabel(date),
      ...(templateKey && { templateName: templateKey }),
      externalEvents: externalEventLabels,
      completed,
      deferred,
      pending: pendingLines,
      reflectionContent,
      ...(baseline && { baseline }),
      outputLocale: OUTPUT_LOCALE,
    };

    const systemContent = buildSystemPrompt(OUTPUT_LOCALE);
    const userContent = buildDayReviewUserMessage(input);
    const messages = buildMessages(systemContent, userContent);
    const tokensEstimate =
      estimateTokens(systemContent) + estimateTokens(userContent);

    const taskCount = completed.length + deferred.length + pendingLines.length;
    const reflectionLen = reflectionContent.length;
    const bgSegment = background.trim().length > 0 ? '含背景' : '无背景';
    const baselineSegment = baseline
      ? `7 天基线 ${baseline.daysObserved} 天数据`
      : '无 7 天基线';
    const promptDescription = `${bgSegment} · 当天 ${taskCount} 个任务 · ${reflectionLen} 字 reflection · ${baselineSegment}`;

    return { messages, tokensEstimate, promptDescription };
  }, [date, reflection?.content]);

  const handleCommit = useCallback(
    (observation: AiObservation) => {
      void setDailyReflectionAiObservation(date, observation);
    },
    [date, setDailyReflectionAiObservation],
  );

  // UX gate per ERD §6.6.2: full AI surface only when aiEnabled +
  // reflection has been written. The cache field hangs off the
  // reflection entity, so writing AI output before any reflection
  // exists would no-op silently.
  //
  // v0.8.2 dogfood: an earlier version returned null when reflection
  // was empty, leaving zero discoverability for the AI feature on
  // Day scope. Now we render a small hint line so the user knows AI
  // is available once they write something.
  const reflectionWritten =
    !!reflection && reflection.content.trim().length > 0;

  const cached = reflection?.lastAiObservation;
  const cardCached = useMemo(() => cached, [cached]);

  if (!aiEnabled) return null;

  if (!reflectionWritten) {
    return (
      <p className="text-2xs italic text-ink-tertiary">
        ✨ 写完反思后，可以让 AI 帮你看看（基于你的反思和这天的数据）。
      </p>
    );
  }

  return (
    <AiObservationCard
      available
      cached={cardCached}
      prepareCall={prepareCall}
      onCommit={handleCommit}
      scopeLabel={`今日 · ${date}`}
    />
  );
}

// ============ Data-slice helpers ============

/** Build a `taskId → tags[]` index from the most recent shift per task.
 *  Older shifts on the same task get superseded — we want the latest
 *  reason chip the user attached, not their full history. */
function indexShiftTagsByTask(
  shifts: Record<string, Shift>,
): Map<string, string[]> {
  const latestByTask = new Map<string, Shift>();
  for (const shift of Object.values(shifts)) {
    const prior = latestByTask.get(shift.taskId);
    if (!prior || shift.at > prior.at) {
      latestByTask.set(shift.taskId, shift);
    }
  }
  const out = new Map<string, string[]>();
  latestByTask.forEach((shift, taskId) => {
    if (shift.tags && shift.tags.length > 0) {
      out.set(taskId, [...shift.tags]);
    }
  });
  return out;
}

function enrichTaskLine(
  state: ReturnType<typeof useStore.getState>,
  task: Task,
  time: string | undefined,
  shiftTagsByTaskId: Map<string, string[]>,
  date: string,
): PromptTaskLine {
  const out: PromptTaskLine = { title: task.title };
  const lineName = lineNameOf(state, task);
  if (lineName) out.line = lineName;
  if (time) out.time = time;
  const tags = shiftTagsByTaskId.get(task.id);
  if (tags && tags.length > 0) out.shiftTags = tags;
  const habitContext = habitContextFor(state, task, date);
  if (habitContext) out.habitContext = habitContext;
  return out;
}

function lineNameOf(
  state: ReturnType<typeof useStore.getState>,
  task: Task,
): string | undefined {
  if (!task.lineId) return undefined;
  const line: Line | undefined = state.lines[task.lineId];
  if (!line) return undefined;
  return line.name;
}

/** Habit phase context for auto-tasks. Returns "<habit name> · <phase>"
 *  or "<habit name>" if no phase tracking. Undefined for non-auto tasks
 *  or when the lineId doesn't resolve to a habit Line. */
function habitContextFor(
  state: ReturnType<typeof useStore.getState>,
  task: Task,
  date: string,
): string | undefined {
  if (task.source !== 'auto-habit') return undefined;
  if (!task.lineId) return undefined;
  const line = state.lines[task.lineId];
  if (!line || line.kind !== 'habit') return undefined;
  const phase = selectCurrentHabitPhase(state, task.lineId, date);
  if (phase) return `${line.name} · ${phase.name}`;
  return line.name;
}

function computeBaseline(
  state: ReturnType<typeof useStore.getState>,
  todayIso: string,
): DayBaseline | undefined {
  const windowDates = priorDates(todayIso, BASELINE_WINDOW_DAYS);
  const windowSet = new Set(windowDates);

  // Done count per date in the window. Walk tasks once.
  const doneByDate = new Map<string, number>();
  const deferredByDate = new Map<string, number>();
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'deleted') continue;
    if (!task.slot) continue;
    const d = task.slot.date;
    if (!windowSet.has(d)) continue;
    if (task.status === 'done') {
      doneByDate.set(d, (doneByDate.get(d) ?? 0) + 1);
    } else if (task.status === 'deferred') {
      deferredByDate.set(d, (deferredByDate.get(d) ?? 0) + 1);
    }
  }

  // Skip if literally no activity in the window — first-week users
  // shouldn't get a fake baseline.
  const totalActivity = doneByDate.size + deferredByDate.size;
  if (totalActivity === 0) return undefined;

  let totalDone = 0;
  let maxDone = 0;
  let minDone = Number.POSITIVE_INFINITY;
  let totalDeferred = 0;
  let observedDays = 0;
  for (const date of windowDates) {
    const done = doneByDate.get(date) ?? 0;
    const deferred = deferredByDate.get(date) ?? 0;
    if (done === 0 && deferred === 0) continue;
    observedDays += 1;
    totalDone += done;
    totalDeferred += deferred;
    if (done > maxDone) maxDone = done;
    if (done < minDone) minDone = done;
  }
  if (observedDays === 0) return undefined;

  // Aggregate shift tags from shifts whose `at` falls in the window.
  const tagCounts = new Map<string, number>();
  for (const shift of Object.values(state.shifts)) {
    if (!shift.tags || shift.tags.length === 0) continue;
    const day = shift.at.slice(0, 10);
    if (!windowSet.has(day)) continue;
    for (const tag of shift.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const recurringShiftTags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    daysObserved: observedDays,
    avgDone: totalDone / observedDays,
    maxDone,
    minDone: minDone === Number.POSITIVE_INFINITY ? 0 : minDone,
    avgDeferred: totalDeferred / observedDays,
    recurringShiftTags,
  };
}

/** Return the `n` ISO dates immediately preceding `todayIso`,
 *  most-recent first. e.g. priorDates('2026-05-07', 3) →
 *  ['2026-05-06', '2026-05-05', '2026-05-04']. */
function priorDates(todayIso: string, n: number): string[] {
  const out: string[] = [];
  const [y, m, d] = todayIso.split('-').map((s) => Number.parseInt(s, 10));
  if (!y || !m || !d) return out;
  const cursor = new Date(y, m - 1, d);
  for (let i = 1; i <= n; i += 1) {
    cursor.setDate(cursor.getDate() - 1);
    out.push(cursor.toISOString().slice(0, 10));
    // Counter the mutation
    cursor.setDate(cursor.getDate());
  }
  return out;
}

function formatTimeWindow(start: string, end: string): string | undefined {
  if (!start || !end) return undefined;
  return `${start}–${end}`;
}

function weekdayLabel(iso: string): string | undefined {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const zh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
    date.getDay()
  ];
  if (!en || !zh) return undefined;
  return `${en} · ${zh}`;
}
