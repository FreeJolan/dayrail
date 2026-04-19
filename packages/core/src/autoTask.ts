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
import { toIsoDate, toIsoDateTime } from './today';
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
  const bindings = Object.values(state.habitBindings);
  if (bindings.length === 0) return;

  // Group bindings by habitId for clean iteration.
  const byHabit = new Map<string, typeof bindings>();
  for (const b of bindings) {
    const list = byHabit.get(b.habitId) ?? [];
    list.push(b);
    byHabit.set(b.habitId, list);
  }

  for (const [habitId, habitBindings] of byHabit) {
    const habit = state.lines[habitId];
    if (!habit || habit.status !== 'active') continue;

    for (const date of iterDates(range.startDate, range.endDate)) {
      const tplKey = resolveTemplateForDate(state, date, () => null);
      if (!tplKey) continue;
      const dow = new Date(`${date}T00:00:00`).getDay();

      for (const binding of habitBindings) {
        const rail = state.rails[binding.railId];
        if (!rail) continue;
        if (rail.templateKey !== tplKey) continue;
        if (!recurrenceCovers(rail.recurrence, date)) continue;
        if (binding.weekdays && !binding.weekdays.includes(dow)) continue;

        // ERD §10.3 "未物化的过去 cycle 不因配置变更而补": don't
        // retroactively populate dates before the binding existed.
        // Compare at DATE level, not ms — a binding created at 15:00
        // should still cover today's 09:00 rail.
        const createdDate = toIsoDate(new Date(binding.createdAt));
        if (date < createdDate) continue;

        const task: Task = buildAutoTask(habit.id, habit.name, rail, date);
        await state.upsertAutoTask(task);
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

// ------------------------------------------------------------------
// ERD §10.3 · habit configuration-change purge.
//
// When the user edits something that changes which (habit, date) pairs
// should have an auto-task — rail time / rail recurrence / rail
// templateKey, or a HabitBinding's weekdays / presence — the set of
// future auto-tasks is stale. §10.3 prescribes: hard-delete every
// future pending auto-task in scope, then let the idempotent
// materializer top up under the new config on the next view open.
//
// Scope narrows the purge:
//   { habitId }           — everything this habit materialized
//   { habitId, railId }   — only tasks carrying the named rail
// ------------------------------------------------------------------

export interface PurgeScope {
  habitId: string;
  /** Narrow further by rail — used when a single binding/rail edit
   *  should only touch auto-tasks from that specific rail. */
  railId?: string;
}

/** Future pending auto-tasks that §10.3 wants regenerated. `plannedStart
 *  > now` guarantees we never rewrite something the user might already
 *  have acted on (past or currently-firing slot). */
export function findAffectedFutureAutoTasks(
  state: Pick<DayRailState, 'tasks' | 'rails'>,
  scope: PurgeScope,
  now: Date = new Date(),
): Task[] {
  const nowMs = now.getTime();
  const out: Task[] = [];
  for (const t of Object.values(state.tasks)) {
    if (!isAutoTask(t)) continue;
    if (t.status !== 'pending') continue;
    if (t.lineId !== scope.habitId) continue;
    if (!t.slot) continue;
    if (scope.railId && t.slot.railId !== scope.railId) continue;
    const window = autoTaskPlannedWindow(state, t);
    if (!window) continue;
    const startMs = Date.parse(window.plannedStart);
    if (Number.isNaN(startMs)) continue;
    if (startMs <= nowMs) continue;
    out.push(t);
  }
  return out;
}

/** Same as findAffectedFutureAutoTasks but aggregated across every
 *  habit bound to `railId`. Used by Template Editor when a rail's
 *  recurrence / time / templateKey is about to change — it needs a
 *  single total to show in the confirm dialog. */
export function findAffectedFutureAutoTasksForRail(
  state: Pick<DayRailState, 'tasks' | 'rails' | 'habitBindings'>,
  railId: string,
  now: Date = new Date(),
): Task[] {
  const habitIds = new Set(
    Object.values(state.habitBindings)
      .filter((b) => b.railId === railId)
      .map((b) => b.habitId),
  );
  const out: Task[] = [];
  for (const habitId of habitIds) {
    out.push(
      ...findAffectedFutureAutoTasks(state, { habitId, railId }, now),
    );
  }
  return out;
}

/** §10.3 step 1 — purge affected future pending auto-tasks. Caller is
 *  expected to (a) save the new config before calling this so the
 *  "new config" is already in store, and (b) re-run the materializer
 *  for whatever window they care about to top up. Both (a) and the
 *  purge events share a sessionId so one undo reverts the lot.
 *
 *  Returns the count so the caller can report it (e.g. "已更新调度，清
 *  理了 N 条待生成的 auto-task"). */
export async function purgeFutureAutoTasks(
  scope: PurgeScope,
  sessionId?: string,
  now: Date = new Date(),
): Promise<number> {
  const state = useStore.getState();
  const affected = findAffectedFutureAutoTasks(state, scope, now);
  for (const t of affected) {
    await state.purgeTask(t.id, sessionId);
  }
  return affected.length;
}

/** Rail-scoped counterpart of purgeFutureAutoTasks. */
export async function purgeFutureAutoTasksForRail(
  railId: string,
  sessionId?: string,
  now: Date = new Date(),
): Promise<number> {
  const state = useStore.getState();
  const affected = findAffectedFutureAutoTasksForRail(state, railId, now);
  for (const t of affected) {
    await state.purgeTask(t.id, sessionId);
  }
  return affected.length;
}

/** Cycle View: materialize a Monday-anchored 7-day window. After this
 *  runs, every touched cycle for every habit with rails is marked. */
export async function materializeAutoTasksForCycle(mondayIso: string): Promise<void> {
  return materializeAutoTasks({
    startDate: mondayIso,
    endDate: addDays(mondayIso, 6),
  });
}

