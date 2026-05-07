// Domain types mirrored from ERD §10, used by reducers + Zustand
// stores. Separate from @dayrail/db's column-level types: the DB sees
// row shapes (snake_case, JSON-as-string); this module sees the
// rich domain shapes that UI components consume directly.

export type RailColor =
  | 'sand'
  | 'sage'
  | 'slate'
  | 'brown'
  | 'amber'
  | 'teal'
  | 'pink'
  | 'grass'
  | 'indigo'
  | 'plum';

export type TemplateKey = string;

/** ERD §10.5. ISO YYYY-MM-DD. The local-day this revision starts
 *  applying. Sentinel `'1970-01-01'` is the migration sentinel meaning
 *  "in effect from before any DayRail data" — guarantees every
 *  historical date hits the migrated revision. */
export type EffectiveDate = string;

/** ERD §10.5. The migration sentinel; reads matching against an entity
 *  in its first lifetime always hit a revision with this `effectiveFrom`. */
export const REVISION_SENTINEL_DATE: EffectiveDate = '1970-01-01';

/** ERD §10.5. Marker on an entity's identity shell that the entity is
 *  retired from `effectiveFrom` onward. Past dates still resolve to the
 *  last revision before `effectiveFrom`. Cleared on resurrect. */
export interface Tombstone {
  effectiveFrom: EffectiveDate;
  /** Wall clock when the tombstone was authored (epoch ms). */
  at: number;
  sessionId?: string;
}

export interface Template {
  key: TemplateKey;
  name: string;
  color?: RailColor;
  isDefault: boolean;
}

/** ERD §10.5. Versioned snapshot of a Template's mutable fields. The
 *  identity shell `Template` keeps stable fields (`key` / `isDefault`);
 *  `name` / `color` move here so editing them produces a new revision
 *  rather than overwriting in place. */
export interface TemplateRevision {
  id: string;
  templateKey: TemplateKey;
  effectiveFrom: EffectiveDate;
  name: string;
  color?: RailColor;
  authoredAt: number;
  sessionId?: string;
}

export interface Rail {
  id: string;
  templateKey: TemplateKey;
  name: string;
  subtitle?: string;
  startMinutes: number;
  durationMinutes: number;
  color: RailColor;
  icon?: string;
  showInCheckin: boolean;
  // v0.4 removed `recurrence`: the template's CalendarRule decides
  // which dates belong to the rail's day-shape, and HabitBinding
  // .weekdays narrows per-habit. A rail-level weekday filter was the
  // third overlapping layer and only produced traps (weekdays default
  // dropped into a Restday template → empty intersection → no tasks).
}

/** ERD §10.5. Versioned snapshot of a Rail's mutable fields. Phase 1
 *  keeps the legacy `Rail` type intact alongside this so existing reads
 *  continue to compile; once read paths migrate to `railAtDate`, the
 *  `Rail` shell can be slimmed down to identity-only fields. */
export interface RailRevision {
  id: string;
  railId: string;
  effectiveFrom: EffectiveDate;
  templateKey: TemplateKey;
  name: string;
  subtitle?: string;
  startMinutes: number;
  durationMinutes: number;
  color: RailColor;
  icon?: string;
  showInCheckin: boolean;
  authoredAt: number;
  sessionId?: string;
}

export interface Cycle {
  id: string;
  startDate: string;
  endDate: string;
}

export interface CycleDay {
  cycleId: string;
  date: string;
  templateKey: TemplateKey;
  overridden: boolean;
}

export interface Slot {
  cycleId: string;
  date: string;
  railId: string;
  /** Free-text label for a slot that has no Task attached (§5.3 "quick
   *  text" slot form). Stored in the `task_name` column for historical
   *  reasons; the field name is `label` post-v0.2.1 to disambiguate
   *  from the Task union.  */
  label?: string;
  taskIds: string[];
}

