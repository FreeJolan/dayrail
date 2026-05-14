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
// directly from `(rails × active template)` with an optional Task
// overlay for cell state. Check-in / Pending queues iterate Tasks
// and join Rail for the planned window.

import {
  type DayRailState,
  resolveTemplateForDate,
  selectOccurrencesForTask,
} from './store';
import { railAtDate, railFromRevision, railsActiveOn } from './revisions';
import { deriveTaskStatus, isOccurrenceManaged } from './types';
import type { Rail, Task, TaskOccurrence } from './types';

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

/** Pick the template whose rails should drive today. Walks CalendarRule
 *  revisions first, then falls back to the first built-in template. */
export function selectActiveTemplateKey(
  state: Pick<
    DayRailState,
    | 'templates'
    | 'calendarRules'
    | 'calendarRuleRevisions'
    | 'calendarRuleTombstones'
  >,
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
  /** ERD §10.6 v0.11. When this row represents a TaskOccurrence
   *  rather than the bare Task, the occurrence is set; UI surfaces
   *  read `occurrence.label ?? task.title` and prefer `occurrence.percent`
   *  for the milestone badge. Omitted for legacy (no-occurrence) Tasks. */
  occurrence?: TaskOccurrence;
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
 *  the v0.4 rule is "needs marking" is a Task-level concept (§5.6).
 *
 *  Phase 2: rail data resolves via `railAtDate(slot.date)` so an
 *  overdue task on Tuesday shows the time/name the rail had on
 *  Tuesday, not whatever the user set later. */
export function selectCheckinQueue(
  state: Pick<
    DayRailState,
    'tasks' | 'taskOccurrences' | 'railRevisions' | 'railTombstones'
  >,
  now: Date = new Date(),
): RailBoundTaskRow[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - MS_PER_DAY;
  const rows: RailBoundTaskRow[] = [];
  // Helper: per-slot row builder. Returns null when the slot doesn't
  // surface in the check-in window.
  const buildRow = (
    task: Task,
    occurrence: TaskOccurrence | undefined,
    slot: { cycleId: string; date: string; railId: string },
  ): RailBoundTaskRow | null => {
    const rev = railAtDate(state, slot.railId, slot.date);
    if (!rev) return null;
    if (!rev.showInCheckin) return null;
    const rail = railFromRevision(rev);
    const { start, end } = plannedWindow(rail, slot.date);
    const endMs = Date.parse(end);
    if (Number.isNaN(endMs)) return null;
    if (endMs > nowMs) return null;
    if (endMs <= cutoff) return null;
    return {
      task,
      ...(occurrence !== undefined && { occurrence }),
      rail,
      plannedStart: start,
      plannedEnd: end,
    } as RailBoundTaskRow;
  };
  for (const task of Object.values(state.tasks)) {
    const occs = selectOccurrencesForTask(state, task.id);
    if (isOccurrenceManaged(occs)) {
      // ERD §10.6 v0.11 — adoption-gated. Each pending slot-bearing
      // occurrence surfaces independently. The host Task's legacy slot
      // is ignored on this branch.
      const derived = deriveTaskStatus(task, occs);
      if (derived === 'archived' || derived === 'deleted') continue;
      for (const occ of occs) {
        if (occ.status !== 'pending') continue;
        if (!occ.slot) continue;
        const row = buildRow(task, occ, occ.slot);
        if (row) rows.push(row);
      }
    } else {
      // Legacy / pre-adoption path: Task.slot is the scheduling source.
      if (task.status !== 'pending') continue;
      if (!task.slot) continue;
      const row = buildRow(task, undefined, task.slot);
      if (row) rows.push(row);
    }
  }
  return rows.sort(byPlannedStartRow);
}

/** §5.7 Pending queue — the master list of "awaiting a decision":
 *  1. Every `deferred` Task (any source: rail-bound, adhoc-bound, or
 *     plain Inbox task the user explicitly set aside).
 *  2. `pending` Tasks with a slot whose planned window ended (any
 *     age — the check-in strip shows the last 24 h subset).
 *  Future-pending slot tasks, terminal `done / archived / deleted`,
 *  and pending slot-less tasks are excluded.
 *
 *  Phase 2: rail data resolves via `railAtDate(slot.date)` so the row
 *  shows the rail's appearance on the slot's date, not the current
 *  one. */
export function selectPendingQueue(
  state: Pick<
    DayRailState,
    'tasks' | 'taskOccurrences' | 'railRevisions' | 'railTombstones'
  >,
  now: Date = new Date(),
): CarriedTaskRow[] {
  const nowMs = now.getTime();
  const rows: CarriedTaskRow[] = [];
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'deleted') continue;
    const occs = selectOccurrencesForTask(state, task.id);
    if (isOccurrenceManaged(occs)) {
      // ERD §10.6 v0.11 — per-occurrence rows. Each pending occurrence
      // with a slot whose planned window has ended surfaces; no
      // 'deferred' status on occurrences (the host Task carries that
      // semantics if at all).
      const derived = deriveTaskStatus(task, occs);
      if (derived === 'archived') continue;
      for (const occ of occs) {
        if (occ.status !== 'pending') continue;
        if (!occ.slot) continue;
        const rev = railAtDate(state, occ.slot.railId, occ.slot.date);
        if (!rev) continue;
        const rail = railFromRevision(rev);
        const { start, end } = plannedWindow(rail, occ.slot.date);
        const endMs = Date.parse(end);
        if (Number.isNaN(endMs)) continue;
        if (endMs > nowMs) continue;
        rows.push({
          task,
          occurrence: occ,
          rail,
          plannedStart: start,
          plannedEnd: end,
        });
      }
      continue;
    }
    // Legacy path — Task.slot single, or slot-less deferred.
    if (task.status !== 'pending' && task.status !== 'deferred') continue;
    if (task.slot) {
      const rev = railAtDate(state, task.slot.railId, task.slot.date);
      if (!rev) continue;
      const rail = railFromRevision(rev);
      const { start, end } = plannedWindow(rail, task.slot.date);
      if (task.status === 'pending') {
        const endMs = Date.parse(end);
        if (Number.isNaN(endMs)) continue;
        if (endMs > nowMs) continue;
      }
      rows.push({ task, rail, plannedStart: start, plannedEnd: end });
    } else if (task.status === 'deferred') {
      rows.push({ task });
    }
  }
  return rows.sort(byPlannedStartRow);
}

