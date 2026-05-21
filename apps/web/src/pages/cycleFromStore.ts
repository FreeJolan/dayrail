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
  TaskOccurrence,
} from '@dayrail/core';
import {
  isOccurrenceManaged,
  railsActiveOn,
  resolveTemplateForDate,
  selectOccurrencesForTask,
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
 *    Sat / Sun → `restday` / first builtIn / first Template
 *
 *  v0.8.1: type widened to require `userDayNotes` + `userProfile` so
 *  the resolver can read `calendarRuleOrder` for user-controlled
 *  priority and `enabledHolidayRegions` / `userDayNotes` for the
 *  `external-event` rule kind. Callers that previously passed only
 *  the four template/calendar fields silently lost the v0.8.1
 *  ordering — without these fields, `state.userProfile` was
 *  undefined and the resolver fell back to legacy numeric priority. */
export function pickTemplateForDate(
  state: Pick<
    DayRailState,
    | 'templates'
    | 'calendarRules'
    | 'calendarRuleRevisions'
    | 'calendarRuleTombstones'
    | 'userDayNotes'
    | 'userProfile'
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
  /** Tasks scheduled to a (date, railId) where the railId is NOT
   *  active on that date under that day's templateKey — e.g. the rail
   *  was tombstoned, removed from the template, or the day's template
   *  flipped to one that doesn't include it. CycleSection surfaces
   *  these in an "Off-rail" row so a scheduled task is never silently
   *  invisible; the user can drag the pill back onto any rail to
   *  recover it. */
  offRailByDate: Record<string, SlotTaskSummary[]>;
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
    | 'taskOccurrences'
    | 'lines'
    | 'calendarRules'
    | 'calendarRuleRevisions'
    | 'calendarRuleTombstones'
    | 'railRevisions'
    | 'railTombstones'
    | 'userDayNotes'
    | 'userProfile'
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

  // Per-day set of railIds that are active on that date AND belong to
  // the day's templateKey. Used below to split scheduled tasks into
  // on-rail (rendered in the rail row) vs off-rail (rendered in the
  // section's Off-rail row, see DerivedCycle.offRailByDate).
  const railIdsByDate = new Map<string, Set<string>>();
  for (const day of days) {
    const set = new Set<string>();
    for (const { railId, revision } of railsActiveOn(state, day.date)) {
      if (revision.templateKey === day.templateKey) set.add(railId);
    }
    railIdsByDate.set(day.date, set);
  }

  // v0.4: a slot can hold multiple tasks (ERD §4.1 "Slot ↔ Task
  // one-to-many"). Build a per-key task array; each task carries its
  // own status so CycleCell can render multi-pill stacks. Tasks
  // pointing at a rail that isn't active on their day spill into
  // `offRailMap` instead — never silently dropped.
  const slotsByKey = new Map<string, CycleSlot>();
  const offRailMap = new Map<string, SlotTaskSummary[]>();
  const placeSummary = (
    date: string,
    railId: string,
    summary: SlotTaskSummary,
  ) => {
    if (date < startIso || date > endIso) return;
    const railOnDay = railIdsByDate.get(date)?.has(railId) ?? false;
    if (!railOnDay) {
      const arr = offRailMap.get(date) ?? [];
      arr.push(summary);
      offRailMap.set(date, arr);
      return;
    }
    const key = `${railId}|${date}`;
    const existing = slotsByKey.get(key);
    if (existing) existing.tasks.push(summary);
    else slotsByKey.set(key, { railId, date, tasks: [summary] });
  };

  for (const task of Object.values(state.tasks)) {
    if (task.status === 'deleted') continue;
    const occs = selectOccurrencesForTask(state, task.id);
    if (isOccurrenceManaged(occs)) {
      // ERD §10.6 v0.11 — occurrence-managed Task. One pill per
      // slot-bearing occurrence; the legacy `task.slot` is ignored on
      // this branch.
      for (const occ of occs) {
        if (!occ.slot) continue;
        if (occ.status === 'archived') continue;
        const summary = buildOccurrenceSummary(task, occ);
        placeSummary(occ.slot.date, occ.slot.railId, summary);
      }
      continue;
    }
    // Legacy / pre-adoption path — single pill at task.slot.
    if (!task.slot) continue;
    const summary = buildSlotTaskSummary(task);
    placeSummary(task.slot.date, task.slot.railId, summary);
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
  const sortByStateThenPriority = (a: SlotTaskSummary, b: SlotTaskSummary) => {
    const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (byState !== 0) return byState;
    return priorityRank(a.priority) - priorityRank(b.priority);
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
      slot.tasks.sort(sortByStateThenPriority);
    }
  }
  // Off-rail tasks have no meaningful in-bucket ordering — slotOrder
  // was relative to a slot they're no longer in. Sort by the same
  // state→priority rank used for fresh slots.
  for (const arr of offRailMap.values()) arr.sort(sortByStateThenPriority);

  const slots: CycleSlot[] = [...slotsByKey.values()];
  const offRailByDate: Record<string, SlotTaskSummary[]> = {};
  for (const [date, arr] of offRailMap) offRailByDate[date] = arr;

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
  return { cycle, railsByTemplate, offRailByDate };
}

function buildSlotTaskSummary(task: Task): SlotTaskSummary {
  const subItems = task.subItems ?? [];
  let state: SlotTaskState;
  if (task.status === 'done') state = 'done';
  else if (task.status === 'deferred') state = 'deferred';
  else if (task.status === 'archived') state = 'archived';
  else state = 'pending';
  const trimmedNote = task.note?.trim() ?? '';
  return {
    rowId: task.id,
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
}

/** ERD §10.6 v0.11 — slot-pill summary for a TaskOccurrence. Title
 *  fallback chain: `occurrence.label` → `task.title`. Percent reads
 *  the occurrence's milestone marker (falls back to the task-level
 *  milestonePercent). State maps from occurrence.status (no `deferred`
 *  state on occurrences; the host Task carries that semantics). */
function buildOccurrenceSummary(
  task: Task,
  occ: TaskOccurrence,
): SlotTaskSummary {
  // ERD §10.6 — status drives the pill state; percent is a marker
  // only. A pending occurrence with percent=100 is "the 100% milestone
  // marker, not yet checked off"; it MUST render as pending.
  let state: SlotTaskState;
  if (occ.status === 'done') state = 'done';
  else if (occ.status === 'archived') state = 'archived';
  else state = 'pending';
  // ERD §10.6 v0.12.2 — occurrence pills show ONLY their own note,
  // never falling back to the parent task.note.
  const trimmedNote = occ.note?.trim() ?? '';
  const labelTrimmed = occ.label?.trim() ?? '';
  const hasDistinctLabel =
    labelTrimmed.length > 0 && labelTrimmed !== task.title;
  const title = hasDistinctLabel ? labelTrimmed : task.title;
  // parentTitle only when the occurrence label is meaningfully different
  // from the parent Task title — otherwise a redundant subtitle just
  // duplicates the main line and adds noise.
  const parentTitle = hasDistinctLabel ? task.title : undefined;
  const milestone = occ.percent ?? task.milestonePercent;
  return {
    rowId: occ.id,
    taskId: task.id,
    occurrenceId: occ.id,
    title,
    ...(parentTitle !== undefined && { parentTitle }),
    state,
    isAutoTask: task.source === 'auto-habit',
    hasNote: trimmedNote.length > 0,
    ...(trimmedNote.length > 0 && {
      note: trimmedNote,
      noteSnippet:
        trimmedNote.length > 120 ? `${trimmedNote.slice(0, 120)}…` : trimmedNote,
    }),
    // Occurrence pills don't carry the legacy "subItems N/M" badge —
    // the occurrence IS the unit being shown; aggregate counts belong
    // to the Task detail drawer.
    subItemsDone: 0,
    subItemsTotal: 0,
    ...(milestone != null && { milestonePercent: milestone }),
    ...(task.priority != null && { priority: task.priority }),
    // Occurrences use task-relative `order`; cycle-slot ordering for
    // occurrence pills follows that order rather than `slotOrder`.
  };
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
 *  in the Cycle grid itself, including them here would duplicate.
 *
 *  ERD §10.6 v0.11 — for occurrence-managed Tasks the row unit is the
 *  occurrence: the Backlog shows ONE row per pending unscheduled
 *  occurrence, never the parent Task itself (the task is "split into
 *  pieces" and the only items left to drag onto a slot are the
 *  unscheduled pieces). Pure-checklist (pre-adoption) tasks behave
 *  exactly like before — one row per Task. See `selectBacklogItems`. */

/** ERD §10.6 v0.11 — discriminated union surfaced by the Backlog. */
export type BacklogItem =
  | { kind: 'task'; task: Task }
  | { kind: 'occurrence'; task: Task; occurrence: TaskOccurrence };

/** Stable identity for a backlog row — used as React key, dnd id, and
 *  the rowId the App-level drag handler sees. Matches the same
 *  `rowId` convention as cycle-pill rows (occurrence id when present,
 *  else task id), so App.tsx's existing taskOccurrences-lookup branch
 *  routes the drop correctly without further wiring. */
export function backlogItemId(item: BacklogItem): string {
  return item.kind === 'occurrence' ? item.occurrence.id : item.task.id;
}

/** Title fallback chain for a backlog row. */
export function backlogItemTitle(item: BacklogItem): string {
  if (item.kind === 'occurrence') {
    const lbl = item.occurrence.label?.trim();
    if (lbl && lbl.length > 0) return lbl;
  }
  return item.task.title;
}

export function selectBacklogItems(
  state: Pick<DayRailState, 'tasks' | 'taskOccurrences' | 'adhocEvents'>,
): BacklogItem[] {
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
  const items: BacklogItem[] = [];
  for (const t of Object.values(state.tasks)) {
    if (t.status === 'deleted' || t.status === 'archived' || t.status === 'done') {
      continue;
    }
    const occs = selectOccurrencesForTask(state, t.id);
    if (isOccurrenceManaged(occs)) {
      // Occurrence-managed: one row per pending unscheduled occurrence.
      // Parent Task itself never surfaces (it's "fully split"); even if
      // task.status === 'deferred' the user has migrated to occurrence
      // mode, so we don't double-up with a parent row.
      for (const occ of occs) {
        if (occ.status !== 'pending') continue;
        if (occ.slot) continue;
        items.push({ kind: 'occurrence', task: t, occurrence: occ });
      }
      continue;
    }
    // Pre-adoption / legacy path — single row per Task.
    if (t.status === 'deferred') {
      items.push({ kind: 'task', task: t });
      continue;
    }
    if (t.status !== 'pending' && t.status !== 'in-progress') continue;
    if (t.slot) continue;
    if (adhocTaskIds.has(t.id)) continue;
    items.push({ kind: 'task', task: t });
  }
  items.sort((a, b) => {
    // Deferred first (they've been waiting longer for a decision),
    // then priority rank (P0 → unset), then user-set order.
    const aDef = a.kind === 'task' && a.task.status === 'deferred' ? 0 : 1;
    const bDef = b.kind === 'task' && b.task.status === 'deferred' ? 0 : 1;
    if (aDef !== bDef) return aDef - bDef;
    const pr = priorityRank(a.task.priority) - priorityRank(b.task.priority);
    if (pr !== 0) return pr;
    // Within same task, occurrence rows sort by occurrence.order then
    // by id for stability; cross-task ties break on task.order.
    if (
      a.kind === 'occurrence' &&
      b.kind === 'occurrence' &&
      a.task.id === b.task.id
    ) {
      const ao = a.occurrence.order ?? Number.POSITIVE_INFINITY;
      const bo = b.occurrence.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.occurrence.id.localeCompare(b.occurrence.id);
    }
    return a.task.order - b.task.order;
  });
  return items;
}
