// Live-data derivation for the Review view (ERD §5.8).
// Feeds `RhythmHeatmap`, `ShiftTagBars`, and the ad-hoc hint card the
// same `ReviewScopeData` shape the static mock used, so the UI layer
// didn't need to change — only the source.
//
// Scope (day / cycle / month) is expressed by passing different date
// ranges; the derivation is the same.

import type { DayRailState, Task } from '@dayrail/core';
import type {
  HeatmapRow,
  HeatmapState,
  ReviewScopeData,
  ShiftTagStat,
} from '@/data/sampleReview';
import type { RailColor } from '@/data/sample';
import { pickTemplateForDate, toIsoDate } from './cycleFromStore';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeriveReviewInput {
  scope: ReviewScopeData['scope'];
  label: string;
  dates: string[]; // ISO YYYY-MM-DD
  /** Optional habit-line filter. When set, only rails bound to this
   *  habit (`rail.defaultLineId === habitLineId`) contribute rows. */
  habitLineId?: string;
}

/** Phase-band overlay data for a habit's rhythm view. Each entry is
 *  a contiguous column range where one phase was active on the
 *  date axis, derived from HabitPhase records + the scope's dates. */
export interface PhaseBand {
  phaseId: string;
  label: string;
  /** Inclusive column indices into `dates`. */
  startCol: number;
  endCol: number;
}

/** Assemble one scope's snapshot from live store state. */
export function deriveReviewData(
  state: Pick<
    DayRailState,
    | 'rails'
    | 'railInstances'
    | 'tasks'
    | 'templates'
    | 'calendarRules'
    | 'shifts'
    | 'adhocEvents'
  >,
  input: DeriveReviewInput,
): ReviewScopeData {
  const { scope, label, dates, habitLineId } = input;
  const todayIso = toIsoDate(new Date());

  // Pre-resolve the applicable template per date so each rail lookup
  // doesn't re-walk CalendarRules + the weekday heuristic.
  const templateByDate = new Map<string, string | null>();
  for (const date of dates) {
    templateByDate.set(date, pickTemplateForDate(state, date));
  }

  // v0.4: Task.status is the single source of truth (ERD §10.1).
  // Index tasks by (railId|date) — both hand-built and auto-habit
  // tasks flow through the same path.
  const taskByKey = new Map<string, Task>();
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'deleted') continue;
    if (!task.slot) continue;
    taskByKey.set(`${task.slot.railId}|${task.slot.date}`, task);
  }

  // Filter rails to those bound to the selected habit Line when
  // habit scope is active. Rails without a `defaultLineId` (general-
  // purpose rails) only surface in "all" view.
  const rails = Object.values(state.rails).filter(
    (r) => !habitLineId || r.defaultLineId === habitLineId,
  );
  const rows: HeatmapRow[] = [];
  let totalSlots = 0;
  let totalDone = 0;

  for (const rail of rails) {
    const byDate: Record<string, HeatmapState> = {};
    let frequency = 0; // how many dates this rail applied to

    for (const date of dates) {
      const templateKey = templateByDate.get(date);
      const applies = templateKey === rail.templateKey;
      if (!applies) {
        byDate[date] = 'empty';
        continue;
      }
      frequency++;

      const key = `${rail.id}|${date}`;
      const task = taskByKey.get(key);

      let cell: HeatmapState;
      if (task?.status === 'done') {
        cell = 'done';
      } else if (task?.status === 'deferred') {
        cell = 'shifted';
      } else if (task?.status === 'archived') {
        cell = 'skipped';
      } else {
        // No terminal state yet: past days count as unmarked (stale-
        // pending), future days as empty (rail hasn't run yet).
        cell = date < todayIso ? 'unmarked' : 'empty';
      }
      byDate[date] = cell;
      if (cell !== 'empty') {
        totalSlots++;
        if (cell === 'done') totalDone++;
      }
    }

    if (frequency === 0) continue; // rail never applied in range
    rows.push({
      railId: rail.id,
      railName: rail.name,
      color: rail.color as RailColor,
      byDate,
    });
  }

  // Stable sort: rails that applied more days first; within a tier,
  // earlier start time first (matches the Cycle View ordering).
  rows.sort((a, b) => {
    const af = countApplied(a);
    const bf = countApplied(b);
    if (bf !== af) return bf - af;
    const ra = state.rails[a.railId];
    const rb = state.rails[b.railId];
    return (ra?.startMinutes ?? 0) - (rb?.startMinutes ?? 0);
  });

  const shiftTags = aggregateShiftTags(state, dates);
  const adhocHint = findRecurringAdhocHint(state, dates);

  return {
    scope,
    label,
    dates,
    rows,
    shiftTags,
    adhocHint,
    totalDone,
    totalSlots,
    rhythmMatchPct:
      totalSlots === 0 ? 0 : Math.round((totalDone / totalSlots) * 100),
  };
}

