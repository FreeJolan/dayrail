// Zustand store factory for DayRail v0.2. Backed by @dayrail/db:
// mutations dispatch events (see event.ts), reducers update both the
// in-memory store and the materialised domain tables.
//
// This is the narrowest useful slice for v0.2 — just the tables
// Template Editor touches (templates + rails + sessions). Cycle
// planning, check-in flow, Projects/Chunks follow in later wire-ups.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getDb, runMigrations } from '@dayrail/db';
import { appendEvent, initClock, loadEvents, dropSessionEvents } from './event';
import {
  closeSession,
  openSession,
  recoverActiveSessions,
  touchSession,
  type EditSession,
} from './session';
import type { Rail, RailColor, Recurrence, Template, TemplateKey } from './types';

// ------------------------------------------------------------------
// Store shape.
// ------------------------------------------------------------------

interface DayRailState {
  ready: boolean;
  error?: string;
  templates: Record<TemplateKey, Template>;
  rails: Record<string, Rail>;
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

type ReducerState = Pick<DayRailState, 'templates' | 'rails'>;

// Narrowed local types matching exactly the event payloads the Template
// Editor emits.
interface TemplatePayload extends Omit<Template, 'isDefault'> {
  isDefault?: boolean;
}
interface RailPayload extends Omit<Rail, 'recurrence'> {
  recurrence?: Recurrence;
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

export const useStore = create<DayRailStore>()(
  immer((set, get) => ({
    ready: false,
    templates: {},
    rails: {},
    sessions: {},

    hydrate: async () => {
      try {
        // 1. Open DB + run migrations
        const db = await getDb();
        runMigrations(db);

        // 2. Seed HLC + recover sessions
        await initClock();
        const recovered = await recoverActiveSessions();

        // 3. Replay every event — v0.2 uses no snapshot yet, so replay
        //    is always from 0. Snapshot support lands later in the
        //    data-layer milestone.
        const events = await loadEvents();
        set((draft) => {
          const reducerState: ReducerState = {
            templates: draft.templates,
            rails: draft.rails,
          };
          for (const ev of events) {
            applyEventInPlace(reducerState, ev.type, ev.payload);
          }
          for (const s of recovered) {
            if (!s.closed) draft.sessions[s.id] = s;
          }
          draft.ready = true;
        });

        // Keep the store's session mirror in sync with the registry
        // by polling — cheap since we emit change notifications.
        // (The event-based subscription lives in the surface components
        // that open/close sessions; for now this is a good-enough
        // hookup.)
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
        applyEventInPlace(
          { templates: draft.templates, rails: draft.rails },
          event.type,
          event.payload,
        );
      });
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
        applyEventInPlace(
          { templates: draft.templates, rails: draft.rails },
          event.type,
          event.payload,
        );
      });
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
        applyEventInPlace(
          { templates: draft.templates, rails: draft.rails },
          event.type,
          event.payload,
        );
      });
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
        applyEventInPlace(
          { templates: draft.templates, rails: draft.rails },
          event.type,
          event.payload,
        );
      });
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
      // Rebuild the two aggregates this store cares about.
      const events = await loadEvents();
      set((draft) => {
        draft.templates = {};
        draft.rails = {};
        const reducerState: ReducerState = {
          templates: draft.templates,
          rails: draft.rails,
        };
        for (const ev of events) applyEventInPlace(reducerState, ev.type, ev.payload);
      });
      await closeSession(sessionId);
      set((draft) => {
        delete draft.sessions[sessionId];
      });
      return removed;
    },
  })),
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

export type { RailColor };
