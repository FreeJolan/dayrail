// Zustand store factory for DayRail v0.2. Backed by @dayrail/db:
// mutations dispatch events (see event.ts), reducers update both the
// in-memory store and the materialised domain tables.
//
// This is the narrowest useful slice for v0.2 — just the tables
// Template Editor touches (templates + rails + sessions). Cycle
// planning, check-in flow, Projects/Tasks follow in later wire-ups.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getDb, runMigrations } from '@dayrail/db';
import {
  appendEvent,
  currentClock,
  initClock,
  loadEvents,
  dropSessionEvents,
} from './event';
import {
  closeSession,
  onSessionChange,
  openSession,
  recoverActiveSessions,
  touchSession,
  type EditSession,
} from './session';
import {
  armSnapshotOnHide,
  clearSnapshots,
  loadLatestSnapshot,
  noteEvent,
  resetUnsnapshotted,
  shouldSnapshotAfterEvent,
  writeSnapshot,
} from './snapshot';
import {
  INBOX_LINE_ID,
  type AdhocEvent,
  type CalendarRule,
  type CalendarRuleCycle,
  type CalendarRuleDateRange,
  type CalendarRuleSingleDate,
  type CalendarRuleWeekday,
  type Cycle,
  type HabitPhase,
  type Line,
  type Rail,
  type RailColor,
  type RailInstance,
  type RailInstanceStatus,
  type Recurrence,
  type Shift,
  type ShiftType,
  type Signal,
  type SignalResponse,
  type Task,
  type Template,
  type TemplateKey,
  type AutoTaskMarker,
} from './types';

// ------------------------------------------------------------------
// Store shape.
// ------------------------------------------------------------------

export interface DayRailState {
  ready: boolean;
  error?: string;
  templates: Record<TemplateKey, Template>;
  rails: Record<string, Rail>;
  railInstances: Record<string, RailInstance>;
  signals: Record<string, Signal>;
  shifts: Record<string, Shift>;
  lines: Record<string, Line>;
  tasks: Record<string, Task>;
  adhocEvents: Record<string, AdhocEvent>;
  calendarRules: Record<string, CalendarRule>;
  cycles: Record<string, Cycle>;
  habitPhases: Record<string, HabitPhase>;
  /** §10.2 auto-task materialization markers. Key = `${habitId}|${cycleId}`. */
  autoTaskMarkers: Record<string, AutoTaskMarker>;
  sessions: Record<string, EditSession>;
}

interface DayRailActions {
  hydrate: () => Promise<void>;
  // --- templates ---
  upsertTemplate: (tpl: Template, sessionId?: string) => Promise<void>;
  /** Delete a Template and cascade its Rails. The caller is responsible
   *  for checking referential integrity (CalendarRule bindings, live
   *  Tasks scheduled on this template's rails) before calling — we
   *  don't guess what the right user-facing escape hatch is here. */
  deleteTemplate: (key: TemplateKey, sessionId?: string) => Promise<void>;
  // --- rails ---
  createRail: (rail: Rail, sessionId?: string) => Promise<void>;
  updateRail: (id: string, patch: Partial<Rail>, sessionId?: string) => Promise<void>;
  deleteRail: (id: string, sessionId?: string) => Promise<void>;
  // --- rail instances (Today Track / check-in) ---
  createRailInstance: (inst: RailInstance) => Promise<void>;
  markRailInstance: (id: string, status: RailInstanceStatus) => Promise<void>;
  recordSignal: (
    instanceId: string,
    response: SignalResponse,
    surface: Signal['surface'],
  ) => Promise<void>;
  recordShift: (shift: Shift) => Promise<void>;
  // --- lines (Project / Habit / Tag, §5.5) ---
  createLine: (line: Line) => Promise<void>;
  updateLine: (id: string, patch: Partial<Line>) => Promise<void>;
  deleteLine: (id: string) => Promise<void>;
  restoreLine: (id: string) => Promise<void>;
  purgeLine: (id: string) => Promise<void>;
  // --- tasks (units of work inside a Line, §5.5) ---
  createTask: (task: Task, sessionId?: string) => Promise<void>;
  updateTask: (
    id: string,
    patch: Partial<Task>,
    sessionId?: string,
  ) => Promise<void>;
  /** Status transitions as dedicated actions so the event log captures
   *  intent cleanly (task.archived vs task.updated with status=archived). */
  archiveTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  purgeTask: (id: string) => Promise<void>;
  // --- task scheduling (§5.5.2) ---
  /** Mode A: bind the task to a Rail on the given date. Also clears any
   *  existing free-time Ad-hoc backing this task, if one was set. */
  scheduleTaskToRail: (
    taskId: string,
    slot: { cycleId: string; date: string; railId: string },
    sessionId?: string,
  ) => Promise<void>;
  /** Mode B: schedule the task into a free time window. Creates an
   *  AdhocEvent with `taskId` back-reference. Clears `task.slot` (if
   *  previously Rail-bound) so the two modes stay mutually exclusive. */
  scheduleTaskFreeTime: (
    taskId: string,
    opts: {
      date: string;
      startMinutes: number;
      durationMinutes: number;
    },
  ) => Promise<void>;
  /** Remove whichever schedule the task has (Slot or Ad-hoc). No-op
   *  if the task is already unscheduled. No Shift / status change —
   *  this is "I hadn't done it yet, take it off my plan". */
  unscheduleTask: (taskId: string, sessionId?: string) => Promise<void>;
  // --- calendar rules (§5.4 CalendarRule) ---
  /** Write a `single-date` CalendarRule binding `date` to `templateKey`.
   *  Deduplicated by the deterministic id `cr-single-{date}` — flipping
   *  the same day repeatedly is one row's worth of events, not N. */
  overrideCycleDay: (
    date: string,
    templateKey: TemplateKey,
    sessionId?: string,
  ) => Promise<void>;
  /** Remove the single-date override for `date`. No-op if absent. */
  clearCycleDayOverride: (date: string, sessionId?: string) => Promise<void>;
  /** Upsert a weekday rule (one per template; flipping a template's
   *  coverage replaces the old row). `weekdays` uses 0 = Sunday. */
  upsertWeekdayRule: (
    templateKey: TemplateKey,
    weekdays: number[],
  ) => Promise<void>;
  /** Create or update a date-range rule. Pass `id` to update an
   *  existing one in place (keeps row id stable so history / tags
   *  stay attached); omit `id` to create a new rule (ULID id). */
  upsertDateRangeRule: (opts: {
    id?: string;
    from: string;
    to: string;
    templateKey: TemplateKey;
    label?: string;
  }) => Promise<string>;
  /** Create or update a cycle rule. Pass `id` to update in place. */
  upsertCycleRule: (opts: {
    id?: string;
    cycleLength: number;
    anchor: string;
    mapping: TemplateKey[];
  }) => Promise<string>;
  /** Remove any CalendarRule by id (weekday / date-range / cycle /
   *  single-date — caller names the rule explicitly). */
  removeCalendarRule: (id: string) => Promise<void>;
  // --- custom Cycle records (§5.3 / §9.7; v0.3.2 label-only scope) ---
  /** Upsert a Cycle record by deterministic id `cycle-{startDate}`.
   *  In v0.3.2 every Cycle is 7-day Monday-anchored, so id stability
   *  keyed by Monday is safe. `endDate` is enforced to `startDate +
   *  6 days` for now; v0.4 custom-length Cycles relax this. */
  upsertCycle: (opts: { startDate: string; label?: string }) => Promise<string>;
  /** Remove a Cycle record (strips the custom label / any future
   *  custom length; falls back to the derived default). */
  removeCycle: (id: string) => Promise<void>;
  // --- habit phases (§5.5.0; v0.3.3 scope: user-managed labels) ---
  /** Upsert a HabitPhase. Pass `id` to update in place (preserves
   *  `createdAt`); omit to create (ULID id). */
  upsertHabitPhase: (opts: {
    id?: string;
    lineId: string;
    name: string;
    description?: string;
    startDate: string;
  }) => Promise<string>;
  /** Remove a HabitPhase. Deleting the last phase for a Line flips
   *  it back to "simple habit" mode — derived from record count,
   *  no Line mutation needed. */
  removeHabitPhase: (id: string) => Promise<void>;
  // --- auto-task materialization (§10.2; v0.4+) ---
  /** Idempotent upsert of an auto-task. No-op when `state.tasks[id]`
   *  already exists — the caller (autoTask.ts materializer) uses
   *  deterministic ids, so this is the safe re-entry guard. */
  upsertAutoTask: (task: Task) => Promise<void>;
  /** Mark a (habit, cycle) pair as materialized. Subsequent
   *  materialize calls will skip this pair (see ERD §10.2). */
  upsertAutoTaskMarker: (habitId: string, cycleId: string) => Promise<void>;
  // --- ad-hoc events (standalone; task-backed adhocs live under
  //     scheduleTaskFreeTime + unscheduleTask) ---
  /** Create a standalone AdhocEvent on a given date. Returns the id. */
  createAdhocEvent: (opts: {
    date: string;
    name: string;
    startMinutes: number;
    durationMinutes: number;
    color?: RailColor;
    lineId?: string;
  }) => Promise<string>;
  /** Soft-delete a standalone AdhocEvent. Refuses task-backed events
   *  (taskId set) — those are owned by their Task's schedule state
   *  and must be unwound via `unscheduleTask`. */
  deleteAdhocEvent: (id: string) => Promise<void>;
  // --- sessions ---
  openEditSession: (surface: string) => Promise<EditSession>;
  closeEditSession: (sessionId: string) => Promise<void>;
  undoEditSession: (sessionId: string) => Promise<number>;
}

