// ERD §5.5.6 · decision helper for "should this schedule mutation emit
// a `type='reschedule'` Shift?". Extracted as a pure function so the
// trigger-rule table (overdue cross-day yes; first schedule / same-day
// / future task / auto-habit no) is directly unit-testable without
// spinning up the whole store.

import type { AdhocEvent, Task } from './types';

export type RescheduleDecision =
  | { shouldEmit: true; priorDate: string }
  | { shouldEmit: false };

export function detectReschedule(input: {
  priorSlot: Task['slot'] | undefined;
  priorAdhoc: AdhocEvent | undefined;
  nextDate: string;
  todayIso: string;
  isAutoHabit: boolean;
}): RescheduleDecision {
  if (input.isAutoHabit) return { shouldEmit: false };
  const priorDate =
    input.priorSlot?.date ?? input.priorAdhoc?.date ?? null;
  if (priorDate == null) return { shouldEmit: false };
  if (priorDate >= input.todayIso) return { shouldEmit: false };
  if (input.nextDate === priorDate) return { shouldEmit: false };
  return { shouldEmit: true, priorDate };
}