/** §5.2 / §5.5.6. The Shift vocabulary:
 *   - `defer`      — paired with status → deferred (§5.6 check-in /
 *                    §5.7 Pending). User pressed "later".
 *   - `archive`    — paired with status → archived.
 *   - `reschedule` — emitted automatically when the user moves an
 *                    **already-overdue** Task to **a different day**
 *                    (drag, SchedulePopover, TaskDetailDrawer — any
 *                    path that ends in `scheduleTaskToRail` /
 *                    `scheduleTaskFreeTime`). Same-day drag and
 *                    rescheduling a still-future task do NOT emit.
 *                    v0.4.1. See §5.5.6 for trigger rules + Review
 *                    consumption.
 *  - unschedule    : auto-emitted when the user CLEARS the schedule of
 *                    an already-overdue Task (the Schedule popover's
 *                    `取消排期` button, or any other path ending in
 *                    `unscheduleTask`). Same overdue gate as reschedule
 *                    minus the cross-day requirement. v0.4.2. See
 *                    §5.5.6. */
export type ShiftType = 'defer' | 'archive' | 'reschedule' | 'unschedule';

/** Payload shape when `Shift.type === 'reschedule'`. Captured so
 *  Review can annotate the `(fromRailId, fromDate)` heatmap cell
 *  even after `Task.slot` has moved. `fromAdhocId` / `toAdhocId`
 *  are filled when the prior / new binding is a free-time Ad-hoc
 *  rather than a Rail slot. */
export interface ReschedulePayload {
  fromDate: string;
  fromRailId?: string;
  fromAdhocId?: string;
  toDate: string;
  toRailId?: string;
  toAdhocId?: string;
}

/** Payload shape when `Shift.type === 'unschedule'`. Same `from*`
 *  fields as `ReschedulePayload` so Review's heatmap-cell upgrade
 *  works uniformly; no `to*` since the task is headed nowhere. */
export interface UnschedulePayload {
  fromDate: string;
  fromRailId?: string;
  fromAdhocId?: string;
}

/** An audit record attached to a Task occurrence when the user
 *  deferred / archived / rescheduled / unscheduled it. Multiple tags +
 *  optional reason. v0.4: anchored to `taskId` (was `railInstanceId`
 *  before the RailInstance entity removal). */
export interface Shift {
  id: string;
  taskId: string;
  type: ShiftType;
  at: string;
  /** Shape depends on `type`. `reschedule` → `ReschedulePayload`;
   *  `unschedule` → `UnschedulePayload`; `defer` / `archive` are
   *  currently free-form (empty object in practice). */
  payload: Record<string, unknown>;
  tags?: string[];
  /** Not captured in v0.2 — the Reason toast only writes tags.
   *  Free-text reason is deferred to the v0.3 Pending detail page. */
  reason?: string;
}

/** §5.6 three-action check-in vocabulary. Replaces the v0.2-early
 *  `'skip' | 'shift' | 'ignore'` — those were semantically overlapping. */
export type SignalResponse = 'done' | 'defer' | 'archive';

/** Audit log of a §5.6 / §5.7 button press. The status update itself
 *  lives on `Task.status`; this event exists so the user can trace
 *  "I pressed Later at 14:32 from the check-in strip". */
export interface Signal {
  id: string;
  taskId: string;
  actedAt: string;
  response: SignalResponse;
  surface: 'check-in-strip' | 'pending-queue';
}

/** `Line` is an internal container type. The UI never shows the word
 *  "Line" — the user sees Project / Habit / Tag based on `kind`.
 *  Kept as an umbrella name in code because all three variants share
 *  id / name / color / status / plannedStart / plannedEnd.  */
export interface Line {
  id: string;
  name: string;
  color?: RailColor;
  /** `archived` is a user-intentional terminal (restorable via un-archive).
   *  `deleted` is a soft delete (visible in Trash; purging is a separate
   *  explicit step). */
  status: 'active' | 'archived' | 'deleted';
  kind: 'project' | 'habit' | 'group';
  /** Built-in Lines cannot be renamed / recolored / deleted. Reserved for
   *  the Inbox singleton (`id === 'line-inbox'`). */
  isDefault?: boolean;
  plannedStart?: string;
  plannedEnd?: string;
  /** Long-form free text. Used by the v0.4 habit detail page for
   *  capturing goals / context ("why I started", "target event") —
   *  available on any Line kind though, no enforcement. */
  note?: string;
  createdAt: number;
  archivedAt?: number;
  deletedAt?: number;
}

