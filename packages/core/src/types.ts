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

export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekdays' }
  | { kind: 'custom'; weekdays: number[] };

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
  defaultLineId?: string;
  recurrence: Recurrence;
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

/** §4.4 state machine. "Currently happening" is NOT a status — it's
 *  purely wall-clock-derived (plannedStart ≤ now ≤ plannedEnd while
 *  status === 'pending'). The v0.2-early `active` / `skipped` are
 *  retired; their roles collapse into wall-clock derivation,
 *  `deferred`, and `archived` respectively. */
export type RailInstanceStatus = 'pending' | 'done' | 'deferred' | 'archived';

export interface RailInstance {
  id: string;
  railId: string;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  status: RailInstanceStatus;
  overrides?: Partial<Pick<Rail, 'name' | 'color' | 'icon' | 'durationMinutes'>>;
  sessionId?: string;
}

/** §5.2: only two Shift types survive v0.2 — each matches a terminal-
 *  or-semi-terminal status transition. Within-day postponing is
 *  handled via Cycle-View drag (not a Shift); swap / resize / replace
 *  are re-evaluated in v0.3. */
export type ShiftType = 'defer' | 'archive';

export interface Shift {
  id: string;
  railInstanceId: string;
  type: ShiftType;
  at: string;
  payload: Record<string, unknown>;
  tags?: string[];
  /** Not captured in v0.2 — the Reason toast only writes tags.
   *  Free-text reason is deferred to the v0.3 Pending detail page. */
  reason?: string;
}

/** §5.6 three-action check-in vocabulary. Replaces the v0.2-early
 *  `'skip' | 'shift' | 'ignore'` — those were semantically overlapping. */
export type SignalResponse = 'done' | 'defer' | 'archive';

export interface Signal {
  id: string;
  railInstanceId: string;
  actedAt: string;
  response: SignalResponse;
  surface: 'check-in-strip' | 'pending-queue';
}

/** `Line` is an internal container type. The UI never shows the word
 *  "Line" — the user sees Project / Habit / Group based on `kind`.
 *  Kept as an umbrella name in code because all three variants share
 *  id / name / color / status / plannedStart / plannedEnd.  */
export interface Line {
  id: string;
  name: string;
  color?: RailColor;
  status: 'active' | 'archived';
  kind: 'project' | 'habit' | 'group';
  plannedStart?: string;
  plannedEnd?: string;
  createdAt: number;
}

/** A unit of work within a Line. ERD pre-v0.2.1 called this "Chunk";
 *  renamed to "Task" to match universal TODO-tool vocabulary. */
export interface Task {
  id: string;
  lineId: string;
  title: string;
  note?: string;
  order: number;
  status: 'pending' | 'in-progress' | 'done';
  milestonePercent?: number;
  subItems?: Array<{ id: string; title: string; done: boolean }>;
  slot?: { cycleId: string; date: string; railId: string };
}
