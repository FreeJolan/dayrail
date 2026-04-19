// Today Track helpers — date formatting + check-in / pending /
// timeline selectors.
//
// Conventions:
//   - Date strings are local wall-clock "YYYY-MM-DD" (no timezone).
//   - Datetime strings are local "YYYY-MM-DDTHH:MM" (no seconds, no Z).
//     `Date.parse` on these yields local time on modern engines, which
//     is what we want for "ended before now?" comparisons.
//
// v0.4: `RailInstance` is removed. Today's timeline is now synthesised
// directly from `(rails × active template × recurrence)` with an
// optional Task overlay for cell state. Check-in / Pending queues
// iterate Tasks and join Rail for the planned window.

import { type DayRailState, resolveTemplateForDate } from './store';
import type { Rail, Recurrence, Task } from './types';

export function toIsoDate(d: Date = new Date()): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

export function toIsoDateTime(date: string, minutesSinceMidnight: number): string {
  const h = Math.floor(minutesSinceMidnight / 60);
  const m = minutesSinceMidnight % 60;
  return `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ------------------------------------------------------------------
// Active-template resolution.
// ------------------------------------------------------------------

/** Pick the template whose rails should drive today. Walks CalendarRules
 *  first, then falls back to the first built-in template. */
export function selectActiveTemplateKey(
  state: Pick<DayRailState, 'templates' | 'calendarRules'>,
  date: string = toIsoDate(),
): string | null {
  const fallback = (): string | null => {
    const templates = Object.values(state.templates);
    if (templates.length === 0) return null;
    return (templates.find((t) => t.isDefault) ?? templates[0]!).key;
  };
  return resolveTemplateForDate(state, date, fallback);
}

// ------------------------------------------------------------------
// Recurrence helper (mirrors autoTask.recurrenceCovers so callers in
// this file don't need a circular import).
// ------------------------------------------------------------------

function recurrenceCovers(recurrence: Recurrence, dateIso: string): boolean {
  const dow = new Date(`${dateIso}T00:00:00`).getDay();
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
// Shared row shape for check-in / Pending queues.
// ------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Task + (optional) Rail + (optional) planned window. v0.4 check-in
 *  / Pending queue rows bundle all three so UI code doesn't have to
 *  re-join. Status lives on `task.status`.
 *
 *  `rail` / `plannedStart` / `plannedEnd` are undefined for slot-less
 *  Tasks that surface in Pending (e.g. a deferred Inbox task that
 *  never got scheduled). The check-in strip only emits rows with all
 *  three fields filled in. */
export interface CarriedTaskRow {
  task: Task;
  rail?: Rail;
  plannedStart?: string; // ISO datetime
  plannedEnd?: string; // ISO datetime
}

function plannedWindow(rail: Rail, date: string): { start: string; end: string } {
  return {
    start: toIsoDateTime(date, rail.startMinutes),
    end: toIsoDateTime(date, rail.startMinutes + rail.durationMinutes),
  };
}

function byPlannedStartRow(a: CarriedTaskRow, b: CarriedTaskRow): number {
  // Slot-less rows sort after slot-bearing rows (blank plannedStart
  // sorts last under localeCompare).
  return (a.plannedStart ?? '').localeCompare(b.plannedStart ?? '');
}

/** Narrowed variant of CarriedTaskRow where rail + planned window are
 *  guaranteed present. Check-in strip rows are always rail-bound. */
export type RailBoundTaskRow = Required<CarriedTaskRow>;

/** §5.6 check-in strip: Rail-carrying Tasks (hand-built or auto-habit)
 *  whose planned window ended within the last 24 h and whose
 *  `Task.status = 'pending'`. Rails with `showInCheckin=false` are
 *  excluded. Bare rails (no Task on `(date, railId)`) do NOT surface —
 *  the v0.4 rule is "needs marking" is a Task-level concept (§5.6). */
export function selectCheckinQueue(
  state: Pick<DayRailState, 'tasks' | 'rails'>,
  now: Date = new Date(),
): RailBoundTaskRow[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - MS_PER_DAY;
  const rows: RailBoundTaskRow[] = [];
  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'pending') continue;
    if (!task.slot) continue;
    const rail = state.rails[task.slot.railId];
    if (!rail) continue;
    if (!rail.showInCheckin) continue;
    const { start, end } = plannedWindow(rail, task.slot.date);
    const endMs = Date.parse(end);
    if (Number.isNaN(endMs)) continue;
    if (endMs > nowMs) continue; // hasn't ended yet
    if (endMs <= cutoff) continue; // > 24 h ago — §5.7 queue
    rows.push({ task, rail, plannedStart: start, plannedEnd: end });
  }
  return rows.sort(byPlannedStartRow);
}

/** §5.7 Pending queue — the master list of "awaiting a decision":
 *  1. Every `deferred` Task (any source: rail-bound, adhoc-bound, or
 *     plain Inbox task the user explicitly set aside).
 *  2. `pending` Tasks with a slot whose planned window ended (any
 *     age — the check-in strip shows the last 24 h subset).
 *  Future-pending slot tasks, terminal `done / archived / deleted`,
 *  and pending slot-less tasks are excluded. */
export function selectPendingQueue(
  state: Pick<DayRailState, 'tasks' | 'rails'>,
  now: Date = new Date(),
): CarriedTaskRow[] {
  const nowMs = now.getTime();
  const rows: CarriedTaskRow[] = [];
  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'pending' && task.status !== 'deferred') continue;
    if (task.slot) {
      const rail = state.rails[task.slot.railId];
      if (!rail) continue;
      const { start, end } = plannedWindow(rail, task.slot.date);
      if (task.status === 'pending') {
        const endMs = Date.parse(end);
        if (Number.isNaN(endMs)) continue;
        if (endMs > nowMs) continue;
      }
      rows.push({ task, rail, plannedStart: start, plannedEnd: end });
    } else if (task.status === 'deferred') {
      // Slot-less deferred task — e.g. an Inbox item the user pushed
      // to "later" without scheduling. No planned window to check;
      // include unconditionally so the user can still resolve it.
      rows.push({ task });
    }
  }
  return rows.sort(byPlannedStartRow);
}

// ------------------------------------------------------------------
// Today-timeline selector.
// ------------------------------------------------------------------

export interface TimelineRow {
  /** Key: `${railId}|${date}` — guaranteed unique per day. */
  key: string;
  rail: Rail;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  /** All tasks scheduled to (date, railId). Empty = bare rail.
   *  ERD §4.1 "Slot ↔ Task one-to-many" — a single rail on a single
   *  date may carry multiple tasks. */
  tasks: Task[];
}

/** Today's timeline — the union of:
 *    (a) Rails whose template matches today's active template AND
 *        whose recurrence covers today (the normal "day structure").
 *    (b) Rails that have a scheduled Task on today, regardless of
 *        template / recurrence. This catches "I parked a task on
 *        a workday rail for Sunday" — the task carries an explicit
 *        intent and should be visible today even though the rail
 *        wouldn't fire normally.
 *  Cell state is derived by the caller from `row.task?.status`. */
export function selectTodayTimeline(
  state: Pick<DayRailState, 'rails' | 'tasks' | 'templates' | 'calendarRules'>,
  date: string,
): TimelineRow[] {
  const activeTemplate = selectActiveTemplateKey(state, date);

  // Index tasks by (date, railId) — used both for the task-carrying
  // rail set (b) and for the per-row task lookup. v0.4 supports
  // multiple tasks per (rail, date) so the value is an array.
  const tasksByKey = new Map<string, Task[]>();
  const taskRailIds = new Set<string>();
  for (const t of Object.values(state.tasks)) {
    if (!t.slot) continue;
    if (t.status === 'deleted') continue;
    if (t.slot.date !== date) continue;
    const key = `${t.slot.railId}|${date}`;
    const bucket = tasksByKey.get(key);
    if (bucket) bucket.push(t);
    else tasksByKey.set(key, [t]);
    taskRailIds.add(t.slot.railId);
  }

  // Build the set of rail ids to render:
  const railIds = new Set<string>();
  for (const rail of Object.values(state.rails)) {
    if (
      activeTemplate &&
      rail.templateKey === activeTemplate &&
      recurrenceCovers(rail.recurrence, date)
    ) {
      railIds.add(rail.id); // (a)
    }
  }
  for (const id of taskRailIds) railIds.add(id); // (b)

  const rows: TimelineRow[] = [];
  for (const railId of railIds) {
    const rail = state.rails[railId];
    if (!rail) continue;
    const { start, end } = plannedWindow(rail, date);
    // Per-slot sort: pending first, then in-progress/done/deferred,
    // archived last. Within a group, preserve insertion order.
    const bucket = tasksByKey.get(`${rail.id}|${date}`) ?? [];
    const tasks = [...bucket].sort(
      (a, b) => taskStatusRank(a) - taskStatusRank(b),
    );
    rows.push({
      key: `${rail.id}|${date}`,
      rail,
      date,
      plannedStart: start,
      plannedEnd: end,
      tasks,
    });
  }
  return rows.sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
}

function taskStatusRank(t: Task): number {
  switch (t.status) {
    case 'pending':
    case 'in-progress':
      return 0;
    case 'done':
      return 1;
    case 'deferred':
      return 2;
    case 'archived':
      return 3;
    default:
      return 4;
  }
}