/** The system-singleton Inbox Line id. All Tasks created without a
 *  user-picked Project default to this Line. */
export const INBOX_LINE_ID = 'line-inbox';

/** v0.4: habit ↔ rail relationship. Each binding tells the auto-task
 *  materializer "this habit has an occurrence on this rail". Multiple
 *  bindings per habit are supported (workday 06:30 + weekend 07:30 =
 *  two bindings). `weekdays` is an optional per-binding weekday filter
 *  — undefined = fire on every day this rail's template is active. */
export interface HabitBinding {
  id: string;
  habitId: string;
  railId: string;
  /** 0 = Sunday … 6 = Saturday. Undefined = no extra weekday filter
   *  (every day the rail fires also materializes an auto-task). */
  weekdays?: number[];
  /** epoch ms. */
  createdAt: number;
}

/** ERD §10.5. Versioned snapshot of a HabitBinding's mutable fields.
 *  `habitId` / `railId` move here so the same binding identity can
 *  swap which habit or rail it points at across a cutover date. */
export interface HabitBindingRevision {
  id: string;
  bindingId: string;
  effectiveFrom: EffectiveDate;
  habitId: string;
  railId: string;
  weekdays?: number[];
  authoredAt: number;
  sessionId?: string;
}

/** A time-segment label on a `kind='habit'` Line. v0.3.3 scope:
 *  entirely user-managed — no preset enum, no auto-advance, no
 *  streak / completion-rate derivation. "Enabled" state for the
 *  parent habit is derived from the count of associated
 *  `HabitPhase` records (≥ 1 = enabled). */
export interface HabitPhase {
  id: string;
  lineId: string;
  name: string;
  description?: string;
  /** YYYY-MM-DD. The next phase's `startDate` implicitly closes
   *  this one; there is no explicit `endDate`. */
  startDate: string;
  createdAt: number;
}

/** ERD §4.1 / §10.4. One hand-written Markdown blob per calendar
 *  date — the user's free-form journal / retrospection / mood note.
 *  Keyed by `date` (YYYY-MM-DD); at most one row per day. Empty content
 *  means "not written" — the materializer drops the row and the event
 *  log carries `reflection.cleared`. Does not feed the heatmap, Project
 *  progress, or any scheduling side effect. */
export interface DailyReflection {
  /** YYYY-MM-DD, primary key (natural day per `Track.tz`). */
  date: string;
  /** Raw Markdown source — rendered as-is, no transform beyond sanitize. */
  content: string;
  /** Wall clock of the latest event that wrote this row (epoch ms). */
  updatedAt: number;
  /** ERD §6.6.2 v0.8.2 — single-field LWW cache of the most recent
   *  Day-reflection AI output. Retap overwrites; no history array.
   *  Hangs off the reflection so it disappears when the reflection is
   *  cleared (the reflection is "the day's user free-text" entity; the
   *  AI observation is a derived reading of it). */
  lastAiObservation?: AiObservation;
}

/** A one-off time block that overlays the Track. Either ad-hoc input
 *  (user scheduled "dentist appt" for tomorrow 14:30-16:00) or the
 *  backing record for §5.5.2 Mode-B task scheduling (`taskId` refers
 *  back to the Task). */
export interface AdhocEvent {
  id: string;
  date: string; // YYYY-MM-DD
  startMinutes: number;
  durationMinutes: number;
  name: string;
  color?: RailColor;
  /** Optional grouping — drives the Line-name badge + default color. */
  lineId?: string;
  /** Set when this Ad-hoc backs a free-time-scheduled Task (§5.5.2 Mode B).
   *  Unscheduling the Task soft-deletes this Ad-hoc. */
  taskId?: string;
  status: 'active' | 'deleted';
  deletedAt?: string;
}

/** Persistent Cycle record (ERD §5.3 / §9.7). v0.3.2 scope: a custom
 *  label attached to a specific 7-day Monday-anchored Cycle so users
 *  can name stretches like "考研冲刺周" / "DayRail v0.3 scope". The
 *  `endDate` field is reserved for v0.4 custom-length Cycles; for now
 *  it's always `startDate + 6 days`. */