// ------------------------------------------------------------------
// Today-timeline selector.
// ------------------------------------------------------------------

/** ERD §10.6 v0.11 · one renderable item inside a slot. When the host
 *  Task has TaskOccurrences, each occurrence in this slot is one
 *  entry; otherwise the bare Task is the single entry. */
export interface SlotEntry {
  task: Task;
  occurrence?: TaskOccurrence;
}

export interface TimelineRow {
  /** Key: `${railId}|${date}` — guaranteed unique per day. */
  key: string;
  rail: Rail;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  /** ERD §10.6 v0.11 — per-slot entries. The rendering source of truth.
   *  Each `entry` is either `{ task }` (legacy / no occurrences) or
   *  `{ task, occurrence }` (one row per occurrence on this slot). */
  entries: SlotEntry[];
  /** @deprecated v0.11+: read `entries` instead. Mirrors
   *  `entries.map(e => e.task)`; preserved so existing UI surfaces
   *  keep compiling while they migrate. Will be removed in a future
   *  cleanup. */
  tasks: Task[];
}

/** Today's timeline — the union of:
 *    (a) Rails whose template matches today's active template
 *        (the normal "day structure").
 *    (b) Rails that have a scheduled Task on today, regardless of
 *        template. This catches "I parked a task on a workday rail
 *        for Sunday" — the task carries an explicit intent and should
 *        be visible today even though the rail wouldn't fire normally.
 *  Cell state is derived by the caller from `row.task?.status`. */
