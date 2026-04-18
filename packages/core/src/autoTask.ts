// ERD §10.2: auto-task materialization for habit occurrences.
//
// A habit's "each occurrence" is represented as a Task with a
// deterministic id. Materialization is on-demand (strategy Ⅱ) —
// triggered by views that need to render habit activity in a time
// window (Today Track boot, Cycle View switch, rhythm strip, Calendar
// month, Review scope). Each (habitId, cycleId) pair is materialized
// once and then marked; subsequent calls skip it.
//
// We do NOT event-log a dense "occurrence" entity — we reuse Task.
// Idempotent id = `task-auto-{habitId}-{date}` makes every trigger
// safe to re-run. The (habitId, cycleId) marker stops the materializer
// from re-visiting a cycle after the user has edited / deleted
// auto-tasks in it (preventing undo-like side effects).

import { useStore, resolveTemplateForDate, type DayRailState } from './store';
import { toIsoDateTime } from './today';
import type { Rail, Recurrence, Task } from './types';

// ------------------------------------------------------------------
// Date helpers. Monday-anchored cycle id matches the §9.7 Cycle C1
// convention already in use by the rest of the codebase.
// ------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIso(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00`);
}

function fmtIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday of the ISO-week containing `dateIso`, as an ISO date string. */
export function mondayOf(dateIso: string): string {
  const d = parseIso(dateIso);
  const dow = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return fmtIso(d);
}

/** Cycle id for any date — matches `cycle-{mondayIso}` convention. */
export function cycleIdOf(dateIso: string): string {
  return `cycle-${mondayOf(dateIso)}`;
}

/** Iterate ISO date strings from `start` (inclusive) to `end` (inclusive). */
function* iterDates(startIso: string, endIso: string): Generator<string> {
  const startMs = parseIso(startIso).getTime();
  const endMs = parseIso(endIso).getTime();
  for (let t = startMs; t <= endMs; t += DAY_MS) {
    yield fmtIso(new Date(t));
  }
}

// ------------------------------------------------------------------
// Recurrence check — does `rail.recurrence` fire on `dateIso`?
// ------------------------------------------------------------------

export function recurrenceCovers(recurrence: Recurrence, dateIso: string): boolean {
  const dow = parseIso(dateIso).getDay(); // 0 = Sun, 6 = Sat
  switch (recurrence.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'custom':
      return recurrence.weekdays.includes(dow);
  }
}

// ------------------------------------------------------------------
// Materializer.
// ------------------------------------------------------------------

export interface MaterializeRange {
  /** Inclusive. */
  startDate: string;
  /** Inclusive. */
  endDate: string;
}

/** Materialize habit auto-tasks for every date in [startDate, endDate].
 *
 * For each habit Line and each Rail it's bound to, walks the range
 * and upserts a Task when: (1) the (habit, cycle) pair isn't yet
 * marked; (2) the date's resolved template matches the Rail's
 * templateKey; (3) the Rail's recurrence covers the date.
 *
 * Once every day in a given cycle has been visited, that cycle gets
 * marked so future materialize calls skip it (ERD §10.2 — prevents
 * config changes from back-populating historical cycles).
 *
 * Safe to call repeatedly: deterministic ids + markers make this a
 * no-op when called on an already-materialized range.
 */
