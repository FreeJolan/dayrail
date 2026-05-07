// ERD §6.6.2 v0.8.2 — Day-scoped AI reflection wrapper.
//
// Slices store data into a DayReviewInput, builds the prompt, and
// hands a PreparedAiCall to AiObservationCard. Renders nothing when
// the UX gate fails (aiEnabled off OR reflection empty).
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
  selectExternalEventsOn,
  selectReflection,
  selectTodayTimeline,
  useStore,
  type AiObservation,
  type DayReviewInput,
  type PromptTaskLine,
  type Task,
} from '@dayrail/core';
import {
  AiObservationCard,
  type PreparedAiCall,
} from '@/components/AiObservationCard';

const OUTPUT_LOCALE = 'zh-CN';

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

  // The wrapper subscribes to the raw store maps for the prepareCall
  // closure; selectors are derived lazily inside `prepareCall` using
  // `useStore.getState()` so the prompt always reflects the latest
  // data at click time, not stale closure data.

  const prepareCall = useCallback((): PreparedAiCall => {
    const state = useStore.getState();
    const timeline = selectTodayTimeline(state, date);
    const externalEvents = selectExternalEventsOn(date, {
      enabledHolidayRegions:
        state.userProfile?.enabledHolidayRegions ?? [],
      userDayNotes: state.userDayNotes,
    });

    const completed: PromptTaskLine[] = [];
    const deferred: PromptTaskLine[] = [];
    const pendingLines: PromptTaskLine[] = [];

    for (const row of timeline) {
      const time = formatTimeWindow(row.plannedStart, row.plannedEnd);
      for (const task of row.tasks) {
        const line: PromptTaskLine = {
          title: task.title,
          line: lineNameOf(state, task),
          ...(time && { time }),
        };
        if (task.status === 'done') {
          completed.push(line);
        } else if (task.status === 'deferred') {
          deferred.push(line);
        } else if (task.status === 'pending' || task.status === 'in-progress') {
          pendingLines.push(line);
        }
      }
    }

    // Pending queue picks up `deferred` tasks scheduled for past dates
    // (see §5.7); for Day-anchored review we only care about tasks
    // sitting on this exact day, so we skip the wider queue and use
    // the timeline rows above.

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
      externalEvents: externalEventLabels,
      completed,
      deferred,
      pending: pendingLines,
      reflectionContent,
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
    const promptDescription = `${bgSegment} · 当天 ${taskCount} 个任务 · ${reflectionLen} 字 reflection`;

    return { messages, tokensEstimate, promptDescription };
  }, [date, reflection?.content]);

  const handleCommit = useCallback(
    (observation: AiObservation) => {
      void setDailyReflectionAiObservation(date, observation);
    },
    [date, setDailyReflectionAiObservation],
  );

  // UX gate per ERD §6.6.2: button only available when aiEnabled +
  // reflection has been written. The cache field hangs off the
  // reflection entity, so writing AI output before any reflection
  // exists would no-op silently.
  const reflectionWritten =
    !!reflection && reflection.content.trim().length > 0;
  const available = aiEnabled && reflectionWritten;

  const cached = reflection?.lastAiObservation;
  const cardCached = useMemo(() => cached, [cached]);

  if (!available) return null;

  return (
    <AiObservationCard
      available={available}
      cached={cardCached}
      prepareCall={prepareCall}
      onCommit={handleCommit}
      scopeLabel={`今日 · ${date}`}
    />
  );
}

// ============ Helpers ============

function lineNameOf(
  state: ReturnType<typeof useStore.getState>,
  task: Task,
): string | undefined {
  if (!task.lineId) return undefined;
  const line = state.lines[task.lineId];
  if (!line) return undefined;
  return line.name;
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
