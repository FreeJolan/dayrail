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
// Idempotent id = `task-auto-{habitId}-{date}-{railId}` makes every
// trigger safe to re-run. The railId segment (added v0.13.1) is what
// lets one habit fire on TWO rails the same day: without it both
// bindings built the same id and `upsertAutoTask`'s id-idempotency
// dropped the second, so only the first rail materialized. Pre-v0.13.1
// tasks used the rail-less `task-auto-{habitId}-{date}`; the
// materializer special-cases those (see `legacyAutoTaskId`) so the
// bump doesn't duplicate already-materialized occurrences.

import { useStore, resolveTemplateForDate, type DayRailState } from './store';
import { toIsoDate, toIsoDateTime } from './today';
import {
  habitBindingsActiveOn,
  railAtDate,
  railFromRevision,
} from './revisions';
import type { Rail, Task } from './types';

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
// Materializer.
// ------------------------------------------------------------------

export interface MaterializeRange {
  /** Inclusive. */
  startDate: string;
  /** Inclusive. */
  endDate: string;
}

/** Pure materializer core. Same logic as `materializeAutoTasks` but
 *  takes the state slice + upsert dispatcher as parameters so unit
 *  tests can drive it without a real store / DB. Runtime callers go
 *  through `materializeAutoTasks` below.
 *
 *  Phase 2: walks `habitBindingsActiveOn(date)` per date and resolves
 *  each rail / template via revisions. Past dates that pre-date a
 *  config change land on the prior revision automatically — past
 *  cycles materialized later (user comes back from a long absence)
 *  see the historically correct day-shape, not whatever's in store
 *  today. */
export async function materializeAutoTasksImpl(
  state: Pick<
    DayRailState,
    | 'lines'
    | 'templates'
    | 'calendarRules'
    | 'calendarRuleRevisions'
    | 'calendarRuleTombstones'
    | 'habitBindings'
    | 'habitBindingRevisions'
    | 'habitBindingTombstones'
    | 'rails'
    | 'railRevisions'
    | 'railTombstones'
    // `tasks` is read-only here — used solely for the pre-v0.13.1
    // legacy-id back-compat guard below.
    | 'tasks'
  >,
  upsert: (task: Task) => Promise<void>,
  range: MaterializeRange,
): Promise<void> {
  for (const date of iterDates(range.startDate, range.endDate)) {
    const tplKey = resolveTemplateForDate(state, date, () => null);
    if (!tplKey) continue;
    const dow = new Date(`${date}T00:00:00`).getDay();

    for (const { bindingId, revision: bRev } of habitBindingsActiveOn(
      state,
      date,
    )) {
      const habit = state.lines[bRev.habitId];
      if (!habit || habit.status !== 'active') continue;
      if (bRev.weekdays && !bRev.weekdays.includes(dow)) continue;

      const rRev = railAtDate(state, bRev.railId, date);
      if (!rRev) continue;
      if (rRev.templateKey !== tplKey) continue;

      // ERD §10.3 "未物化的过去 cycle 不因配置变更而补": don't
      // retroactively populate dates before the binding existed.
      // Compare at DATE level, not ms — a binding created at 15:00
      // should still cover today's 09:00 rail. Use the identity-shell
      // `createdAt`, not the revision's `authoredAt`, since the latter
      // shifts every time the binding is re-revised.
      const bindingShell = state.habitBindings[bindingId];
      if (!bindingShell) continue;
      const createdDate = toIsoDate(new Date(bindingShell.createdAt));
      if (date < createdDate) continue;

      const rail = railFromRevision(rRev);

      // Back-compat (pre-v0.13.1): an already-materialized auto-task
      // used the rail-less id `task-auto-{habitId}-{date}`. If one
      // exists for THIS rail (its slot carries the same railId), it
      // already covers this occurrence — skip so the new rail-scoped id
      // doesn't create a duplicate. Other rails of the same habit/day
      // fall through and now materialize (the bug this fixes). The
      // snapshot is fine: legacy tasks predate this run.
      const legacy = state.tasks[legacyAutoTaskId(habit.id, date)];
      if (legacy?.slot?.railId === rail.id) continue;

      const task: Task = buildAutoTask(habit.id, habit.name, rail, date);
      await upsert(task);
    }
  }
}

/** Materialize habit auto-tasks for every date in [startDate, endDate].
 *
 * For each habit Line and each HabitBinding, walks the range and
 * upserts a Task when: (1) the date's resolved template matches the
 * bound rail's templateKey; (2) the binding's optional weekdays filter
 * is satisfied; (3) the date is on/after the binding's createdAt date
 * (no retroactive back-populate).
 *
 * Safe to call repeatedly: deterministic ids (`task-auto-{habitId}-
 * {date}-{railId}`) + `upsertAutoTask` idempotency make this a no-op on
 * an already-materialized range.
 */
export async function materializeAutoTasks(
  range: MaterializeRange,
): Promise<void> {
  const state = useStore.getState();
  await materializeAutoTasksImpl(state, state.upsertAutoTask, range);
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
  const id = autoTaskIdFor(habitId, date, rail.id);
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
  state: Pick<DayRailState, 'railRevisions' | 'railTombstones'>,
  task: Task,
): { plannedStart: string; plannedEnd: string } | null {
  if (!task.slot) return null;
  const rev = railAtDate(state, task.slot.railId, task.slot.date);
  if (!rev) return null;
  return {
    plannedStart: toIsoDateTime(task.slot.date, rev.startMinutes),
    plannedEnd: toIsoDateTime(
      task.slot.date,
      rev.startMinutes + rev.durationMinutes,
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

/** Deterministic id for a habit occurrence on a given rail/date. The
 *  railId segment (v0.13.1) makes the id unique per rail so one habit
 *  can fire on multiple rails the same day. */
export function autoTaskIdFor(
  habitId: string,
  dateIso: string,
  railId: string,
): string {
  return `${AUTO_TASK_ID_PREFIX}${habitId}-${dateIso}-${railId}`;
}

/** Pre-v0.13.1 rail-less id. Only the materializer's back-compat guard
 *  uses it — to recognize an already-materialized occurrence so the new
 *  rail-scoped scheme doesn't duplicate it. */
export function legacyAutoTaskId(habitId: string, dateIso: string): string {
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
// should have an auto-task — rail time / rail templateKey, or a
// HabitBinding's weekdays / presence — the set of future auto-tasks
// is stale. §10.3 prescribes: hard-delete every
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
  state: Pick<
    DayRailState,
    'tasks' | 'rails' | 'railRevisions' | 'railTombstones'
  >,
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
 *  time / templateKey is about to change — it needs a single total
 *  to show in the confirm dialog. */
export function findAffectedFutureAutoTasksForRail(
  state: Pick<
    DayRailState,
    | 'tasks'
    | 'rails'
    | 'habitBindings'
    | 'railRevisions'
    | 'railTombstones'
  >,
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

