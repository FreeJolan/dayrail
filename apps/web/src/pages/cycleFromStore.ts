// Shared helpers for deriving Cycle-View shapes from live store state.
// The Cycle-View components were originally wired against
// `sampleCycle`'s type shapes (SampleCycle / CycleDay / CycleSlot /
// EditableRail). Rather than rewrite all five components at once, we
// shim those shapes out of store data — commit 1 of the Cycle-View
// wire-up keeps the UI layer mostly intact and only swaps the data
// source.

import type {
  DayRailState,
  Rail,
  Task,
} from '@dayrail/core';
import { resolveTemplateForDate, singleDateRuleId } from '@dayrail/core';
import type {
  CycleDay,
  CycleSlot,
  SampleCycle,
} from '@/data/sampleCycle';
import type { EditableRail, TemplateKey } from '@/data/sampleTemplate';
import type { RailColor } from '@/data/sample';

const DAY_MS = 24 * 60 * 60 * 1000;

export function toIsoDate(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

/** Monday-anchored week start for an arbitrary date. Cycle-View v0.2
 *  shows a rolling 7-day window starting from Monday of the current
 *  week; v0.3 Cycle Picker will let the user pick arbitrary ranges. */
export function startOfWeekMonday(d: Date = new Date()): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const day = r.getDay(); // 0 = Sun .. 6 = Sat
  const offset = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + offset);
  return r;
}

/** Pick a Template for a given date. CalendarRules (single-date, v0.2)
 *  win; otherwise fall back to the weekday heuristic:
 *    Mon–Fri → `workday` / first builtIn / first Template
 *    Sat / Sun → `restday` / first builtIn / first Template */
export function pickTemplateForDate(
  state: Pick<DayRailState, 'templates' | 'calendarRules'>,
  date: string,
): TemplateKey | null {
  return resolveTemplateForDate(state, date, (d) =>
    weekdayHeuristic(state.templates, d),
  );
}

function weekdayHeuristic(
  templatesMap: DayRailState['templates'],
  date: string,
): TemplateKey | null {
  const templates = Object.values(templatesMap);
  if (templates.length === 0) return null;
  const dt = new Date(`${date}T00:00:00`);
  const dow = dt.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const preferredKey = isWeekend ? 'restday' : 'workday';
  const exact = templates.find((t) => t.key === preferredKey);
  if (exact) return exact.key;
  const fallback = templates.find((t) => t.isDefault) ?? templates[0];
  return fallback ? fallback.key : null;
}

export interface DerivedCycle {
  cycle: SampleCycle;
  /** Rail list per template, in the shape CycleSection expects. */
  railsByTemplate: Record<string, EditableRail[]>;
}

/** Build a Cycle-View-shaped snapshot from live store state for the
 *  given 7-day window. Cell state is derived from `Task.status`
 *  (ERD §10.1 single-source-of-truth rule). */
export function deriveCycleFromStore(
  state: Pick<
    DayRailState,
    'templates' | 'rails' | 'tasks' | 'lines' | 'calendarRules'
  >,
  startDate: Date,
): DerivedCycle {
  const days: CycleDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate.getTime() + i * DAY_MS);
    const date = toIsoDate(d);
    const templateKey = pickTemplateForDate(state, date) ?? '';
    const overridden = Boolean(state.calendarRules[singleDateRuleId(date)]);
    days.push({
      date,
      weekday: d.getDay() as CycleDay['weekday'],
      templateKey,
      overridden,
    });
  }
  const startIso = days[0]!.date;
  const endIso = days[6]!.date;

  // Rails grouped by template — CycleSection reads `railsForDay(day)`
  // which hits this map by the day's templateKey.
  const railsByTemplate: Record<string, EditableRail[]> = {};
  for (const rail of Object.values(state.rails)) {
    const list = railsByTemplate[rail.templateKey] ?? [];
    list.push(railToEditable(rail));
    railsByTemplate[rail.templateKey] = list;
  }
  for (const key of Object.keys(railsByTemplate)) {
    railsByTemplate[key]!.sort((a, b) => a.startMin - b.startMin);
  }

  // v0.4: slot cell states come entirely from Task.status (ERD §10.1).
  //  `done`       → task.status = 'done'
  //  `skipped`    → task.status = 'deferred' (user pushed the slot out)
  //  `na`         → task.status = 'archived' (dropped this occurrence)
  //  `planned-task` → any other non-deleted task on the slot
  //  (empty cell = no task on that (date, railId))
  const slotsByKey = new Map<string, CycleSlot>();
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'deleted') continue;
    if (!task.slot) continue;
    const { date, railId } = task.slot;
    if (date < startIso || date > endIso) continue;
    const key = `${railId}|${date}`;
    let cellState: CycleSlot['state'];
    if (task.status === 'done') cellState = 'done';
    else if (task.status === 'deferred') cellState = 'skipped';
    else if (task.status === 'archived') cellState = 'na';
    else cellState = 'planned-task';
    slotsByKey.set(key, {
      railId,
      date,
      state: cellState,
      taskName: task.title,
      taskId: task.id,
    });
  }

  const slots: CycleSlot[] = [...slotsByKey.values()];

  // topLines: cheapest bar for the summary strip — pick three Projects
  // (kind='project') by task count in the current cycle window. Good
  // enough for v0.2; v0.3 tightens.
  const topLines = computeTopLines(state, slots);

  const cycle: SampleCycle = {
    id: `cycle-${startIso}`,
    label: 'This week',
    startDate: startIso,
    endDate: endIso,
    days,
    slots,
    topLines,
  };
  return { cycle, railsByTemplate };
}