function countApplied(row: HeatmapRow): number {
  let n = 0;
  for (const s of Object.values(row.byDate)) {
    if (s !== 'empty') n++;
  }
  return n;
}

function aggregateShiftTags(
  state: Pick<DayRailState, 'shifts' | 'railInstances'>,
  dates: string[],
): ShiftTagStat[] {
  const dateSet = new Set(dates);
  const tally = new Map<string, number>();
  for (const sh of Object.values(state.shifts)) {
    const inst = state.railInstances[sh.railInstanceId];
    if (!inst || !dateSet.has(inst.date)) continue;
    for (const tag of sh.tags ?? []) {
      tally.set(tag, (tally.get(tag) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

/** "XX happened N times on Wednesdays". Returns the single most
 *  interesting recurring ad-hoc by (name, weekday) — if any name hits
 *  the same weekday ≥ 3 times, surface it; else undefined. */
function findRecurringAdhocHint(
  state: Pick<DayRailState, 'adhocEvents'>,
  dates: string[],
): ReviewScopeData['adhocHint'] {
  const dateSet = new Set(dates);
  const byNameWeekday = new Map<string, number>();
  const nameFirstSeen = new Map<string, string>();
  for (const ev of Object.values(state.adhocEvents)) {
    if (ev.status !== 'active') continue;
    if (!dateSet.has(ev.date)) continue;
    const dt = new Date(`${ev.date}T00:00:00`);
    const key = `${ev.name}|${dt.getDay()}`;
    byNameWeekday.set(key, (byNameWeekday.get(key) ?? 0) + 1);
    if (!nameFirstSeen.has(ev.name)) nameFirstSeen.set(ev.name, ev.date);
  }
  let bestKey: string | null = null;
  let bestN = 0;
  for (const [k, n] of byNameWeekday) {
    if (n > bestN) {
      bestKey = k;
      bestN = n;
    }
  }
  if (bestKey == null || bestN < 3) return undefined;
  const [name, weekdayStr] = bestKey.split('|');
  const weekday = Number(weekdayStr);
  const weekdayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    weekday
  ] ?? '';
  return {
    eventName: name ?? '',
    weekdayLabel,
    occurrences: bestN,
  };
}

/** Compute the 7 ISO dates (Monday-anchored) for the week containing
 *  `anchor`. Matches the Cycle View convention. */
export function cycleDatesFor(anchor: Date): string[] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + offset);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(toIsoDate(new Date(start.getTime() + i * DAY_MS)));
  }
  return out;
}

/** All ISO dates for a calendar month. */
export function monthDatesFor(year: number, month: number): string[] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const out: string[] = [];
  for (let d = 1; d <= last.getDate(); d++) {
    out.push(toIsoDate(new Date(first.getFullYear(), first.getMonth(), d)));
  }
  return out;
}

/** Build phase-band overlays for a habit's rhythm view.
 *
 *  For each HabitPhase whose startDate falls on or before the last
 *  date in `dates`, we emit a band covering the column range where
 *  that phase was "active" — from max(phase.startDate, dates[0]) to
 *  min(nextPhase.startDate - 1 day, dates[last]). Phases fully in
 *  the future of `dates[0]` get a band only if their startDate is
 *  within the window. Phases fully before `dates[0]` are included
 *  as a single leading band.
 */
export function buildPhaseBands(
  phases: Array<{ id: string; name: string; startDate: string }>,
  dates: string[],
): PhaseBand[] {
  if (dates.length === 0 || phases.length === 0) return [];
  const sorted = [...phases].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;

  const bands: PhaseBand[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const nextStart = sorted[i + 1]?.startDate;
    // The phase's active span on the date axis. Inclusive on both
    // ends in ISO-string compare since all dates are YYYY-MM-DD.
    const spanFrom = cur.startDate > first ? cur.startDate : first;
    const spanTo = nextStart
      ? isoDatePlus(nextStart, -1)
      : last;
    if (spanFrom > last) continue; // phase is wholly in the future of the window
    if (spanTo < first) continue; // phase was replaced before the window opened
    const startCol = dates.indexOf(spanFrom);
    const endCol = dates.indexOf(spanTo);
    if (startCol < 0 || endCol < 0) continue;
    bands.push({
      phaseId: cur.id,
      label: cur.name,
      startCol,
      endCol,
    });
  }
  return bands;
}

function isoDatePlus(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}