export type DayRailStore = DayRailState & DayRailActions;

// ------------------------------------------------------------------
// Reducer — applies an event to the in-memory state. Called for both
// fresh dispatches (after `appendEvent`) and historical replay (on
// `hydrate`). MUST be pure + deterministic.
// ------------------------------------------------------------------

type ReducerState = Pick<
  DayRailState,
  | 'templates'
  | 'rails'
  | 'railInstances'
  | 'signals'
  | 'shifts'
  | 'lines'
  | 'tasks'
  | 'adhocEvents'
  | 'calendarRules'
  | 'cycles'
  | 'habitPhases'
  | 'autoTaskMarkers'
>;

// Narrowed local types matching exactly the event payloads the Template
// Editor emits.
interface TemplatePayload extends Omit<Template, 'isDefault'> {
  isDefault?: boolean;
}
interface RailPayload extends Omit<Rail, 'recurrence'> {
  recurrence?: Recurrence;
}
interface InstanceStatusPayload {
  id: string;
  status: RailInstanceStatus;
  actualStart?: string;
  actualEnd?: string;
}
interface InstanceTimeShiftPayload {
  id: string;
  plannedStart?: string;
  plannedEnd?: string;
}
interface ShiftPayload {
  id: string;
  railInstanceId: string;
  type: ShiftType;
  at: string;
  payload?: Record<string, unknown>;
  tags?: string[];
  reason?: string;
}
interface SignalPayload {
  id: string;
  railInstanceId: string;
  actedAt: string;
  response: SignalResponse;
  surface: Signal['surface'];
}

