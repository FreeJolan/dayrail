// ERD §5.5.6 · decision helper for "should this schedule mutation emit
// a `type='reschedule'` Shift?". Extracted as a pure function so the
// trigger-rule table (today-or-overdue cross-day yes; first schedule
// / same-day rail swap / strictly-future task / auto-habit no) is
// directly unit-testable without spinning up the whole store.
//
// v0.4.1: gate was `priorDate < todayIso` — i.e. only strictly-past
// reschedules fired the prompt.
// v0.10.x (2026-05-14): gate relaxed to `priorDate <= todayIso`.
// Reason: rescheduling today's task is just as likely to be a defer
// as it is a calendar adjustment ("I'm not getting to this today" vs
// "this needs to go to Tuesday instead"); silently treating today
// as "planning, not slippage" missed half the real defer cases. The
// strictly-future case (`priorDate > todayIso`) stays silent — by
// definition no slippage has occurred yet.

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
  if (priorDate > input.todayIso) return { shouldEmit: false };
  if (input.nextDate === priorDate) return { shouldEmit: false };
  return { shouldEmit: true, priorDate };
}