export interface Cycle {
  id: string;
  /** Monday-anchored ISO date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive end date. v0.3.2 always startDate+6; v0.4 custom. */
  endDate: string;
  label?: string;
  createdAt: number;
  /** ERD §6.6.2 v0.8.2 — single-field LWW cache of the most recent
   *  Cycle-reflection AI output. Retap overwrites directly; no history
   *  array. Hangs off the cycle so it disappears with the cycle. */
  lastAiObservation?: AiObservation;
}

/** ERD §6.6.2 v0.8.2 — shape of the cached AI output for both Day
 *  (`DailyReflection.lastAiObservation`) and Cycle
 *  (`Cycle.lastAiObservation`). The `json` payload conforms to the
 *  citation-bound schema below. */
export interface AiObservation {
  /** Wall-clock of the call's completion (epoch ms). */
  generatedAt: number;
  /** Model name selected at call time — kept for provenance / debugging. */
  model: string;
  /** Parsed JSON output. Shape is the v0.8.2 citation-bound schema;
   *  stored as a plain object for flexibility (the renderer is forgiving). */
  json: AiObservationJson;
}

/** ERD §6.6.2 v0.8.2 citation-bound output schema.
 *
 *  Designed to defend against AI hallucination: every observation
 *  comes paired with a `from_data` quote that the user (and the
 *  client) can verify against the prompt input. `questions_to_sit_with`
 *  replaces the v0.8.2-draft "suggestions" field — open-ended
 *  questions stay aligned with the §6.2 "observe, don't judge /
 *  suggest, don't command" tone rule. */
export interface AiObservationJson {
  /** 1-line core takeaway. The thing worth saying if you only get to
   *  say one thing. */
  headline: string;
  /** 1-5 grounded observations, each citing a specific data point
   *  from the prompt input. Empty array is allowed if the data
   *  genuinely doesn't support any observation. */
  observations: AiObservationItem[];
  /** 0-3 open-ended questions to sit with — never imperative. */
  questions_to_sit_with: string[];
}

/** ERD §6.6.2 — a single grounded observation. */
export interface AiObservationItem {
  /** 1-2 sentence interpretive statement. */
  claim: string;
  /** Verbatim (or near-verbatim) excerpt from the prompt input. The
   *  client soft-checks that this substring appears in the input;
   *  observations whose citation is not found are flagged
   *  `[unverified]` in the rendered card so the user can spot
   *  hallucinations. */
  from_data: string;
}

/** ERD §5.4 rule that decides which Template applies to a given date.
 *  All four kinds are live from v0.3: resolver walks rules by
 *  priority desc and returns the first match. */
export type CalendarRuleKind =
  | 'weekday'
  | 'cycle'
  | 'date-range'
  | 'single-date'
  // ERD §5.4 v0.8.1 — match dates by ExternalEvent attributes (e.g.
  // "every statutory holiday → restday template", "user-noted days +
  // makeup workdays → workday"). Resolver queries the ExternalEvent
  // sources at the date in question; if any match the rule's
  // `match.kinds` (and optionally `match.regions`), apply
  // `templateKey`. See `CalendarRuleExternalEvent` below.
  | 'external-event';

export interface CalendarRuleSingleDate {
  date: string; // YYYY-MM-DD
  templateKey: TemplateKey;
}

/** Weekday rule — one row per template, multiple weekdays covered via
 *  the `weekdays` array (0 = Sunday, 6 = Saturday). Seeded on first
 *  boot to match the v0.2 heuristic (workday Mon–Fri / restday Sat-Sun). */
export interface CalendarRuleWeekday {
  weekdays: number[];
  templateKey: TemplateKey;
}

/** Date-range rule — inclusive on both ends. `label` is optional
 *  because single-purpose ranges (travel, exam, holiday) don't always
 *  need a name, but it's useful when they do. */
export interface CalendarRuleDateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (inclusive)
  templateKey: TemplateKey;
  label?: string;
}

/** Cycle rule — mapping of position-in-cycle → template.
 *  `anchor` is day 0 of the cycle. `mapping.length` must equal
 *  `cycleLength`. Position for a date is
 *  `((date - anchor) / 1 day) mod cycleLength`. */
