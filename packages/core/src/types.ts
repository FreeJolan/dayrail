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
  taskName?: string;
  chunkIds: string[];
}

export type RailInstanceStatus = 'pending' | 'active' | 'done' | 'skipped';

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

/** §5.2 unifies user-facing Shift actions to four: Skip, Postpone,
 *  Replace, Add note. `swap` and `resize` are kept for future use
 *  (e.g. Cycle-view row swaps, explicit duration edits). */
export type ShiftType =
  | 'postpone'
  | 'swap'
  | 'skip'
  | 'resize'
  | 'replace'
  | 'note';

export interface Shift {
  id: string;
  railInstanceId: string;
  type: ShiftType;
  at: string;
  payload: Record<string, unknown>;
  tags?: string[];
  reason?: string; // ≤500 chars per v0.2 decision
}

export type SignalResponse = 'done' | 'skip' | 'shift' | 'ignore';

export interface Signal {
  id: string;
  railInstanceId: string;
  actedAt: string;
  response: SignalResponse;
  surface: 'check-in-strip' | 'pending-queue';
}

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

export interface Chunk {
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