function railToEditable(rail: Rail): EditableRail {
  const endMin = rail.startMinutes + rail.durationMinutes;
  return {
    id: rail.id,
    name: rail.name,
    subtitle: rail.subtitle,
    startMin: rail.startMinutes,
    endMin,
    color: rail.color as RailColor,
    showInCheckin: rail.showInCheckin,
    defaultLineId: rail.defaultLineId ?? null,
  };
}

function computeTopLines(
  state: Pick<DayRailState, 'tasks' | 'templates' | 'rails' | 'lines'>,
  slotsInCycle: CycleSlot[],
): SampleCycle['topLines'] {
  // Tasks scheduled inside the cycle window, grouped by lineId.
  const byLine = new Map<string, { done: number; planned: number }>();
  for (const s of slotsInCycle) {
    // Find the Task that owns this slot by (date, railId). The Task
    // type carries lineId + status directly.
    const matching = Object.values(state.tasks).find(
      (t) =>
        t.slot?.date === s.date &&
        t.slot?.railId === s.railId &&
        t.status !== 'archived' &&
        t.status !== 'deleted',
    );
    if (!matching) continue;
    const b = byLine.get(matching.lineId) ?? { done: 0, planned: 0 };
    if (matching.status === 'done') b.done++;
    else b.planned++;
    byLine.set(matching.lineId, b);
  }
  return [...byLine.entries()]
    .sort((a, b) => b[1].planned + b[1].done - (a[1].planned + a[1].done))
    .slice(0, 3)
    .map(([lineId, stats]) => {
      const line = state.lines[lineId];
      return {
        id: lineId,
        name: line?.name ?? lineId,
        color: (line?.color ?? 'slate') as RailColor,
        done: stats.done,
        planned: stats.planned + stats.done,
      };
    });
}

/** Tasks that would be orphaned if day `date` flipped to template
 *  `nextTemplateKey`. Orphans are tasks whose `slot` points at a Rail
 *  that does NOT belong to the new template — they'd still carry
 *  slot metadata, but no Cycle cell would render them. Callers
 *  (`CycleView`'s override handler) use this to gate the switch
 *  behind a small confirmation + batch `task.unscheduled`. */
export function findOrphanTasksForTemplateSwitch(
  state: Pick<DayRailState, 'tasks' | 'rails'>,
  date: string,
  nextTemplateKey: string,
): Task[] {
  const nextRailIds = new Set(
    Object.values(state.rails)
      .filter((r) => r.templateKey === nextTemplateKey)
      .map((r) => r.id),
  );
  return Object.values(state.tasks).filter((t) => {
    if (t.status === 'archived' || t.status === 'deleted') return false;
    if (!t.slot) return false;
    if (t.slot.date !== date) return false;
    return !nextRailIds.has(t.slot.railId);
  });
}

/** Unscheduled tasks that should appear in the Backlog drawer.
 *  Open-ended filter — includes anything not in a terminal state, not
 *  Rail-bound, and not backed by an active Ad-hoc. */
export function selectBacklogTasks(
  state: Pick<DayRailState, 'tasks' | 'adhocEvents'>,
): Task[] {
  const adhocTaskIds = new Set<string>();
  for (const a of Object.values(state.adhocEvents)) {
    if (a.status === 'active' && a.taskId) adhocTaskIds.add(a.taskId);
  }
  return Object.values(state.tasks)
    .filter((t) => t.status === 'pending' || t.status === 'in-progress')
    .filter((t) => !t.slot)
    .filter((t) => !adhocTaskIds.has(t.id))
    .sort((a, b) => a.order - b.order);
}