export interface CalendarRuleCycle {
  cycleLength: number;
  anchor: string; // YYYY-MM-DD
  mapping: TemplateKey[];
}

/** ERD §5.4 / §14 v0.8.1 — attribute-match rule. Triggers when the
 *  date carries an `ExternalEvent` whose `kind` is in `match.kinds`
 *  (and `regionCode`, if present, is in `match.regions` when that
 *  optional filter is set). Lets the user say things like "every
 *  statutory holiday is a restday for me" without listing dates one
 *  by one. The resolver pulls candidate events via §14.1's
 *  `selectExternalEventsOn`, so adding a new ExternalEvent source
 *  (future ICS subscriptions, §14.4) automatically extends what this
 *  rule can match. */
export type ExternalEventMatchKind =
  | 'holiday'
  | 'observance'
  | 'makeup-workday'
  | 'user-note';

export interface CalendarRuleExternalEvent {
  /** At least one of these kinds must match the date's events for the
   *  rule to fire. Empty array = never fires (treated as a no-op). */
  kinds: ExternalEventMatchKind[];
  /** Optional region filter, applies only to `holiday` / `observance`
   *  / `makeup-workday` kinds (which carry `regionCode`). Undefined
   *  or empty = match any enabled region. `user-note` events have no
   *  region and ignore this field. */
  regions?: string[];
  /** Narrow `user-note` matching by the note's label (the user's own
   *  text). Only applies when `'user-note'` is in `kinds`; other
   *  kinds ignore it. Undefined / empty `query` = match every note.
   *
   *  Use cases the user asked for:
   *    - `{ mode: 'contains', query: '生日' }`
   *      "every note that mentions 生日 → restday"
   *    - `{ mode: 'exact', query: '看牙医' }`
   *      "only notes whose exact text is 看牙医 → workday"
   *
   *  v0.8.1 ships these two modes; regex / case-insensitive variants
   *  are out of scope. */
  noteLabelFilter?: {
    mode: 'contains' | 'exact';
    query: string;
  };
  templateKey: TemplateKey;
  /** Optional human-readable label shown in the rules drawer
   *  ("我的法定节假日") — purely for the user's bookkeeping; the
   *  resolver doesn't read this. */
  label?: string;
}

export interface CalendarRule {
  id: string;
  kind: CalendarRuleKind;
  /** **Deprecated as of v0.8.1.** Pre-v0.8.1 rules carried a numeric
   *  priority (`single-date` 100 / `date-range` 50 / `cycle` 30 /
   *  `weekday` 10) hardcoded by kind. v0.8.1 replaces that with a
   *  user-controllable order list (`UserProfile.calendarRuleOrder`);
   *  the resolver consults the order list first and falls back to
   *  this field only for legacy rules not yet in the order list. New
   *  v0.8.1 writes leave it undefined; existing rules keep their
   *  number until the user touches the rule again. */
  priority?: number;
  value:
    | CalendarRuleSingleDate
    | CalendarRuleWeekday
    | CalendarRuleDateRange
    | CalendarRuleCycle
    | CalendarRuleExternalEvent;
  createdAt: number;
}

/** ERD §10.5. Versioned snapshot of a CalendarRule's mutable fields.
 *  `id` / `kind` stay on the identity shell because the rule's nature
 *  (weekday vs. cycle vs. range) is part of its identity; `value` and
 *  `priority` move here so editing a weekday rule's `weekdays` array
 *  or a cycle rule's `mapping` produces a new revision. */
export interface CalendarRuleRevision {
  id: string;
  ruleId: string;
  effectiveFrom: EffectiveDate;
  /** Same deprecation note as `CalendarRule.priority`. v0.8.1 writes
   *  leave it undefined; pre-v0.8.1 revisions keep their number
   *  immortally because revisions are append-only (§10.5). */
  priority?: number;
  value:
    | CalendarRuleSingleDate
    | CalendarRuleWeekday
    | CalendarRuleDateRange
    | CalendarRuleCycle
    | CalendarRuleExternalEvent;
  authoredAt: number;
  sessionId?: string;
}

/** A unit of work within a Line. ERD pre-v0.2.1 called this "Chunk";
 *  renamed to "Task" to match universal TODO-tool vocabulary. */