function applyEventInPlace(
  state: ReducerState,
  type: string,
  payload: Record<string, unknown>,
): void {
  switch (type) {
    case 'template.created':
    case 'template.updated': {
      const tpl = payload as unknown as TemplatePayload;
      state.templates[tpl.key] = {
        key: tpl.key,
        name: tpl.name,
        color: tpl.color,
        isDefault: tpl.isDefault ?? false,
      };
      break;
    }
    case 'template.deleted': {
      const key = (payload as { key: TemplateKey }).key;
      delete state.templates[key];
      break;
    }
    case 'rail.created': {
      const rail = payload as unknown as RailPayload;
      state.rails[rail.id] = {
        ...rail,
        recurrence: rail.recurrence ?? { kind: 'weekdays' },
      } as Rail;
      break;
    }
    case 'rail.updated': {
      const p = payload as unknown as Partial<Rail> & { id: string };
      const existing = state.rails[p.id];
      if (existing) state.rails[p.id] = { ...existing, ...p };
      break;
    }
    case 'rail.deleted': {
      const id = (payload as { id: string }).id;
      delete state.rails[id];
      break;
    }
    case 'instance.created': {
      const inst = payload as unknown as RailInstance;
      state.railInstances[inst.id] = { ...inst };
      break;
    }
    case 'instance.status-changed': {
      const p = payload as unknown as InstanceStatusPayload;
      const existing = state.railInstances[p.id];
      if (existing) {
        state.railInstances[p.id] = {
          ...existing,
          status: p.status,
          actualStart: p.actualStart ?? existing.actualStart,
          actualEnd: p.actualEnd ?? existing.actualEnd,
        };
      }
      break;
    }
    case 'instance.time-shifted': {
      const p = payload as unknown as InstanceTimeShiftPayload;
      const existing = state.railInstances[p.id];
      if (existing) {
        state.railInstances[p.id] = {
          ...existing,
          plannedStart: p.plannedStart ?? existing.plannedStart,
          plannedEnd: p.plannedEnd ?? existing.plannedEnd,
        };
      }
      break;
    }
    case 'shift.recorded': {
      const p = payload as unknown as ShiftPayload;
      state.shifts[p.id] = {
        id: p.id,
        railInstanceId: p.railInstanceId,
        type: p.type,
        at: p.at,
        payload: p.payload ?? {},
        tags: p.tags,
        reason: p.reason,
      };
      break;
    }
    case 'signal.acted': {
      const p = payload as unknown as SignalPayload;
      state.signals[p.id] = {
        id: p.id,
        railInstanceId: p.railInstanceId,
        actedAt: p.actedAt,
        response: p.response,
        surface: p.surface,
      };
      break;
    }
    case 'line.created': {
      const line = payload as unknown as Line;
      state.lines[line.id] = { ...line };
      break;
    }
    case 'line.updated': {
      const p = payload as unknown as Partial<Line> & { id: string };
      const existing = state.lines[p.id];
      if (existing) state.lines[p.id] = { ...existing, ...p };
      break;
    }
    case 'line.restored':
    case 'line.deleted': {
      const p = payload as unknown as Partial<Line> & { id: string };
      const existing = state.lines[p.id];
      if (existing) state.lines[p.id] = { ...existing, ...p };
      break;
    }
    case 'line.purged': {
      const id = (payload as { id: string }).id;
      delete state.lines[id];
      // Cascade: drop tasks that belonged to this line.
      for (const tid of Object.keys(state.tasks)) {
        if (state.tasks[tid]?.lineId === id) delete state.tasks[tid];
      }
      break;
    }
    case 'task.created': {
      const task = payload as unknown as Task;
      state.tasks[task.id] = { ...task };
      break;
    }
    case 'task.updated':
    case 'task.archived':
    case 'task.restored':
    case 'task.deleted':
    case 'task.scheduled':
    case 'task.unscheduled': {
      const p = payload as unknown as Partial<Task> & { id: string };
      const existing = state.tasks[p.id];
      if (existing) state.tasks[p.id] = { ...existing, ...p };
      break;
    }
    case 'task.purged': {
      const id = (payload as { id: string }).id;
      delete state.tasks[id];
      break;
    }
    case 'adhoc.created': {
      const adhoc = payload as unknown as AdhocEvent;
      state.adhocEvents[adhoc.id] = { ...adhoc };
      break;
    }
    case 'adhoc.updated':
    case 'adhoc.deleted':
    case 'adhoc.restored': {
      const p = payload as unknown as Partial<AdhocEvent> & { id: string };
      const existing = state.adhocEvents[p.id];
      if (existing) state.adhocEvents[p.id] = { ...existing, ...p };
      break;
    }
    case 'calendar-rule.upserted': {
      const p = payload as unknown as CalendarRule;
      state.calendarRules[p.id] = {
        id: p.id,
        kind: p.kind,
        priority: p.priority,
        value: p.value,
        createdAt: p.createdAt,
      };
      break;
    }
    case 'calendar-rule.removed': {
      const id = (payload as { id: string }).id;
      delete state.calendarRules[id];
      break;
    }
    case 'cycle.upserted': {
      const p = payload as unknown as Cycle;
      state.cycles[p.id] = { ...p };
      break;
    }
    case 'cycle.removed': {
      const id = (payload as { id: string }).id;
      delete state.cycles[id];
      break;
    }
    case 'habit-phase.upserted': {
      const p = payload as unknown as HabitPhase;
      state.habitPhases[p.id] = { ...p };
      break;
    }
    case 'habit-phase.removed': {
      const id = (payload as { id: string }).id;
      delete state.habitPhases[id];
      break;
    }
    case 'auto-task-marker.set': {
      const p = payload as unknown as AutoTaskMarker;
      state.autoTaskMarkers[`${p.habitId}|${p.cycleId}`] = { ...p };
      break;
    }
    default:
      // Unknown event types are no-ops in this store slice.
      break;
  }
}

// ------------------------------------------------------------------
// Store factory. Exposed as a singleton created at module evaluation
// time, just like Zustand's common usage pattern. `hydrate()` must be
// awaited before components render any store-derived data.
// ------------------------------------------------------------------

type SnapshotPayload = Pick<
  DayRailState,
  | 'templates'
  | 'rails'
  | 'railInstances'
  | 'signals'
  | 'shifts'
  | 'lines'
  | 'tasks'
  | 'adhocEvents'
  | 'calendarRules'
  | 'cycles'
  | 'habitPhases'
  | 'autoTaskMarkers'
>;

function emptyReducerState(): ReducerState {
  return {
    templates: {},
    rails: {},
    railInstances: {},
    signals: {},
    shifts: {},
    lines: {},
    tasks: {},
    adhocEvents: {},
    calendarRules: {},
    cycles: {},
    habitPhases: {},
    autoTaskMarkers: {},
  };
}

function snapshotFromState(s: DayRailState): SnapshotPayload {
  return {
    templates: s.templates,
    rails: s.rails,
    railInstances: s.railInstances,
    signals: s.signals,
    shifts: s.shifts,
    lines: s.lines,
    tasks: s.tasks,
    adhocEvents: s.adhocEvents,
    calendarRules: s.calendarRules,
    cycles: s.cycles,
    habitPhases: s.habitPhases,
    autoTaskMarkers: s.autoTaskMarkers,
  };
}

