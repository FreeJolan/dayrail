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
import type { RailInstance } from './types';

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
      status: 'pending',
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

/** Instances to show in §5.6 check-in strip: `status = 'pending'`,
 *  ended before `now`, and within the last 24h. Older pendings and
 *  `deferred` items live in §5.7 Pending queue instead. */
export function selectCheckinQueue(
  state: Pick<DayRailState, 'railInstances'>,
  now: Date = new Date(),
): RailInstance[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - MS_PER_DAY;
  return Object.values(state.railInstances)
    .filter((inst) => {
      if (inst.status !== 'pending') return false;
      const endMs = Date.parse(inst.plannedEnd);
      if (Number.isNaN(endMs)) return false;
      return endMs <= nowMs && endMs > cutoff;
    })
    .sort(byPlannedStart);
}

/** §5.7 Pending queue — the master list of "awaiting a decision":
 *  1. All `deferred` instances (user picked "Later").
 *  2. All `pending` instances whose `plannedEnd` has passed
 *     (regardless of age — check-in strip shows the recent subset,
 *     but Pending is the full set).
 *  Future `pending` and terminal `done / archived` are excluded —
 *  they live on the Today timeline and in history respectively. */
export function selectPendingQueue(
  state: Pick<DayRailState, 'railInstances'>,
  now: Date = new Date(),
): RailInstance[] {
  const nowMs = now.getTime();
  return Object.values(state.railInstances)
    .filter((inst) => {
      if (inst.status === 'deferred') return true;
      if (inst.status !== 'pending') return false;
      const endMs = Date.parse(inst.plannedEnd);
      if (Number.isNaN(endMs)) return false;
      return endMs <= nowMs;
    })
    .sort(byPlannedStart);
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