export type TaskPriority = 'P0' | 'P1' | 'P2';

export interface Task {
  id: string;
  /** Owning Line. Tasks without an explicit Project default to `INBOX_LINE_ID`. */
  lineId: string;
  title: string;
  note?: string;
  order: number;
  /** §5.5 lightweight priority hint. Unset = no priority. Does NOT
   *  drive scheduling, check-in weighting, or notifications — only
   *  sort/group/filter in list surfaces. */
  priority?: TaskPriority;
  /** `deferred` = "do this later" (from v0.4 §5.6 check-in "Later").
   *  Semi-terminal; lands in §5.7 Pending queue for re-decision.
   *  `archived` = user parked it (restorable).
   *  `deleted` = soft-deleted (Trash view; purging = explicit confirmed
   *  hard delete). */
  status:
    | 'pending'
    | 'in-progress'
    | 'done'
    | 'deferred'
    | 'archived'
    | 'deleted';
  milestonePercent?: number;
  subItems?: Array<{ id: string; title: string; done: boolean }>;
  /** §5.5.2 scheduling — two mutually exclusive modes:
   *    Mode A, bind to Rail ▸ slot = { cycleId, date, railId }
   *    Mode B, free time    ▸ slot = undefined; AdhocEvent.taskId points back
   *    Unscheduled          ▸ slot = undefined AND no AdhocEvent refers to it. */
  slot?: { cycleId: string; date: string; railId: string };
  /** §4.1 v0.4.4 · per-slot user-defined ordering. When set on any
   *  task in a slot, the whole slot sorts by `slotOrder` asc (tasks
   *  without one fall to the bottom in stable insertion order). When
   *  no task in the slot has it set, the derived (state → priority →
   *  insertion) sort applies. New tasks get no `slotOrder`, so the
   *  legacy behavior is preserved end-to-end until the user drags
   *  something into a specific position. */
  slotOrder?: number;
  doneAt?: string;
  /** Stamped when the user moves the task into `deferred`. Helps the
   *  Pending queue sort by "when did it get deferred" for §5.7. */
  deferredAt?: string;
  archivedAt?: string;
  deletedAt?: string;
  /** v0.4: Tasks under a habit Line are auto-generated by the
   *  materializer (§10.2) — one per HabitBinding × matching date.
   *  `'auto-habit'` marks them; absent = user-authored. Payload-level
   *  field only — not used by reducers, but surfaced in the Task
   *  event payload for audit trails. */
  source?: 'auto-habit';
}

// ============ v0.8 · External Event Sources (ERD §14) ============

/** ERD §14.1. The unified shape every "calendar annotation that
 *  doesn't enter the task pipeline" gets rendered through. Three
 *  kinds of source produce these in v0.8+:
 *   - holidays (bundled JSON; §14.2)
 *   - user-defined day notes (§14.3)
 *   - ICS subscriptions (§14.4 v0.9+ parking)
 *  Render layer (Cycle View / Calendar / Today Track / Review) only
 *  knows this interface. ExternalEvents do NOT generate Tasks /
 *  RailInstances / auto-tasks; they don't enter §10.2 materialization,
 *  §10.3 purge, or §10.5 revision. They are pure labels on the day. */
export interface ExternalEvent {
  /** e.g. 'holidays:zh-CN' / 'user:note:<id>' / 'ics:<subId>'. */
  sourceId: string;
  /** ISO YYYY-MM-DD, in user's local calendar. */
  date: string;
  /** Display text. UI-locale-aware (per-source label rules). */
  label: string;
  /** Drives chip rendering:
   *   - `holiday`        — solid warm fill (statutory off-day)
   *   - `observance`     — dashed warm outline (cultural / traditional)
   *   - `event`          — neutral (generic external feed; reserved)
   *   - `user-note`      — outlined + user color (per-note `meta.color`)
   *   - `makeup-workday` — solid cool fill, label prefixed `调休·`
   *                        (the day looks like a weekend but is a
   *                        working day because of an adjacent holiday
   *                        extension; sourced from the State Council
   *                        notice via the holiday-cn dataset). */
  kind: 'holiday' | 'observance' | 'event' | 'user-note' | 'makeup-workday';
  /** holidays-source only. */
  regionCode?: string;
  /** Per-source extension slot. user-note carries `color` / `createdAt` here. */
  meta?: Record<string, unknown>;
}

