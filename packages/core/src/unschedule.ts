// ERD §5.5.6 · decision helper for "should this unschedule mutation
// emit a `type='unschedule'` Shift?". Parallels `reschedule.ts` —
// same overdue / auto-habit gate, minus the cross-day requirement
// (there is no `nextDate` for an unschedule).

import type { AdhocEvent, Task } from './types';

export type UnscheduleDecision =
  | { shouldEmit: true; priorDate: string }
  | { shouldEmit: false };

export function detectUnschedule(input: {
  priorSlot: Task['slot'] | undefined;
  priorAdhoc: AdhocEvent | undefined;
  todayIso: string;
  isAutoHabit: boolean;
}): UnscheduleDecision {
  if (input.isAutoHabit) return { shouldEmit: false };
  const priorDate =
    input.priorSlot?.date ?? input.priorAdhoc?.date ?? null;
  if (priorDate == null) return { shouldEmit: false };
  if (priorDate >= input.todayIso) return { shouldEmit: false };
  return { shouldEmit: true, priorDate };
}
