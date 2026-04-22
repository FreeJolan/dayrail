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

export interface Template {
  key: TemplateKey;
  name: string;
  color?: RailColor;
  isDefault: boolean;
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
 *                    consumption. */
export type ShiftType = 'defer' | 'archive' | 'reschedule';

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

/** An audit record attached to a Task occurrence when the user
 *  deferred / archived / rescheduled it. Multiple tags + optional
 *  reason. v0.4: anchored to `taskId` (was `railInstanceId` before
 *  the RailInstance entity removal). */
export interface Shift {
  id: string;
  taskId: string;
  type: ShiftType;
  at: string;
  /** Shape depends on `type`. For `reschedule`, this is a
   *  `ReschedulePayload`. For `defer` / `archive`, currently
   *  free-form (empty object in practice). */
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
}

/** ERD §5.4 rule that decides which Template applies to a given date.
 *  All four kinds are live from v0.3: resolver walks rules by
 *  priority desc and returns the first match. */
export type CalendarRuleKind = 'weekday' | 'cycle' | 'date-range' | 'single-date';

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

export interface CalendarRule {
  id: string;
  kind: CalendarRuleKind;
  /** Higher wins. Defaults by kind (§5.4): single-date 100 ·
   *  date-range 50 · cycle 30 · weekday 10. */
  priority: number;
  value:
    | CalendarRuleSingleDate
    | CalendarRuleWeekday
    | CalendarRuleDateRange
    | CalendarRuleCycle;
  createdAt: number;
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