/** ERD §14.3. A label the user manually attaches to a calendar day —
 *  birthdays, dentist appointments, anniversaries. Doesn't generate a
 *  Task; not part of any completion flow. Multiple notes per day are
 *  natural (the Y.Map is keyed by `id`, not `date`).  */
export interface UserDayNote {
  id: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** User-written text, single-line (suggested < 30 chars). */
  label: string;
  /** Optional chip color (one of the Radix-10 RailColor palette).
   *  Undefined = default neutral gray. */
  color?: RailColor;
  /** epoch ms. */
  createdAt: number;
  /** epoch ms. */
  updatedAt: number;
}

/** ERD §14.2 / §6.6.1 / §6.6 (v0.8.2 field-split policy). Singleton
 *  record holding cross-cutting user preferences that ride the Y.Doc
 *  sync stream. Settings inside the channel only — `aiApiKey` is
 *  intentionally NOT here; it lives in browser localStorage per the
 *  v0.8.2 credential mental model (see `apps/web/src/lib/aiApiKey.ts`). */
export interface UserProfile {
  /** ERD §14.2. Region codes for which bundled holiday data is shown
   *  (e.g. ['zh-CN', 'en-US']). Empty array = no holidays rendered. */
  enabledHolidayRegions?: string[];
  /** ERD §5.4 v0.8.1 — user-controllable CalendarRule priority order.
   *  Rule ids in the order they should be tried (front = highest
   *  priority). Rules not in this list fall back to the legacy
   *  numeric `priority` field (and below them in priority). The list
   *  is maintained by the rules-drawer drag-to-reorder UI; rules
   *  added through other UI surfaces (e.g. Cycle View's CycleDay
   *  template switch) prepend their id automatically so the user's
   *  most recent intention naturally wins. */
  calendarRuleOrder?: string[];
  /** ERD §6.6 v0.8.2 — master toggle for AI assistance. When false (or
   *  undefined), Settings hides the AI fields, the Day / Cycle
   *  reflection AI buttons are not rendered, and no calls are made.
   *  Defaults to false per §6.4 "off by default". */
  aiEnabled?: boolean;
  /** ERD §6.6 v0.8.2 — base URL of an OpenAI-compatible
   *  `/chat/completions` endpoint. Default suggested
   *  `https://openrouter.ai/api/v1`; users may point at any compatible
   *  provider (OpenRouter / Groq / Anthropic-via-proxy / Ollama / LM
   *  Studio / claude-code-router / claude-bridge). Empty string or
   *  undefined = field unset. */
  aiBaseUrl?: string;
  /** ERD §6.6 v0.8.2 — model id passed verbatim to the provider.
   *  Free-form text by design: each provider has its own namespace and
   *  hardcoding goes stale fast. */
  aiModel?: string;
  /** ERD §6.6.1 v0.8.2 — single Markdown blob describing the user
   *  ("grad student / runs on weekends / studying for exam"). Prepended
   *  to every AI call's system prompt. No history / no per-context
   *  override. Length-uncapped (provider enforces token limits). */
  background?: string;
}

/** Singleton id used by the underlying Y.Map of `userProfile`. */
export const USER_PROFILE_ID = 'singleton';

/** ERD §14.2. The shape of a bundled holiday data set after JSON
 *  parsing. One file per region under `apps/web/src/data/holidays/`. */
export interface HolidayDataset {
  regionCode: string;
  /** Locale dictionary; renderer reads `displayName[uiLocale] ?? displayName.en`. */
  displayName: Record<string, string>;
  events: HolidayDatasetEvent[];
}

export interface HolidayDatasetEvent {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Locale dictionary; renderer reads `label[uiLocale] ?? label.en`. */
  label: Record<string, string>;
  /** `holiday` = statutory / public off-day; `observance` =
   *  traditional / cultural but not a public day off (e.g. Mother's
   *  Day, 七夕); `makeup-workday` = a calendar workday created by
   *  the State Council to bracket a multi-day holiday block. */
  kind: 'holiday' | 'observance' | 'makeup-workday';
}
