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
  sessions: Record<string, EditSession>;
}

interface DayRailActions {
  hydrate: () => Promise<void>;
  // --- templates ---
  upsertTemplate: (tpl: Template, sessionId?: string) => Promise<void>;
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
  createTask: (task: Task) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  /** Status transitions as dedicated actions so the event log captures
   *  intent cleanly (task.archived vs task.updated with status=archived). */
  archiveTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  purgeTask: (id: string) => Promise<void>;
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
    case 'line.archived':
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
    case 'adhoc.removed': {
      const id = (payload as { id: string }).id;
      delete state.adhocEvents[id];
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
  };
}

function ulidLite(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

      createTask: async (task) => {
        const event = await appendEvent({
          aggregateId: `task:${task.id}`,
          type: 'task.created',
          payload: { ...task },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
        afterMutation();
      },

      updateTask: async (id, patch) => {
        const event = await appendEvent({
          aggregateId: `task:${id}`,
          type: 'task.updated',
          payload: { id, ...patch },
        });
        set((draft) => applyEventInPlace(draft, event.type, event.payload));
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
