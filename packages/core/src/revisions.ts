// ERD §10.5 · effective-from revision selectors.
//
// Reads against the four versioned entity types (Rail, Template,
// CalendarRule, HabitBinding) flow through the helpers in this file.
// Each one picks the latest revision with `effectiveFrom <= date` and
// respects the identity-shell `tombstone`. Past dates land on prior
// revisions automatically; future dates land on the latest revision in
// effect; dates before the entity's first revision (or on/after a
// tombstone) return `undefined`.
//
// Phase 1 ships these alongside the legacy current-state reads. Phase 2
// switches the read paths to use them; Phase 3 will narrow the legacy
// `Rail` / `Template` / `CalendarRule` / `HabitBinding` shells to
// identity-only fields once nothing reads from them directly.

import type { DayRailState } from './store';
import type {
  CalendarRuleRevision,
  EffectiveDate,
  HabitBindingRevision,
  Rail,
  RailRevision,
  TemplateKey,
  TemplateRevision,
  Tombstone,
} from './types';

// ------------------------------------------------------------------
// Internal helpers.
// ------------------------------------------------------------------

/** Pick the latest revision in `revs` whose `effectiveFrom <= date`.
 *  Assumes `revs` is sorted ASC by `effectiveFrom` (the reducer
 *  enforces this on insert). Returns `undefined` if no revision is
 *  active at `date`. */
function pickActive<R extends { effectiveFrom: EffectiveDate }>(
  revs: R[] | undefined,
  date: EffectiveDate,
): R | undefined {
  if (!revs || revs.length === 0) return undefined;
  let pick: R | undefined;
  for (const r of revs) {
    if (r.effectiveFrom <= date) pick = r;
    else break;
  }
  return pick;
}

/** Returns true when `date` is on or after the entity's tombstone —
 *  i.e. the entity does not exist on `date`. */
function isTombstoned(
  tombstone: Tombstone | undefined,
  date: EffectiveDate,
): boolean {
  return tombstone != null && date >= tombstone.effectiveFrom;
}

// ------------------------------------------------------------------
// Public selectors.
// ------------------------------------------------------------------

type RailReadState = Pick<DayRailState, 'railRevisions' | 'railTombstones'>;
type TemplateReadState = Pick<
  DayRailState,
  'templateRevisions' | 'templateTombstones'
>;
type CalendarRuleReadState = Pick<
  DayRailState,
  'calendarRuleRevisions' | 'calendarRuleTombstones'
>;
type HabitBindingReadState = Pick<
  DayRailState,
  'habitBindingRevisions' | 'habitBindingTombstones'
>;

/** Resolve a rail's effective revision on `date`. Returns `undefined`
 *  when the rail has no revision active on that date OR when it has
 *  been tombstoned on/before `date`. */
export function railAtDate(
  state: RailReadState,
  railId: string,
  date: EffectiveDate,
): RailRevision | undefined {
  if (isTombstoned(state.railTombstones[railId], date)) return undefined;
  return pickActive(state.railRevisions[railId], date);
}

/** Resolve a template's effective revision on `date`. */
export function templateAtDate(
  state: TemplateReadState,
  key: TemplateKey,
  date: EffectiveDate,
): TemplateRevision | undefined {
  if (isTombstoned(state.templateTombstones[key], date)) return undefined;
  return pickActive(state.templateRevisions[key], date);
}

/** Resolve a calendar rule's effective revision on `date`. The rule's
 *  identity (`kind`, `id`) lives on the shell; this selector returns
 *  the date-effective `value` + `priority`. */
export function calendarRuleAtDate(
  state: CalendarRuleReadState,
  ruleId: string,
  date: EffectiveDate,
): CalendarRuleRevision | undefined {
  if (isTombstoned(state.calendarRuleTombstones[ruleId], date)) return undefined;
  return pickActive(state.calendarRuleRevisions[ruleId], date);
}

/** Resolve a habit binding's effective revision on `date`. */
export function habitBindingAtDate(
  state: HabitBindingReadState,
  bindingId: string,
  date: EffectiveDate,
): HabitBindingRevision | undefined {
  if (isTombstoned(state.habitBindingTombstones[bindingId], date)) return undefined;
  return pickActive(state.habitBindingRevisions[bindingId], date);
}

/** Every rail with an active revision on `date`. Result entries pair
 *  the rail's id with its date-effective revision. Useful for "list all
 *  rails of date D" — past Cycle View columns, future plans, etc. */
export function railsActiveOn(
  state: RailReadState,
  date: EffectiveDate,
): Array<{ railId: string; revision: RailRevision }> {
  const out: Array<{ railId: string; revision: RailRevision }> = [];
  for (const railId of Object.keys(state.railRevisions)) {
    const rev = railAtDate(state, railId, date);
    if (rev) out.push({ railId, revision: rev });
  }
  return out;
}

/** Every calendar rule with an active revision on `date`. Caller is
 *  responsible for the priority-desc sort when resolving a date's
 *  template (priority comes from the revision payload). */
export function calendarRuleRevisionsActiveOn(
  state: CalendarRuleReadState,
  date: EffectiveDate,
): Array<{ ruleId: string; revision: CalendarRuleRevision }> {
  const out: Array<{ ruleId: string; revision: CalendarRuleRevision }> = [];
  for (const ruleId of Object.keys(state.calendarRuleRevisions)) {
    const rev = calendarRuleAtDate(state, ruleId, date);
    if (rev) out.push({ ruleId, revision: rev });
  }
  return out;
}

/** Project a `RailRevision` back into the legacy `Rail` shape so existing
 *  selectors and UI code that consume `Rail` keep working without
 *  caring whether the data came from the legacy mirror or the revision
 *  table. The revision carries every field the legacy `Rail` shape has
 *  (plus a few of its own — `effectiveFrom`, `authoredAt`, etc.). */
export function railFromRevision(rev: RailRevision): Rail {
  return {
    id: rev.railId,
    templateKey: rev.templateKey,
    name: rev.name,
    ...(rev.subtitle != null && { subtitle: rev.subtitle }),
    startMinutes: rev.startMinutes,
    durationMinutes: rev.durationMinutes,
    color: rev.color,
    ...(rev.icon != null && { icon: rev.icon }),
    showInCheckin: rev.showInCheckin,
  };
}

/** Every habit binding with an active revision on `date`. */
export function habitBindingsActiveOn(
  state: HabitBindingReadState,
  date: EffectiveDate,
): Array<{ bindingId: string; revision: HabitBindingRevision }> {
  const out: Array<{ bindingId: string; revision: HabitBindingRevision }> = [];
  for (const bindingId of Object.keys(state.habitBindingRevisions)) {
    const rev = habitBindingAtDate(state, bindingId, date);
    if (rev) out.push({ bindingId, revision: rev });
  }
  return out;
}