export async function materializeAutoTasks(
  range: MaterializeRange,
): Promise<void> {
  const state = useStore.getState();
  const habits = Object.values(state.lines).filter(
    (l) => l.kind === 'habit' && l.status === 'active',
  );
  if (habits.length === 0) return;

  for (const habit of habits) {
    const railsForHabit = Object.values(state.rails).filter(
      (r) => r.defaultLineId === habit.id,
    );
    if (railsForHabit.length === 0) continue;

    // Collect (cycleId → first date, last date) the range touches.
    // We only mark a cycle complete when the range fully covers it —
    // partial coverage (e.g. "just today") doesn't close the cycle
    // so a later Cycle-View-wide pass will finish it off.
    const cyclesTouched = new Map<string, { start: string; end: string }>();

    for (const date of iterDates(range.startDate, range.endDate)) {
      const cid = cycleIdOf(date);
      if (state.autoTaskMarkers[`${habit.id}|${cid}`]) continue;

      const tracked = cyclesTouched.get(cid);
      if (tracked) tracked.end = date;
      else cyclesTouched.set(cid, { start: date, end: date });

      const tplKey = resolveTemplateForDate(state, date, () => null);
      if (!tplKey) continue;

      for (const rail of railsForHabit) {
        if (rail.templateKey !== tplKey) continue;
        if (!recurrenceCovers(rail.recurrence, date)) continue;

        const task: Task = buildAutoTask(habit.id, habit.name, rail, date);
        await state.upsertAutoTask(task);
      }
    }

    // Mark cycles that the range fully covered (Mon–Sun).
    for (const [cid, span] of cyclesTouched) {
      const mondayIso = cid.replace('cycle-', '');
      const endOfCycle = addDays(mondayIso, 6);
      if (span.start <= mondayIso && span.end >= endOfCycle) {
        await state.upsertAutoTaskMarker(habit.id, cid);
      }
    }
  }
}

function addDays(dateIso: string, n: number): string {
  const d = parseIso(dateIso);
  d.setDate(d.getDate() + n);
  return fmtIso(d);
}

function buildAutoTask(
  habitId: string,
  habitName: string,
  rail: Rail,
  date: string,
): Task {
  const id = `task-auto-${habitId}-${date}`;
  const plannedStart = toIsoDateTime(date, rail.startMinutes);
  const plannedEnd = toIsoDateTime(
    date,
    rail.startMinutes + rail.durationMinutes,
  );
  void plannedStart; // reserved for §10.3 purge logic (plannedStart > now?)
  void plannedEnd;
  return {
    id,
    lineId: habitId,
    title: habitName,
    order: 0,
    status: 'pending',
    slot: {
      cycleId: cycleIdOf(date),
      date,
      railId: rail.id,
    },
    source: 'auto-habit',
  };
}

// ------------------------------------------------------------------
// Selector helper — derives plannedStart / plannedEnd for an auto-task
// by looking up its Rail and combining with the slot date. Kept out of
// the Task shape so schedule edits on the Rail propagate cleanly
// without rewriting every historical Task.
// ------------------------------------------------------------------

export function autoTaskPlannedWindow(
  state: Pick<DayRailState, 'rails'>,
  task: Task,
): { plannedStart: string; plannedEnd: string } | null {
  if (!task.slot) return null;
  const rail = state.rails[task.slot.railId];
  if (!rail) return null;
  return {
    plannedStart: toIsoDateTime(task.slot.date, rail.startMinutes),
    plannedEnd: toIsoDateTime(
      task.slot.date,
      rail.startMinutes + rail.durationMinutes,
    ),
  };
}

/** Does this Task look like an auto-task generated by the materializer?
 *  Used where event-payload's `source` field isn't available (read-path
 *  selectors that only see the reducer-derived Task). Falls back to the
 *  id shape since `source` isn't part of the reducer-kept Task. */
export function isAutoTask(task: Task): boolean {
  return task.source === 'auto-habit' || task.id.startsWith('task-auto-');
}

export const AUTO_TASK_ID_PREFIX = 'task-auto-';

export function autoTaskIdFor(habitId: string, dateIso: string): string {
  return `${AUTO_TASK_ID_PREFIX}${habitId}-${dateIso}`;
}

// ------------------------------------------------------------------
// Convenience wrappers for the common triggers.
// ------------------------------------------------------------------

/** Today Track boot: materialize just today. Cycle-complete marker
 *  won't land here (range covers one day, not a full week), so
 *  Cycle-View / Calendar passes will eventually finish the week. */
export async function materializeAutoTasksForToday(todayIso: string): Promise<void> {
  return materializeAutoTasks({ startDate: todayIso, endDate: todayIso });
}

/** Cycle View: materialize a Monday-anchored 7-day window. After this
 *  runs, every touched cycle for every habit with rails is marked. */
export async function materializeAutoTasksForCycle(mondayIso: string): Promise<void> {
  return materializeAutoTasks({
    startDate: mondayIso,
    endDate: addDays(mondayIso, 6),
  });
}