function ulidLite(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Deterministic id for a `single-date` CalendarRule. Flipping the same
 *  day's template repeatedly resolves to an upsert on one row, not a
 *  growing pile of same-day rules. */
export function singleDateRuleId(date: string): string {
  return `cr-single-${date}`;
}

/** Add `n` days to an ISO date string; returns a new ISO date string.
 *  Used by the Cycle-record path to derive endDate from startDate+6. */
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default priorities per CalendarRule kind — §5.4 precedence order.
 *  Higher wins. single-date is the smallest-scope user override, so
 *  it sits at the top; weekday rules are the broadest, at the bottom. */
export const CALENDAR_RULE_PRIORITY: Record<CalendarRule['kind'], number> = {
  'single-date': 100,
  'date-range': 50,
  cycle: 30,
  weekday: 10,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Return true iff `rule` matches `date`. Precondition-checked
 *  against the resolver's invariants: `rule.value` is assumed to
 *  follow the `kind`'s typed shape (events that land in the store
 *  are only ever written through the typed action surface, so this
 *  holds at runtime). */
export function calendarRuleApplies(rule: CalendarRule, date: string): boolean {
  switch (rule.kind) {
    case 'single-date': {
      const v = rule.value as CalendarRuleSingleDate;
      return v.date === date;
    }
    case 'date-range': {
      const v = rule.value as CalendarRuleDateRange;
      return date >= v.from && date <= v.to;
    }
    case 'weekday': {
      const v = rule.value as CalendarRuleWeekday;
      const dow = new Date(`${date}T00:00:00`).getDay();
      return v.weekdays.includes(dow);
    }
    case 'cycle': {
      const v = rule.value as CalendarRuleCycle;
      if (v.cycleLength <= 0 || v.mapping.length === 0) return false;
      const diff = Math.floor(
        (new Date(`${date}T00:00:00`).getTime() -
          new Date(`${v.anchor}T00:00:00`).getTime()) /
          DAY_MS,
      );
      if (diff < 0) return false;
      const idx = diff % v.cycleLength;
      // A cycle rule always "matches" a date in-range — it maps
      // every position to a template. But the resolver extracts the
      // mapped template via `calendarRuleTemplate`, which can return
      // undefined for out-of-bounds mapping entries; guard there.
      return v.mapping[idx] != null;
    }
  }
}

/** Extract the `templateKey` a rule resolves to for the given date.
 *  Returns `undefined` if the rule's typed shape doesn't carry one
 *  for this date (e.g. cycle mapping missing at the position). */
export function calendarRuleTemplate(
  rule: CalendarRule,
  date: string,
): TemplateKey | undefined {
  switch (rule.kind) {
    case 'single-date':
      return (rule.value as CalendarRuleSingleDate).templateKey;
    case 'date-range':
      return (rule.value as CalendarRuleDateRange).templateKey;
    case 'weekday':
      return (rule.value as CalendarRuleWeekday).templateKey;
    case 'cycle': {
      const v = rule.value as CalendarRuleCycle;
      if (v.cycleLength <= 0) return undefined;
      const diff = Math.floor(
        (new Date(`${date}T00:00:00`).getTime() -
          new Date(`${v.anchor}T00:00:00`).getTime()) /
          DAY_MS,
      );
      if (diff < 0) return undefined;
      return v.mapping[diff % v.cycleLength];
    }
  }
}

/** Resolve the active Template for `date` by walking every
 *  CalendarRule in priority-desc order; returns the first match.
 *  Falls back to the caller-provided heuristic only if no rule
 *  matches. Ties in `priority` are broken by `createdAt` desc
 *  (newer rule wins) — the typical user mental model. */
export function resolveTemplateForDate(
  state: Pick<DayRailState, 'calendarRules'>,
  date: string,
  heuristic: (date: string) => TemplateKey | null,
): TemplateKey | null {
  const rules = Object.values(state.calendarRules);
  if (rules.length > 0) {
    const sorted = [...rules].sort(
      (a, b) => b.priority - a.priority || b.createdAt - a.createdAt,
    );
    for (const rule of sorted) {
      if (!calendarRuleApplies(rule, date)) continue;
      const tpl = calendarRuleTemplate(rule, date);
      if (tpl) return tpl;
    }
  }
  return heuristic(date);
}

let unhookSnapshotTriggers: (() => void) | null = null;
let unsubscribeSessionBridge: (() => void) | null = null;

export const useStore = create<DayRailStore>()(
  immer((set, get) => {
    // After a mutation: bump the unsnapshotted counter and, if the
    // threshold just tripped, snapshot in the background. We cap the
    // snapshot to "current state" — HLC is read fresh from the clock
    // so a racing appendEvent doesn't land outside the snapshot.
    const afterMutation = (): void => {
      noteEvent();
      if (shouldSnapshotAfterEvent()) {
        void writeSnapshot<SnapshotPayload>(
          snapshotFromState(get()),
          currentClock(),
          /* eventCount */ 0,
        );
      }
    };

    return {
      ready: false,
      templates: {},
      rails: {},
      railInstances: {},
      signals: {},
      shifts: {},
      lines: {},
      tasks: {},
      adhocEvents: {},
      calendarRules: {},
      cycles: {},
      habitPhases: {},
      autoTaskMarkers: {},
      sessions: {},

      hydrate: async () => {
        try {
          // 1. Open DB + run migrations (await — the worker queues DB
          //    calls serially but we still want surfaced errors).
          const db = await getDb();
          await runMigrations(db);

          // 2. Seed HLC + recover sessions.
          await initClock();
          const recovered = await recoverActiveSessions();

          // 3. Load latest snapshot (if any) + replay events since.
          const snap = await loadLatestSnapshot<SnapshotPayload>();
          const events = await loadEvents(snap ? { sinceHlc: snap.hlc } : {});

          set((draft) => {
            const reducerState = emptyReducerState();
            if (snap) {
              reducerState.templates = { ...(snap.state.templates ?? {}) };
              reducerState.rails = { ...(snap.state.rails ?? {}) };
              reducerState.railInstances = { ...(snap.state.railInstances ?? {}) };
              reducerState.signals = { ...(snap.state.signals ?? {}) };
              reducerState.shifts = { ...(snap.state.shifts ?? {}) };
              reducerState.lines = { ...(snap.state.lines ?? {}) };
              reducerState.tasks = { ...(snap.state.tasks ?? {}) };
              reducerState.adhocEvents = { ...(snap.state.adhocEvents ?? {}) };
              reducerState.calendarRules = { ...(snap.state.calendarRules ?? {}) };
              reducerState.cycles = { ...(snap.state.cycles ?? {}) };
              reducerState.habitPhases = { ...(snap.state.habitPhases ?? {}) };
              reducerState.autoTaskMarkers = {
                ...(snap.state.autoTaskMarkers ?? {}),
              };
            }
            for (const ev of events) {
              applyEventInPlace(reducerState, ev.type, ev.payload);
            }
            draft.templates = reducerState.templates;
            draft.rails = reducerState.rails;
            draft.railInstances = reducerState.railInstances;
            draft.signals = reducerState.signals;
            draft.shifts = reducerState.shifts;
            draft.lines = reducerState.lines;
            draft.tasks = reducerState.tasks;
            draft.adhocEvents = reducerState.adhocEvents;
            draft.calendarRules = reducerState.calendarRules;
            draft.cycles = reducerState.cycles;
            draft.habitPhases = reducerState.habitPhases;
            draft.autoTaskMarkers = reducerState.autoTaskMarkers;
            for (const s of recovered) {
              if (!s.closed) draft.sessions[s.id] = s;
            }
            draft.ready = true;
          });
          resetUnsnapshotted(events.length);

          // 4. Arm visibilitychange → snapshot if there are pending
          //    events. HMR may call hydrate more than once; clean up
          //    any previous binding first.
          if (unhookSnapshotTriggers) unhookSnapshotTriggers();
          unhookSnapshotTriggers = armSnapshotOnHide(() => {
            void writeSnapshot<SnapshotPayload>(
              snapshotFromState(get()),
              currentClock(),
              /* eventCount */ 0,
            );
          });

          // 5. Bridge session.ts's internal map into the store. `touchSession`
          //    and friends mutate the session registry but don't know about
          //    Zustand; without this listener the Edit Session indicator's
          //    `changeCount` would stay frozen at 0.
          if (unsubscribeSessionBridge) unsubscribeSessionBridge();
          unsubscribeSessionBridge = onSessionChange((session) => {
            set((draft) => {
              if (session.closed) {
                delete draft.sessions[session.id];
              } else {
                draft.sessions[session.id] = session;
              }
            });
          });
        } catch (err) {
          set((d) => {
            d.error = (err as Error).message;
            d.ready = true;
          });
          throw err;
        }
      },

      upsertTemplate: async (tpl, sessionId) => {
        const isCreate = !get().templates[tpl.key];
        const event = await appendEvent({
          aggregateId: `template:${tpl.key}`,
          type: isCreate ? 'template.created' : 'template.updated',
          payload: { ...tpl },
          sessionId,
        });
        if (sessionId) await touchSession(sessionId);
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      deleteTemplate: async (key, sessionId) => {
        // Delete dependent rails first so replay order matches intent:
        // when a reader rebuilds state the template disappears only
        // after its children. Ambient railInstances / signals for those
        // rails stay in history — the Rail aggregate is gone but its
        // event log lives on (matches how deleteRail already behaves).
        const railIds = Object.values(get().rails)
          .filter((r) => r.templateKey === key)
          .map((r) => r.id);
        for (const railId of railIds) {
          const railEvent = await appendEvent({
            aggregateId: `rail:${railId}`,
            type: 'rail.deleted',
            payload: { id: railId },
            sessionId,
          });
          set((draft) => {
            applyEventInPlace(draft, railEvent.type, railEvent.payload);
          });
        }
        const event = await appendEvent({
          aggregateId: `template:${key}`,
          type: 'template.deleted',
          payload: { key },
          sessionId,
        });
        if (sessionId) await touchSession(sessionId);
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      createRail: async (rail, sessionId) => {
        const event = await appendEvent({
          aggregateId: `rail:${rail.id}`,
          type: 'rail.created',
          payload: { ...rail },
          sessionId,
        });
        if (sessionId) await touchSession(sessionId);
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      updateRail: async (id, patch, sessionId) => {
        const event = await appendEvent({
          aggregateId: `rail:${id}`,
          type: 'rail.updated',
          payload: { id, ...patch },
          sessionId,
        });
        if (sessionId) await touchSession(sessionId);
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      deleteRail: async (id, sessionId) => {
        const event = await appendEvent({
          aggregateId: `rail:${id}`,
          type: 'rail.deleted',
          payload: { id },
          sessionId,
        });
        if (sessionId) await touchSession(sessionId);
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      createRailInstance: async (inst) => {
        const event = await appendEvent({
          aggregateId: `instance:${inst.id}`,
          type: 'instance.created',
          payload: { ...inst },
        });
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      markRailInstance: async (id, status) => {
        // status → wall-clock correlations: stamp actualEnd on any
        // terminal-or-semi-terminal transition out of `pending`. For
        // `done` this doubles as "finish time"; for deferred/archived
        // it simply marks when the user made that call. No actualStart
        // yet — v0.3 will introduce "start now" when the active state
        // gets its own UI.
        const now = new Date().toISOString();
        const payload: InstanceStatusPayload = { id, status };
        if (status !== 'pending') payload.actualEnd = now;
        const event = await appendEvent({
          aggregateId: `instance:${id}`,
          type: 'instance.status-changed',
          payload: { ...payload },
        });
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      recordSignal: async (instanceId, response, surface) => {
        const signalId = ulidLite('sig');
        const actedAt = new Date().toISOString();
        const event = await appendEvent({
          aggregateId: `instance:${instanceId}`,
          type: 'signal.acted',
          payload: {
            id: signalId,
            railInstanceId: instanceId,
            actedAt,
            response,
            surface,
          },
        });
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
        // All three responses flip the instance status so downstream
        // queries (Pending, Review) don't need to join signal history.
        const statusByResponse: Record<SignalResponse, RailInstanceStatus> = {
          done: 'done',
          defer: 'deferred',
          archive: 'archived',
        };
        await get().markRailInstance(instanceId, statusByResponse[response]);
      },

      recordShift: async (shift) => {
        const event = await appendEvent({
          aggregateId: `instance:${shift.railInstanceId}`,
          type: 'shift.recorded',
          payload: { ...shift },
        });
        set((draft) => {
          applyEventInPlace(draft, event.type, event.payload);
        });
        afterMutation();
      },

      // ---- Line CRUD (§5.5) --------------------------------------

      createLine: async (line) => {
        const event = await appendEvent({
          aggregateId: `line:${line.id}`,
          type: 'line.created',
          payload: { ...line },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      updateLine: async (id, patch) => {
        // Guard: built-in Lines (Inbox) can only be updated in limited
        // ways — we allow status transitions internally but block any
        // rename / recolor / delete from the UI layer. Here we leave
        // enforcement to callers; the store just writes whatever it
        // was asked to.
        const event = await appendEvent({
          aggregateId: `line:${id}`,
          type: 'line.updated',
          payload: { id, ...patch },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      deleteLine: async (id) => {
        const line = get().lines[id];
        if (!line) return;
        if (line.isDefault) return; // Inbox is undeletable.
        const deletedAt = Date.now();
        const event = await appendEvent({
          aggregateId: `line:${id}`,
          type: 'line.deleted',
          payload: { id, status: 'deleted', deletedAt },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      restoreLine: async (id) => {
        const event = await appendEvent({
          aggregateId: `line:${id}`,
          type: 'line.restored',
          payload: { id, status: 'active', deletedAt: undefined, archivedAt: undefined },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      purgeLine: async (id) => {
        const line = get().lines[id];
        if (!line) return;
        if (line.isDefault) return; // Inbox can't be purged either.
        const event = await appendEvent({
          aggregateId: `line:${id}`,
          type: 'line.purged',
          payload: { id },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      // ---- Task CRUD (§5.5) --------------------------------------

      createTask: async (task, sessionId) => {
        const event = await appendEvent({
          aggregateId: `task:${task.id}`,
          type: 'task.created',
          payload: { ...task },
          sessionId,
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        if (sessionId) await touchSession(sessionId);
        afterMutation();
      },

      updateTask: async (id, patch, sessionId) => {
        const event = await appendEvent({
          aggregateId: `task:${id}`,
          type: 'task.updated',
          payload: { id, ...patch },
          sessionId,
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        if (sessionId) await touchSession(sessionId);
        afterMutation();
      },

      archiveTask: async (id) => {
        const archivedAt = new Date().toISOString();
        const event = await appendEvent({
          aggregateId: `task:${id}`,
          type: 'task.archived',
          payload: { id, status: 'archived', archivedAt },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      restoreTask: async (id) => {
        // Restore returns to `pending` by default. Callers that know a
        // more specific prior status can pass it through updateTask
        // afterward.
        const event = await appendEvent({
          aggregateId: `task:${id}`,
          type: 'task.restored',
          payload: { id, status: 'pending', archivedAt: undefined, deletedAt: undefined },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      deleteTask: async (id) => {
        const deletedAt = new Date().toISOString();
        const event = await appendEvent({
          aggregateId: `task:${id}`,
          type: 'task.deleted',
          payload: { id, status: 'deleted', deletedAt },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      purgeTask: async (id) => {
        const event = await appendEvent({
          aggregateId: `task:${id}`,
          type: 'task.purged',
          payload: { id },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      // ---- Task scheduling (§5.5.2) ------------------------------

      scheduleTaskToRail: async (taskId, slot, sessionId) => {
        // If the task currently has a free-time Ad-hoc backing it, drop
        // it first — modes A and B are mutually exclusive. Both the
        // Ad-hoc deletion and the schedule event share the session tag
        // so session-level undo takes the pair back together.
        const adhocs = get().adhocEvents;
        for (const adhoc of Object.values(adhocs)) {
          if (adhoc.taskId === taskId && adhoc.status === 'active') {
            const del = await appendEvent({
              aggregateId: `adhoc:${adhoc.id}`,
              type: 'adhoc.deleted',
              payload: {
                id: adhoc.id,
                status: 'deleted',
                deletedAt: new Date().toISOString(),
              },
              sessionId,
            });
            set((draft) =>
              applyEventInPlace(draft, del.type, del.payload),
            );
          }
        }
        const ev = await appendEvent({
          aggregateId: `task:${taskId}`,
          type: 'task.scheduled',
          payload: { id: taskId, slot },
          sessionId,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        if (sessionId) await touchSession(sessionId);
        afterMutation();
      },

      scheduleTaskFreeTime: async (taskId, opts) => {
        // Clear Rail binding first if present — keeps the two modes
        // mutually exclusive.
        const task = get().tasks[taskId];
        if (task?.slot) {
          const clr = await appendEvent({
            aggregateId: `task:${taskId}`,
            type: 'task.scheduled',
            payload: { id: taskId, slot: undefined },
          });
          set((draft) =>
            applyEventInPlace(draft, clr.type, clr.payload),
          );
        }
        // Re-use an existing active Ad-hoc for this task if present
        // (user is just shifting the time window), otherwise create.
        const existing = Object.values(get().adhocEvents).find(
          (a) => a.taskId === taskId && a.status === 'active',
        );
        if (existing) {
          const ev = await appendEvent({
            aggregateId: `adhoc:${existing.id}`,
            type: 'adhoc.updated',
            payload: {
              id: existing.id,
              date: opts.date,
              startMinutes: opts.startMinutes,
              durationMinutes: opts.durationMinutes,
            },
          });
          set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        } else {
          const adhocId = `adhoc-${taskId}-${Date.now().toString(36)}`;
          const name = task?.title ?? 'Task';
          const ev = await appendEvent({
            aggregateId: `adhoc:${adhocId}`,
            type: 'adhoc.created',
            payload: {
              id: adhocId,
              date: opts.date,
              startMinutes: opts.startMinutes,
              durationMinutes: opts.durationMinutes,
              name,
              lineId: task?.lineId,
              taskId,
              status: 'active',
            },
          });
          set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        }
        afterMutation();
      },

      overrideCycleDay: async (date, templateKey, sessionId) => {
        const id = singleDateRuleId(date);
        const payload: CalendarRule = {
          id,
          kind: 'single-date',
          priority: CALENDAR_RULE_PRIORITY['single-date'],
          value: { date, templateKey } as CalendarRuleSingleDate,
          createdAt: Date.now(),
        };
        const existing = get().calendarRules[id];
        const existingValue = existing?.value as
          | CalendarRuleSingleDate
          | undefined;
        if (existing && existingValue?.templateKey === templateKey) return;
        const ev = await appendEvent({
          aggregateId: `calendar-rule:${id}`,
          type: 'calendar-rule.upserted',
          payload: payload as unknown as Record<string, unknown>,
          sessionId,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        if (sessionId) await touchSession(sessionId);
        afterMutation();
      },

      clearCycleDayOverride: async (date, sessionId) => {
        const id = singleDateRuleId(date);
        if (!get().calendarRules[id]) return;
        const ev = await appendEvent({
          aggregateId: `calendar-rule:${id}`,
          type: 'calendar-rule.removed',
          payload: { id },
          sessionId,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        if (sessionId) await touchSession(sessionId);
        afterMutation();
      },

      upsertWeekdayRule: async (templateKey, weekdays) => {
        // One rule per template — deterministic id lets subsequent
        // edits (coverage shrinks / grows) replace the row in place.
        const id = `cr-weekday-${templateKey}`;
        const payload: CalendarRule = {
          id,
          kind: 'weekday',
          priority: CALENDAR_RULE_PRIORITY.weekday,
          value: { templateKey, weekdays: [...weekdays].sort() } as CalendarRuleWeekday,
          createdAt: Date.now(),
        };
        const ev = await appendEvent({
          aggregateId: `calendar-rule:${id}`,
          type: 'calendar-rule.upserted',
          payload: payload as unknown as Record<string, unknown>,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
      },

      upsertDateRangeRule: async ({ id, from, to, templateKey, label }) => {
        // Reuse the existing id on update so the rule row stays stable
        // (and a later "revision history" view can key off it); mint
        // a fresh ULID on create.
        const ruleId = id ?? ulidLite('cr-range');
        const existing = id ? get().calendarRules[id] : undefined;
        const payload: CalendarRule = {
          id: ruleId,
          kind: 'date-range',
          priority: CALENDAR_RULE_PRIORITY['date-range'],
          value: { from, to, templateKey, ...(label && { label }) } as
            CalendarRuleDateRange,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        const ev = await appendEvent({
          aggregateId: `calendar-rule:${ruleId}`,
          type: 'calendar-rule.upserted',
          payload: payload as unknown as Record<string, unknown>,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
        return ruleId;
      },

      upsertCycleRule: async ({ id, cycleLength, anchor, mapping }) => {
        const ruleId = id ?? ulidLite('cr-cycle');
        const existing = id ? get().calendarRules[id] : undefined;
        const payload: CalendarRule = {
          id: ruleId,
          kind: 'cycle',
          priority: CALENDAR_RULE_PRIORITY.cycle,
          value: { cycleLength, anchor, mapping: [...mapping] } as CalendarRuleCycle,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        const ev = await appendEvent({
          aggregateId: `calendar-rule:${ruleId}`,
          type: 'calendar-rule.upserted',
          payload: payload as unknown as Record<string, unknown>,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
        return ruleId;
      },

      removeCalendarRule: async (id) => {
        if (!get().calendarRules[id]) return;
        const ev = await appendEvent({
          aggregateId: `calendar-rule:${id}`,
          type: 'calendar-rule.removed',
          payload: { id },
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
      },

      upsertCycle: async ({ startDate, label }) => {
        // Deterministic id keyed on startDate — every Monday maps to
        // at most one Cycle record, so edits (relabel, future length
        // change) replace in place.
        const id = `cycle-${startDate}`;
        const endDate = addDaysIso(startDate, 6);
        const existing = get().cycles[id];
        const payload: Cycle = {
          id,
          startDate,
          endDate,
          ...(label && { label }),
          createdAt: existing?.createdAt ?? Date.now(),
        };
        const ev = await appendEvent({
          aggregateId: `cycle:${id}`,
          type: 'cycle.upserted',
          payload: payload as unknown as Record<string, unknown>,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
        return id;
      },

      removeCycle: async (id) => {
        if (!get().cycles[id]) return;
        const ev = await appendEvent({
          aggregateId: `cycle:${id}`,
          type: 'cycle.removed',
          payload: { id },
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
      },

      upsertHabitPhase: async ({ id, lineId, name, description, startDate }) => {
        const phaseId = id ?? ulidLite('hp');
        const existing = id ? get().habitPhases[id] : undefined;
        const payload: HabitPhase = {
          id: phaseId,
          lineId,
          name,
          startDate,
          createdAt: existing?.createdAt ?? Date.now(),
          ...(description && { description }),
        };
        const ev = await appendEvent({
          aggregateId: `habit-phase:${phaseId}`,
          type: 'habit-phase.upserted',
          payload: payload as unknown as Record<string, unknown>,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
        return phaseId;
      },

      removeHabitPhase: async (id) => {
        if (!get().habitPhases[id]) return;
        const ev = await appendEvent({
          aggregateId: `habit-phase:${id}`,
          type: 'habit-phase.removed',
          payload: { id },
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
      },

      upsertAutoTask: async (task) => {
        // Idempotent: the materializer uses deterministic ids
        // (`task-auto-{habitId}-{date}`). Second call with the same id
        // is a no-op. This lets cycle switches / Today-Track boots /
        // rhythm-strip opens re-run freely without writing duplicates.
        if (get().tasks[task.id]) return;
        const ev = await appendEvent({
          aggregateId: `task:${task.id}`,
          type: 'task.created',
          payload: { ...task },
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
      },

      upsertAutoTaskMarker: async (habitId, cycleId) => {
        const key = `${habitId}|${cycleId}`;
        if (get().autoTaskMarkers[key]) return;
        const marker: AutoTaskMarker = { habitId, cycleId, at: Date.now() };
        const ev = await appendEvent({
          aggregateId: `auto-task-marker:${key}`,
          type: 'auto-task-marker.set',
          payload: marker as unknown as Record<string, unknown>,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
      },

      createAdhocEvent: async (opts) => {
        const id = ulidLite('adhoc');
        const payload: AdhocEvent = {
          id,
          date: opts.date,
          name: opts.name,
          startMinutes: opts.startMinutes,
          durationMinutes: opts.durationMinutes,
          status: 'active',
          ...(opts.color && { color: opts.color }),
          ...(opts.lineId && { lineId: opts.lineId }),
        };
        const ev = await appendEvent({
          aggregateId: `adhoc:${id}`,
          type: 'adhoc.created',
          payload: payload as unknown as Record<string, unknown>,
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
        return id;
      },

      deleteAdhocEvent: async (id) => {
        const ad = get().adhocEvents[id];
        if (!ad) return;
        if (ad.taskId) {
          // Task-backed adhocs are owned by the Task's schedule state.
          // Unscheduling the Task is the right path — refuse here so
          // we don't leave a Task pointing at a deleted slot.
          throw new Error(
            '不能直接删除绑定 Task 的 Ad-hoc 事件 —— 去 Tasks 视图把任务移出自由时间排期。',
          );
        }
        if (ad.status === 'deleted') return;
        const ev = await appendEvent({
          aggregateId: `adhoc:${id}`,
          type: 'adhoc.deleted',
          payload: {
            id,
            status: 'deleted',
            deletedAt: new Date().toISOString(),
          },
        });
        set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
        afterMutation();
      },

      unscheduleTask: async (taskId, sessionId) => {
        const task = get().tasks[taskId];
        let touched = false;
        if (task?.slot) {
          const ev = await appendEvent({
            aggregateId: `task:${taskId}`,
            type: 'task.unscheduled',
            payload: { id: taskId, slot: undefined },
            sessionId,
          });
          set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
          touched = true;
        }
        for (const adhoc of Object.values(get().adhocEvents)) {
          if (adhoc.taskId === taskId && adhoc.status === 'active') {
            const ev = await appendEvent({
              aggregateId: `adhoc:${adhoc.id}`,
              type: 'adhoc.deleted',
              payload: {
                id: adhoc.id,
                status: 'deleted',
                deletedAt: new Date().toISOString(),
              },
              sessionId,
            });
            set((draft) => applyEventInPlace(draft, ev.type, ev.payload));
            touched = true;
          }
        }
        if (touched && sessionId) await touchSession(sessionId);
        afterMutation();
      },

      openEditSession: async (surface) => {
        const session = await openSession(surface);
        set((draft) => {
          draft.sessions[session.id] = session;
        });
        return session;
      },

      closeEditSession: async (sessionId) => {
        await closeSession(sessionId);
        set((draft) => {
          delete draft.sessions[sessionId];
        });
      },

      /** §5.3.1 · roll back every event tagged with the session, then
       *  rebuild the in-memory state from the surviving events. */
      undoEditSession: async (sessionId) => {
        const removed = await dropSessionEvents(sessionId);
        // Any existing snapshot may have baked in the session's now-
        // dropped events. Wipe them so the next cold start replays
        // from scratch rather than inheriting ghost state.
        await clearSnapshots();
        const events = await loadEvents();
        set((draft) => {
          const reducerState = emptyReducerState();
          for (const ev of events) {
            applyEventInPlace(reducerState, ev.type, ev.payload);
          }
          draft.templates = reducerState.templates;
          draft.rails = reducerState.rails;
          draft.railInstances = reducerState.railInstances;
          draft.signals = reducerState.signals;
          draft.shifts = reducerState.shifts;
          draft.lines = reducerState.lines;
          draft.tasks = reducerState.tasks;
          draft.adhocEvents = reducerState.adhocEvents;
          draft.calendarRules = reducerState.calendarRules;
          draft.cycles = reducerState.cycles;
          draft.habitPhases = reducerState.habitPhases;
          draft.autoTaskMarkers = reducerState.autoTaskMarkers;
        });
        await closeSession(sessionId);
        set((draft) => {
          delete draft.sessions[sessionId];
        });
        return removed;
      },
    };
  }),
);

// ------------------------------------------------------------------
// One-shot selectors — a tiny ergonomic layer on top of store state.
// ------------------------------------------------------------------

export function selectRailsByTemplate(state: DayRailState, key: TemplateKey): Rail[] {
  return Object.values(state.rails)
    .filter((r) => r.templateKey === key)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

export function selectTemplateList(state: DayRailState): Template[] {
  return Object.values(state.templates);
}

// ------------------------------------------------------------------
// Tasks view selectors (§5.5).
// ------------------------------------------------------------------

export function selectActiveLines(state: DayRailState): Line[] {
  return Object.values(state.lines)
    .filter((l) => l.status === 'active')
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function selectLinesByKind(
  state: DayRailState,
  kind: Line['kind'],
  status: Line['status'] = 'active',
): Line[] {
  return Object.values(state.lines)
    .filter((l) => l.kind === kind && l.status === status)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function selectTasksByLine(
  state: DayRailState,
  lineId: string,
  { includeArchived = false, includeDeleted = false } = {},
): Task[] {
  return Object.values(state.tasks)
    .filter((t) => t.lineId === lineId)
    .filter((t) => includeDeleted || t.status !== 'deleted')
    .filter((t) => includeArchived || t.status !== 'archived')
    .sort((a, b) => a.order - b.order);
}

/** Phases attached to a habit Line, ordered by startDate asc.
 *  Returns empty array when the habit has phase tracking disabled. */
export function selectHabitPhasesByLine(
  state: Pick<DayRailState, 'habitPhases'>,
  lineId: string,
): HabitPhase[] {
  return Object.values(state.habitPhases)
    .filter((p) => p.lineId === lineId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Current phase of a habit = the phase with `startDate <= today`
 *  and the largest startDate. Returns undefined when the habit has
 *  no phases or all phases start in the future. */
export function selectCurrentHabitPhase(
  state: Pick<DayRailState, 'habitPhases'>,
  lineId: string,
  todayIso?: string,
): HabitPhase | undefined {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  let best: HabitPhase | undefined;
  for (const p of Object.values(state.habitPhases)) {
    if (p.lineId !== lineId) continue;
    if (p.startDate > today) continue;
    if (!best || p.startDate > best.startDate) best = p;
  }
  return best;
}

/** Has-milestone check — drives the §5.5 Project header's conditional
 *  progress bar. */
export function hasMilestone(state: DayRailState, lineId: string): boolean {
  for (const t of Object.values(state.tasks)) {
    if (t.lineId !== lineId) continue;
    if (t.status === 'deleted') continue;
    if (t.milestonePercent != null) return true;
  }
  return false;
}

/** Project progress: max `milestonePercent` among done tasks in the
 *  Line. Returns 0 if no done-milestones yet. Callers should guard
 *  with `hasMilestone` — an all-zero bar on a no-milestone Project is
 *  misleading. */
export function selectProjectProgress(state: DayRailState, lineId: string): number {
  let max = 0;
  for (const t of Object.values(state.tasks)) {
    if (t.lineId !== lineId) continue;
    if (t.status !== 'done') continue;
    if (t.milestonePercent != null && t.milestonePercent > max) {
      max = t.milestonePercent;
    }
  }
  return max;
}

export function countTasks(
  state: DayRailState,
  lineId: string,
): { done: number; open: number; total: number } {
  let done = 0;
  let open = 0;
  for (const t of Object.values(state.tasks)) {
    if (t.lineId !== lineId) continue;
    if (t.status === 'deleted' || t.status === 'archived') continue;
    if (t.status === 'done') done++;
    else open++;
  }
  return { done, open, total: done + open };
}

export { INBOX_LINE_ID };

export type { Line, Task, AdhocEvent, RailColor };
