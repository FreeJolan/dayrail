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

/** Task + Rail + planned window. v0.4 check-in / Pending queue rows
 *  bundle all three so UI code doesn't have to re-join. Status lives
 *  on `task.status`; planned window is derived from rail + slot.date. */
export interface CarriedTaskRow {
  task: Task;
  rail: Rail;
  plannedStart: string; // ISO datetime
  plannedEnd: string; // ISO datetime
}

function plannedWindow(rail: Rail, date: string): { start: string; end: string } {
  return {
    start: toIsoDateTime(date, rail.startMinutes),
    end: toIsoDateTime(date, rail.startMinutes + rail.durationMinutes),
  };
}

function byPlannedStartRow(a: CarriedTaskRow, b: CarriedTaskRow): number {
  return a.plannedStart.localeCompare(b.plannedStart);
}

/** §5.6 check-in strip: Rail-carrying Tasks (hand-built or auto-habit)
 *  whose planned window ended within the last 24 h and whose
 *  `Task.status = 'pending'`. Rails with `showInCheckin=false` are
 *  excluded. Bare rails (no Task on `(date, railId)`) do NOT surface —
 *  the v0.4 rule is "needs marking" is a Task-level concept (§5.6). */
export function selectCheckinQueue(
  state: Pick<DayRailState, 'tasks' | 'rails'>,
  now: Date = new Date(),
): CarriedTaskRow[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - MS_PER_DAY;
  const rows: CarriedTaskRow[] = [];
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
 *  1. Tasks with `status = 'deferred'` (user picked "Later").
 *  2. Tasks with `status = 'pending'` whose planned window ended
 *     (any age — the check-in strip shows the last 24 h subset).
 *  Future `pending`, terminal `done / archived / deleted`, and Tasks
 *  without a slot are excluded. */
export function selectPendingQueue(
  state: Pick<DayRailState, 'tasks' | 'rails'>,
  now: Date = new Date(),
): CarriedTaskRow[] {
  const nowMs = now.getTime();
  const rows: CarriedTaskRow[] = [];
  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'pending' && task.status !== 'deferred') continue;
    if (!task.slot) continue;
    const rail = state.rails[task.slot.railId];
    if (!rail) continue;
    const { start, end } = plannedWindow(rail, task.slot.date);
    if (task.status === 'pending') {
      const endMs = Date.parse(end);
      if (Number.isNaN(endMs)) continue;
      if (endMs > nowMs) continue;
    }
    rows.push({ task, rail, plannedStart: start, plannedEnd: end });
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
  /** Carrying task if one exists on this (date, railId); else undefined. */
  task: Task | undefined;
}

/** Today's timeline: every rail the active template covers whose
 *  recurrence fires on `date`, in planned-start order. Cell state is
 *  derived by the caller from `row.task?.status`. */
export function selectTodayTimeline(
  state: Pick<DayRailState, 'rails' | 'tasks' | 'templates' | 'calendarRules'>,
  date: string,
): TimelineRow[] {
  const activeTemplate = selectActiveTemplateKey(state, date);
  if (!activeTemplate) return [];
  const rails = Object.values(state.rails).filter(
    (r) => r.templateKey === activeTemplate && recurrenceCovers(r.recurrence, date),
  );
  // Index tasks by (date, railId) to O(1) the lookup per row.
  const taskByKey = new Map<string, Task>();
  for (const t of Object.values(state.tasks)) {
    if (!t.slot) continue;
    if (t.status === 'deleted') continue;
    if (t.slot.date !== date) continue;
    taskByKey.set(`${t.slot.railId}|${date}`, t);
  }
  const rows: TimelineRow[] = rails.map((rail) => {
    const { start, end } = plannedWindow(rail, date);
    const task = taskByKey.get(`${rail.id}|${date}`);
    return {
      key: `${rail.id}|${date}`,
      rail,
      date,
      plannedStart: start,
      plannedEnd: end,
      task,
    };
  });
  return rows.sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
}