export function selectTodayTimeline(
  state: Pick<
    DayRailState,
    | 'rails'
    | 'tasks'
    | 'taskOccurrences'
    | 'templates'
    | 'calendarRules'
    | 'calendarRuleRevisions'
    | 'calendarRuleTombstones'
    | 'railRevisions'
    | 'railTombstones'
  >,
  date: string,
): TimelineRow[] {
  const activeTemplate = selectActiveTemplateKey(state, date);

  // ERD §10.6 v0.11 · indexing strategy. Two passes build a
  // per-(railId|date) bucket of SlotEntry. (1) iterate tasks: tasks
  // WITHOUT occurrences land directly via task.slot (legacy); tasks
  // WITH occurrences contribute one entry per matching occurrence
  // (task.slot is ignored when occurrences are non-empty per §10.6).
  // (2) collect referenced railIds for the (b) rail-set fold-in.
  const entriesByKey = new Map<string, SlotEntry[]>();
  const taskRailIds = new Set<string>();

  for (const t of Object.values(state.tasks)) {
    if (t.status === 'deleted') continue;
    const occs = selectOccurrencesForTask(state, t.id);
    if (isOccurrenceManaged(occs)) {
      for (const occ of occs) {
        if (!occ.slot) continue;
        if (occ.slot.date !== date) continue;
        if (occ.status === 'archived') continue;
        const key = `${occ.slot.railId}|${date}`;
        const bucket = entriesByKey.get(key);
        const entry: SlotEntry = { task: t, occurrence: occ };
        if (bucket) bucket.push(entry);
        else entriesByKey.set(key, [entry]);
        taskRailIds.add(occ.slot.railId);
      }
      continue;
    }
    // Legacy / pre-adoption path
    if (!t.slot) continue;
    if (t.slot.date !== date) continue;
    const key = `${t.slot.railId}|${date}`;
    const bucket = entriesByKey.get(key);
    const entry: SlotEntry = { task: t };
    if (bucket) bucket.push(entry);
    else entriesByKey.set(key, [entry]);
    taskRailIds.add(t.slot.railId);
  }

  // §10.5 Phase 2 · resolve rails via `railsActiveOn(date)` so the
  // timeline reflects each rail's appearance on `date` rather than
  // its current-state mirror. (a) takes the rails whose date-effective
  // templateKey matches today's template; (b) folds in any rail
  // referenced by a slot entry, even if its template differs (carries
  // the user's explicit park-on-this-rail intent).
  const railsByDate = new Map<string, Rail>();
  for (const { railId, revision } of railsActiveOn(state, date)) {
    if (activeTemplate && revision.templateKey === activeTemplate) {
      railsByDate.set(railId, railFromRevision(revision));
    }
  }
  for (const railId of taskRailIds) {
    if (railsByDate.has(railId)) continue;
    const rev = railAtDate(state, railId, date);
    if (rev) railsByDate.set(railId, railFromRevision(rev));
  }

  const rows: TimelineRow[] = [];
  for (const [railId, rail] of railsByDate) {
    const { start, end } = plannedWindow(rail, date);
    // Per-slot sort: pending first, then done, then deferred, archived
    // last. Within a group, preserve insertion order. Sort key uses
    // the entry's effective status — for occurrence entries that's
    // occurrence.status; for legacy task entries that's task.status.
    const bucket = entriesByKey.get(`${railId}|${date}`) ?? [];
    const entries = [...bucket].sort(
      (a, b) => entryStatusRank(a) - entryStatusRank(b),
    );
    rows.push({
      key: `${railId}|${date}`,
      rail,
      date,
      plannedStart: start,
      plannedEnd: end,
      entries,
      tasks: entries.map((e) => e.task),
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

/** ERD §10.6 v0.11 — sort rank for a slot entry. Occurrence entries
 *  use occurrence.status; bare task entries fall back to task.status. */
function entryStatusRank(entry: SlotEntry): number {
  if (entry.occurrence) {
    switch (entry.occurrence.status) {
      case 'pending':
        return 0;
      case 'done':
        return 1;
      case 'archived':
        return 3;
      default:
        return 4;
    }
  }
  return taskStatusRank(entry.task);
}
