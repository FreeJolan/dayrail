// Today Track helpers — date formatting, instance materialisation, and
// check-in / pending queue selectors.
//
// Conventions:
//   - Date strings are local wall-clock "YYYY-MM-DD" (no timezone).
//   - Datetime strings are local "YYYY-MM-DDTHH:MM" (no seconds, no Z).
//     `Date.parse` on these yields local time on modern engines, which
//     is what we want for "ended before now?" comparisons.
//   - All v0.2 code is single-device / single-timezone. Multi-device
//     clock reconciliation is deferred to sync work.

import { useStore, type DayRailState } from './store';
import type { Rail, RailInstance, Task } from './types';

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
// Materialisation — turn the active template's rails into concrete
// RailInstances for a given date. Idempotent by `(date, railId)`.
// ------------------------------------------------------------------

/** Pick the template whose rails should drive today. v0.2 is CalendarRule-
 *  naive — until the rules engine lands in a later milestone, we fall
 *  back to the first built-in template (usually 'workday'). */
export function selectActiveTemplateKey(
  state: Pick<DayRailState, 'templates'>,
): string | null {
  const templates = Object.values(state.templates);
  if (templates.length === 0) return null;
  const builtIn = templates.find((t) => t.isDefault);
  return (builtIn ?? templates[0]!).key;
}

export async function ensureTodayInstances(
  date: string,
  templateKey: string,
): Promise<void> {
  const state = useStore.getState();
  const rails = Object.values(state.rails).filter(
    (r) => r.templateKey === templateKey,
  );
  const existingRailIds = new Set(
    Object.values(state.railInstances)
      .filter((i) => i.date === date)
      .map((i) => i.railId),
  );
  for (const rail of rails) {
    if (existingRailIds.has(rail.id)) continue;
    await state.createRailInstance({
      id: `inst-${date}-${rail.id}`,
      railId: rail.id,
      date,
      plannedStart: toIsoDateTime(date, rail.startMinutes),
      plannedEnd: toIsoDateTime(
        date,
        rail.startMinutes + rail.durationMinutes,
      ),
    });
  }
}

// ------------------------------------------------------------------
// Queue selectors — both for Today Track's check-in strip and the
// separate Pending screen. They share the same source data but differ
// in the freshness bucket.
// ------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function byPlannedStart(a: RailInstance, b: RailInstance): number {
  return a.plannedStart.localeCompare(b.plannedStart);
}

/** Task + Rail + planned window. v0.4 check-in / Pending queue rows
 *  bundle all three so UI code doesn't have to re-join. The associated
 *  RailInstance (if present) is included for audit / Shift writes;
 *  status semantics live on `task`. */
export interface CarriedTaskRow {
  task: Task;
  rail: Rail;
  plannedStart: string; // ISO datetime
  plannedEnd: string; // ISO datetime
  /** RailInstance for the same (date, railId), if materialised. v0.4
   *  keeps writing to RailInstance.status as a dual-write so legacy
   *  surfaces don't regress; Stage 9 drops this. */
  railInstance: RailInstance | undefined;
}

function plannedWindow(rail: Rail, date: string): { start: string; end: string } {
  return {
    start: toIsoDateTime(date, rail.startMinutes),
    end: toIsoDateTime(date, rail.startMinutes + rail.durationMinutes),
  };
}

function findInstanceFor(
  railInstances: Record<string, RailInstance>,
  railId: string,
  date: string,
): RailInstance | undefined {
  for (const inst of Object.values(railInstances)) {
    if (inst.railId === railId && inst.date === date) return inst;
  }
  return undefined;
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
  state: Pick<DayRailState, 'tasks' | 'rails' | 'railInstances'>,
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
    rows.push({
      task,
      rail,
      plannedStart: start,
      plannedEnd: end,
      railInstance: findInstanceFor(state.railInstances, rail.id, task.slot.date),
    });
  }
  return rows.sort(byPlannedStartRow);
}

/** §5.7 Pending queue — the master list of "awaiting a decision":
 *  1. Tasks with `status = 'deferred'` (user picked "Later").
 *  2. Tasks with `status = 'pending'` whose planned window ended
 *     (any age — the check-in strip shows the last 24 h subset).
 *  Future `pending`, terminal `done / archived / deleted`, and Tasks
 *  without a slot are excluded (no schedule = no queue position). */
export function selectPendingQueue(
  state: Pick<DayRailState, 'tasks' | 'rails' | 'railInstances'>,
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
    rows.push({
      task,
      rail,
      plannedStart: start,
      plannedEnd: end,
      railInstance: findInstanceFor(state.railInstances, rail.id, task.slot.date),
    });
  }
  return rows.sort(byPlannedStartRow);
}

/** Today's timeline: every instance on the given date, in planned-start
 *  order. Used by the main Today Track list. */
export function selectTodayTimeline(
  state: Pick<DayRailState, 'railInstances'>,
  date: string,
): RailInstance[] {
  return Object.values(state.railInstances)
    .filter((i) => i.date === date)
    .sort(byPlannedStart);
}
