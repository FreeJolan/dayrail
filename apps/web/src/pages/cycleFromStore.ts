// Shared helpers for deriving Cycle-View shapes from live store state.
// The Cycle-View components were originally wired against
// `sampleCycle`'s type shapes (SampleCycle / CycleDay / CycleSlot /
// EditableRail). Rather than rewrite all five components at once, we
// shim those shapes out of store data — commit 1 of the Cycle-View
// wire-up keeps the UI layer mostly intact and only swaps the data
// source.

import type {
  DayRailState,
  RailRevision,
  Task,
} from '@dayrail/core';
import {
  railsActiveOn,
  resolveTemplateForDate,
  singleDateRuleId,
} from '@dayrail/core';
import type {
  CycleDay,
  CycleSlot,
  SampleCycle,
  SlotTaskState,
  SlotTaskSummary,
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
  state: Pick<
    DayRailState,
    | 'templates'
    | 'calendarRules'
    | 'calendarRuleRevisions'
    | 'calendarRuleTombstones'
  >,
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
    | 'templates'
    | 'rails'
    | 'tasks'
    | 'lines'
    | 'calendarRules'
    | 'calendarRuleRevisions'
    | 'calendarRuleTombstones'
    | 'railRevisions'
    | 'railTombstones'
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

  // §10.5 Phase 3 · resolve rails per-date via `railsActiveOn(date)`
  // so past Cycle Views render rails with their historical appearance.
  // For each (templateKey, railId) pair, use the FIRST day in the
  // cycle on which the rail is active under that template — past
  // cycles whose start dates predate any later edit lock to the
  // earlier revision; current / future cycles pick up new revisions
  // from their start date forward. Per-cell rendering still resolves
  // through `task.slot.date`, so any mid-cycle rail change reads the
  // right revision at the cell level too.
  const railsByTemplate: Record<string, EditableRail[]> = {};
  const seen = new Set<string>();
  for (const day of days) {
    for (const { railId, revision } of railsActiveOn(state, day.date)) {
      if (revision.templateKey !== day.templateKey) continue;
      const dedupe = `${day.templateKey}|${railId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const list = railsByTemplate[day.templateKey] ?? [];
      list.push(railRevisionToEditable(revision));
      railsByTemplate[day.templateKey] = list;
    }
  }
  for (const key of Object.keys(railsByTemplate)) {
    railsByTemplate[key]!.sort((a, b) => a.startMin - b.startMin);
  }

  // v0.4: a slot can hold multiple tasks (ERD §4.1 "Slot ↔ Task
  // one-to-many"). Build a per-key task array; each task carries its
  // own status so CycleCell can render multi-pill stacks.
  const slotsByKey = new Map<string, CycleSlot>();
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'deleted') continue;
    if (!task.slot) continue;
    const { date, railId } = task.slot;
    if (date < startIso || date > endIso) continue;
    const key = `${railId}|${date}`;
    const subItems = task.subItems ?? [];
    // Task.status ∈ pending / in-progress / done / deferred / archived / deleted.
    // Map anything pre-terminal into `pending` for slot-pill rendering.
    let state: SlotTaskState;
    if (task.status === 'done') state = 'done';
    else if (task.status === 'deferred') state = 'deferred';
    else if (task.status === 'archived') state = 'archived';
    else state = 'pending';
    const trimmedNote = task.note?.trim() ?? '';
    const summary: SlotTaskSummary = {
      taskId: task.id,
      title: task.title,
      state,
      isAutoTask: task.source === 'auto-habit',
      hasNote: trimmedNote.length > 0,
      ...(trimmedNote.length > 0 && {
        note: trimmedNote,
        noteSnippet:
          trimmedNote.length > 120 ? `${trimmedNote.slice(0, 120)}…` : trimmedNote,
      }),
      subItemsDone: subItems.filter((s) => s.done).length,
      subItemsTotal: subItems.length,
      ...(subItems.length > 0 && { subItems }),
      ...(task.milestonePercent != null && {
        milestonePercent: task.milestonePercent,
      }),
      ...(task.priority != null && { priority: task.priority }),
      ...(task.slotOrder != null && { slotOrder: task.slotOrder }),
    };
    const existing = slotsByKey.get(key);
    if (existing) {
      existing.tasks.push(summary);
    } else {
      slotsByKey.set(key, { railId, date, tasks: [summary] });
    }
  }
  // Sort each slot's tasks by (state rank → priority rank → stable
  // insertion). State rank keeps pending items at the top where the
  // user will act on them; priority rank (P0 → P1 → P2 → unset)
  // surfaces the item the user flagged as most important first within
  // each state bucket (ERD §5.5 "lightweight hint" clause).
  const STATE_RANK: Record<SlotTaskState, number> = {
    pending: 0,
    done: 1,
    deferred: 2,
    archived: 3,
  };
  const priorityRank = (p: SlotTaskSummary['priority']): number => {
    if (p === 'P0') return 0;
    if (p === 'P1') return 1;
    if (p === 'P2') return 2;
    return 3;
  };
  for (const slot of slotsByKey.values()) {
    // §4.1 v0.4.4 · if any task in the slot carries a user-defined
    // `slotOrder`, the whole slot sorts by `slotOrder` asc (tasks
    // without one fall to the bottom) — the user has explicitly
    // arranged this slot, and we don't second-guess. Otherwise fall
    // back to the derived state→priority sort.
    const hasUserOrder = slot.tasks.some((t) => t.slotOrder != null);
    if (hasUserOrder) {
      slot.tasks.sort((a, b) => {
        const ao = a.slotOrder ?? Number.POSITIVE_INFINITY;
        const bo = b.slotOrder ?? Number.POSITIVE_INFINITY;
        return ao - bo;
      });
    } else {
      slot.tasks.sort((a, b) => {
        const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
        if (byState !== 0) return byState;
        return priorityRank(a.priority) - priorityRank(b.priority);
      });
    }
  }

  const slots: CycleSlot[] = [...slotsByKey.values()];

  // topLines: cheapest bar for the summary strip — pick three Projects
  // (kind='project') by task count in the current cycle window. Good
  // enough for v0.2; v0.3 tightens.
  const topLines = computeTopLines(state, startIso, endIso);

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

function railRevisionToEditable(rev: RailRevision): EditableRail {
  const endMin = rev.startMinutes + rev.durationMinutes;
  return {
    id: rev.railId,
    name: rev.name,
    subtitle: rev.subtitle,
    startMin: rev.startMinutes,
    endMin,
    color: rev.color as RailColor,
    showInCheckin: rev.showInCheckin,
  };
}

function computeTopLines(
  state: Pick<DayRailState, 'tasks' | 'templates' | 'rails' | 'lines'>,
  startIso: string,
  endIso: string,
): SampleCycle['topLines'] {
  // Tasks scheduled inside the cycle window, grouped by lineId.
  const byLine = new Map<string, { done: number; planned: number }>();
  for (const t of Object.values(state.tasks)) {
    if (t.status === 'archived' || t.status === 'deleted') continue;
    if (!t.slot) continue;
    if (t.slot.date < startIso || t.slot.date > endIso) continue;
    const b = byLine.get(t.lineId) ?? { done: 0, planned: 0 };
    if (t.status === 'done') b.done++;
    else b.planned++;
    byLine.set(t.lineId, b);
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
 *  behind a small confirmation + batch `task.unscheduled`.
 *
 *  Phase 3: resolves "rails belonging to nextTemplateKey on this date"
 *  via the revision tables, so an override on a past date checks
 *  against the rail roster as it existed on that date. */
export function findOrphanTasksForTemplateSwitch(
  state: Pick<
    DayRailState,
    'tasks' | 'rails' | 'railRevisions' | 'railTombstones'
  >,
  date: string,
  nextTemplateKey: string,
): Task[] {
  const nextRailIds = new Set<string>();
  for (const { railId, revision } of railsActiveOn(state, date)) {
    if (revision.templateKey === nextTemplateKey) nextRailIds.add(railId);
  }
  return Object.values(state.tasks).filter((t) => {
    if (t.status === 'archived' || t.status === 'deleted') return false;
    if (!t.slot) return false;
    if (t.slot.date !== date) return false;
    return !nextRailIds.has(t.slot.railId);
  });
}

/** Tasks that should surface in the Cycle View's Backlog drawer as
 *  drag sources. Covers two populations:
 *  - Pending / in-progress tasks with no slot and no active Ad-hoc
 *    (classic "to schedule" pile).
 *  - Deferred tasks (regardless of whether they still carry an old
 *    slot) — the user's "not now" pile, ready to be committed to a
 *    new day. When dropped on a Cycle cell, scheduleTaskToRail
 *    flips deferred → pending automatically.
 *
 *  Terminal states (done / archived / deleted) are excluded. Pending
 *  tasks already bound to a slot are also excluded — they're visible
 *  in the Cycle grid itself, including them here would duplicate. */
export function selectBacklogTasks(
  state: Pick<DayRailState, 'tasks' | 'adhocEvents'>,
): Task[] {
  const adhocTaskIds = new Set<string>();
  for (const a of Object.values(state.adhocEvents)) {
    if (a.status === 'active' && a.taskId) adhocTaskIds.add(a.taskId);
  }
  const priorityRank = (p: Task['priority']): number => {
    if (p === 'P0') return 0;
    if (p === 'P1') return 1;
    if (p === 'P2') return 2;
    return 3;
  };
  return Object.values(state.tasks)
    .filter((t) => {
      if (t.status === 'deferred') return true;
      if (t.status !== 'pending' && t.status !== 'in-progress') return false;
      return !t.slot && !adhocTaskIds.has(t.id);
    })
    .sort((a, b) => {
      // Deferred first (they've been waiting longer for a decision),
      // then priority rank (P0 → unset), then user-set order.
      const aDef = a.status === 'deferred' ? 0 : 1;
      const bDef = b.status === 'deferred' ? 0 : 1;
      if (aDef !== bDef) return aDef - bDef;
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return a.order - b.order;
    });
}
