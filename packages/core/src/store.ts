// Y.Doc-backed store (ERD §7.7 · v0.7).
//
// Status: SCAFFOLD (PR #28 in-progress). This file is NOT yet exported
// from `@dayrail/core/index.ts`. The legacy `store.ts` (event-sourced,
// SQL-backed) remains the active store until this file's action set is
// fully translated and verified, at which point a single commit on
// the v0.7/yjs-integration branch swaps the export, and a follow-up
// commit deletes store.ts / event.ts / snapshot.ts / hlc.ts plus the
// SQL-only @dayrail/db files.
//
// =================================================================
// Design (Option A — full replacement)
// =================================================================
//
// Y.Doc is the source of truth for all v0.7 user data. There is no
// SQL events table, no snapshots table, no HLC clock. Persistence is
// a single binary file in OPFS (`dayrail-state.dryj`); the same .dryj
// container is what gets uploaded to Drive.
//
// Each top-level Y.Map (one per existing entity store: templates,
// rails, lines, tasks, …) holds entities keyed by id. Each entity is
// itself a Y.Map so field-level merge is the default. See
// @dayrail/db/yjs for the schema definition.
//
// The Zustand store mirrors a flat-shape derivation of Y.Doc state.
// On every Y.Doc transaction, an observer re-derives the flat state
// and calls `set()`. Consumers (React components) keep using
// `useStore` exactly as before — no UI churn.
//
// Action contract:
//   1. Open `ydoc.transact(() => { ... })`.
//   2. Inside, write to Y.Map / Y.Array directly. For revisions and
//      tombstones, use the helpers further down (emitRailRevisionY,
//      etc.).
//   3. Return. The observer fires synchronously, derives new flat
//      state, and `set()`s it. The OPFS persistence subscriber
//      (debounced) writes the new bytes to disk.
//
// =================================================================
// Translation guide for the remaining actions
// =================================================================
//
// Each action stub below carries a comment pointing to the legacy
// implementation in `store.ts`. The pattern to follow:
//
//   // Legacy (store.ts:LINE):
//   //   - appendEvent({ type: 'foo.bar', payload, ... })
//   //   - applyEventInPlace(draft, 'foo.bar', payload)
//   //   - revision/tombstone helpers
//   //
//   // Y.Doc translation:
//   //   doc.transact(() => {
//   //     // Mirror what applyEventInPlace did, but on Y.Map / Y.Array:
//   //     const map = doc.getMap('foo');
//   //     // upsert: patchEntityYMap(existing, patch) or
//   //              entityToYMap(entity)
//   //     // delete: map.delete(id)
//   //     // revisions: emitRailRevisionY(doc, ...) etc.
//   //   });
//
// Helpers `entityToYMap` / `yMapToEntity` / `patchEntityYMap` come
// from `@dayrail/db/yjs`. v0.7 stores all array-typed entity fields
// (incl. Task.subItems) as plain JS arrays — atomic LWW. See yjs.ts
// header for the Y.Array trade-off.
//
// IMPORTANT — no event log, no replay. Two consequences:
//   - "session undo" (undoEditSession) reads the Y.Doc's recent
//     update history via Y.UndoManager rather than the events table.
//     Implementation deferred to the cutover commit.
//   - the v0.5 sentinel-revision migration is a no-op in v0.7: any
//     bundle imported through "Import from snapshot" already carries
//     the post-migration state.

import { create } from 'zustand';
import type { Doc as YDoc, Map as YMap, Array as YArray } from 'yjs';
import * as Y from 'yjs';
import {
  createYDoc,
  encodeDocAsUpdate,
  entityToYMap,
  loadFlatStateIntoDoc,
  patchEntityYMap,
  readFlatStateFromDoc,
  TOP_LEVEL_MAPS,
  type FlatState,
} from '@dayrail/db/yjs';
import { encodeDryj, type DryjMeta } from '@dayrail/db/dryj';
import {
  loadYDocBytes,
  saveYDocBytes,
} from '@dayrail/db/yjsPersistence';
import { decodeDryj } from '@dayrail/db/dryj';
import type {
  AdhocEvent,
  AiObservation,
  CalendarRule,
  CalendarRuleCycle,
  CalendarRuleDateRange,
  CalendarRuleExternalEvent,
  CalendarRuleRevision,
  CalendarRuleSingleDate,
  CalendarRuleWeekday,
  Cycle,
  DailyReflection,
  ExternalEventMatchKind,
  HabitBinding,
  HabitBindingRevision,
  HabitPhase,
  Line,
  Rail,
  RailColor,
  RailRevision,
  Shift,
  Signal,
  SignalResponse,
  Task,
  TaskOccurrence,
  Template,
  TemplateKey,
  TemplateRevision,
  Tombstone,
  UserDayNote,
  UserProfile,
} from './types';
import {
  USER_PROFILE_ID,
  deriveTaskStatus,
  deriveTaskProgress,
  isOccurrenceManaged,
} from './types';
import { selectExternalEventsOn } from './externalEvents';
import { detectReschedule } from './reschedule';
import { detectUnschedule } from './unschedule';
import type { ReschedulePayload, UnschedulePayload, ShiftType } from './types';

// ============ EditSession (preserved from legacy session.ts) ============

/** Edit Session record (ERD §5.3.1). v0.7 sessions live in zustand
 *  state only — no SQL persistence — and the corresponding undo
 *  history lives in a Y.UndoManager scoped to the session's origin
 *  string. See `openEditSession` / `undoEditSession` for details. */
export interface EditSession {
  id: string;
  surface: string;
  openedAt: number;
  lastActivityAt: number;
  changeCount: number;
  closed: boolean;
}

// ============ State / actions interfaces (mirrored from legacy store.ts) ============

export interface DayRailState {
  ready: boolean;
  error?: string;
  templates: Record<TemplateKey, Template>;
  rails: Record<string, Rail>;
  signals: Record<string, Signal>;
  shifts: Record<string, Shift>;
  lines: Record<string, Line>;
  tasks: Record<string, Task>;
  /** ERD §10.6 (v0.11). Top-level Y.Map<id, TaskOccurrence>. Empty for
   *  Tasks with no splits. Selectors filter by `taskId`. */
  taskOccurrences: Record<string, TaskOccurrence>;
  adhocEvents: Record<string, AdhocEvent>;
  calendarRules: Record<string, CalendarRule>;
  cycles: Record<string, Cycle>;
  habitPhases: Record<string, HabitPhase>;
  reflections: Record<string, DailyReflection>;
  habitBindings: Record<string, HabitBinding>;
  /** ERD §14.3 — user-defined day notes, keyed by note id. */
  userDayNotes: Record<string, UserDayNote>;
  /** ERD §14.2 / §6.6.1 — singleton user profile. `null` until first
   *  write or hydrate from a doc with no profile yet. */
  userProfile: UserProfile | null;
  railRevisions: Record<string, RailRevision[]>;
  templateRevisions: Record<TemplateKey, TemplateRevision[]>;
  calendarRuleRevisions: Record<string, CalendarRuleRevision[]>;
  habitBindingRevisions: Record<string, HabitBindingRevision[]>;
  railTombstones: Record<string, Tombstone>;
  templateTombstones: Record<TemplateKey, Tombstone>;
  calendarRuleTombstones: Record<string, Tombstone>;
  habitBindingTombstones: Record<string, Tombstone>;
  /** v0.5 sentinel-revision migration is a no-op in v0.7 — any state
   *  reaching this store is already post-migration. The field stays
   *  on the type for legacy reads but is always `true`. */
  v05MigrationApplied: boolean;
  sessions: Record<string, EditSession>;
  pendingShiftPrompt: Shift | null;
}

export interface DayRailActions {
  hydrate: () => Promise<void>;
  upsertTemplate: (
    tpl: Template,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  deleteTemplate: (
    key: TemplateKey,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  createRail: (
    rail: Rail,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  updateRail: (
    id: string,
    patch: Partial<Rail>,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  deleteRail: (
    id: string,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  recordSignal: (
    taskId: string,
    response: SignalResponse,
    surface: Signal['surface'],
  ) => Promise<void>;
  recordShift: (shift: Shift) => Promise<void>;
  setShiftTags: (shiftId: string, tags: string[]) => Promise<void>;
  ackShiftPrompt: (shiftId: string) => void;
  createLine: (line: Line, sessionId?: string) => Promise<void>;
  updateLine: (id: string, patch: Partial<Line>) => Promise<void>;
  deleteLine: (id: string) => Promise<void>;
  restoreLine: (id: string) => Promise<void>;
  purgeLine: (id: string) => Promise<void>;
  createTask: (task: Task, sessionId?: string) => Promise<void>;
  updateTask: (
    id: string,
    patch: Partial<Task>,
    sessionId?: string,
  ) => Promise<void>;
  archiveTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  purgeTask: (id: string, sessionId?: string) => Promise<void>;
  scheduleTaskToRail: (
    taskId: string,
    slot: { cycleId: string; date: string; railId: string },
    sessionId?: string,
  ) => Promise<void>;
  setSlotTaskOrder: (
    slot: { cycleId: string; date: string; railId: string },
    orderedTaskIds: string[],
    sessionId?: string,
  ) => Promise<void>;
  scheduleTaskFreeTime: (
    taskId: string,
    opts: { date: string; startMinutes: number; durationMinutes: number },
  ) => Promise<void>;
  unscheduleTask: (taskId: string, sessionId?: string) => Promise<void>;
  overrideCycleDay: (
    date: string,
    templateKey: TemplateKey,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  clearCycleDayOverride: (
    date: string,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  upsertWeekdayRule: (
    templateKey: TemplateKey,
    weekdays: number[],
    effectiveFrom?: string,
  ) => Promise<void>;
  upsertDateRangeRule: (opts: {
    id?: string;
    from: string;
    to: string;
    templateKey: TemplateKey;
    label?: string;
    effectiveFrom?: string;
  }) => Promise<string>;
  upsertCycleRule: (opts: {
    id?: string;
    cycleLength: number;
    anchor: string;
    mapping: TemplateKey[];
    effectiveFrom?: string;
  }) => Promise<string>;
  removeCalendarRule: (id: string, effectiveFrom?: string) => Promise<void>;
  /** ERD §5.4 v0.8.1 — create / update an attribute-match rule. Pass
   *  `id` to update; omit to create (fresh ULID). */
  upsertExternalEventRule: (opts: {
    id?: string;
    kinds: ExternalEventMatchKind[];
    regions?: string[];
    /** v0.8.1 — narrow `user-note` matching by note label. See
     *  CalendarRuleExternalEvent.noteLabelFilter. */
    noteLabelFilter?: { mode: 'contains' | 'exact'; query: string };
    templateKey: TemplateKey;
    label?: string;
    effectiveFrom?: string;
  }) => Promise<string>;
  /** ERD §5.4 v0.8.1 — replace the user's CalendarRule priority list
   *  (drag-to-reorder writes the full new order each time). Ids that
   *  don't exist as rules are filtered out automatically. */
  setCalendarRuleOrder: (orderedIds: string[]) => Promise<void>;
  /** ERD §5.3 / §10 — upsert a Cycle entity. Default behavior (omit
   *  `id` and `endDate`) creates a 7-day Monday-anchored cycle keyed
   *  `cycle-{startDate}`. v0.8.2 adds two optional overrides:
   *    - `id`: custom entity id (e.g. `month-2026-04` for synthetic
   *      Month-scope reflection caches; ERD §6.6.2 v0.8.2).
   *    - `endDate`: custom inclusive end date (originally reserved
   *      "for v0.4 custom-length cycles" per the type comment;
   *      v0.8.2 finally exercises that). */
  upsertCycle: (opts: {
    startDate: string;
    label?: string;
    id?: string;
    endDate?: string;
  }) => Promise<string>;
  removeCycle: (id: string) => Promise<void>;
  upsertHabitPhase: (opts: {
    id?: string;
    lineId: string;
    name: string;
    description?: string;
    startDate: string;
  }) => Promise<string>;
  removeHabitPhase: (id: string) => Promise<void>;
  setReflection: (date: string, content: string) => Promise<void>;
  /** ERD §14.3 — create / update a user day note. Pass `id` to update;
   *  omit to create (fresh ULID + createdAt). Returns the id. */
  upsertUserDayNote: (opts: {
    id?: string;
    date: string;
    label: string;
    color?: RailColor;
  }) => Promise<string>;
  /** ERD §14.3 — delete a user day note (hard delete, no soft-delete). */
  removeUserDayNote: (id: string) => Promise<void>;
  /** ERD §14.2 — replace the enabled-region list for the holiday
   *  display layer. Empty array = nothing rendered. */
  setEnabledHolidayRegions: (regions: string[]) => Promise<void>;
  /** ERD §6.6 v0.8.2 — master toggle for AI assistance. */
  setAiEnabled: (enabled: boolean) => Promise<void>;
  /** ERD §6.6 v0.8.2 — base URL of an OpenAI-compatible
   *  `/chat/completions` endpoint. Pass empty string to clear. */
  setAiBaseUrl: (baseUrl: string) => Promise<void>;
  /** ERD §6.6 v0.8.2 — model id passed verbatim to the provider. */
  setAiModel: (model: string) => Promise<void>;
  /** ERD §6.6.1 v0.8.2 — single Markdown blob describing the user.
   *  Pass empty string to clear. */
  setUserBackground: (background: string) => Promise<void>;
  /** ERD §6.6.2 v0.8.2 — cache the most recent Day-reflection AI
   *  output. No-op if no reflection row exists for that date (UX gate
   *  enforces non-empty content as a precondition). */
  setDailyReflectionAiObservation: (
    date: string,
    observation: AiObservation,
  ) => Promise<void>;
  /** ERD §6.6.2 v0.8.2 — cache the most recent Cycle-reflection AI
   *  output. No-op if cycle entity is missing. */
  setCycleAiObservation: (
    cycleId: string,
    observation: AiObservation,
  ) => Promise<void>;
  upsertHabitBinding: (
    opts: {
      id?: string;
      habitId: string;
      railId: string;
      weekdays?: number[];
      effectiveFrom?: string;
    },
    sessionId?: string,
  ) => Promise<string>;
  removeHabitBinding: (
    id: string,
    sessionId?: string,
    effectiveFrom?: string,
  ) => Promise<void>;
  upsertAutoTask: (task: Task) => Promise<void>;
  // ============ ERD §10.6 v0.11 · Task occurrences ============
  /** Add a TaskOccurrence under a Task. If `Task.slot` was set and this
   *  is the first occurrence, atomically converts the legacy slot into
   *  a label-less / percent-less occurrence in the same transaction
   *  (the new occurrence is appended after that conversion). Returns
   *  the new occurrence id. */
  addTaskOccurrence: (
    taskId: string,
    partial?: Partial<Omit<TaskOccurrence, 'id' | 'taskId'>>,
    sessionId?: string,
  ) => Promise<string>;
  updateTaskOccurrence: (
    occurrenceId: string,
    patch: Partial<Omit<TaskOccurrence, 'id' | 'taskId'>>,
    sessionId?: string,
  ) => Promise<void>;
  /** Set occurrence status to 'done' + stamp doneAt. */
  completeTaskOccurrence: (
    occurrenceId: string,
    sessionId?: string,
  ) => Promise<void>;
  /** Reopen a previously-done occurrence (status → pending, clears doneAt). */
  reopenTaskOccurrence: (
    occurrenceId: string,
    sessionId?: string,
  ) => Promise<void>;
  archiveTaskOccurrence: (
    occurrenceId: string,
    sessionId?: string,
  ) => Promise<void>;
  /** Hard-remove an occurrence (used by the "delete this split" affordance). */
  removeTaskOccurrence: (
    occurrenceId: string,
    sessionId?: string,
  ) => Promise<void>;
  /** Move an occurrence to a different (cycleId, date, railId) slot, or
   *  clear its slot when `slot === null`. */
  scheduleTaskOccurrence: (
    occurrenceId: string,
    slot: { cycleId: string; date: string; railId: string } | null,
    sessionId?: string,
  ) => Promise<void>;
  createAdhocEvent: (opts: {
    date: string;
    name: string;
    startMinutes: number;
    durationMinutes: number;
    color?: RailColor;
    lineId?: string;
  }) => Promise<string>;
  deleteAdhocEvent: (id: string) => Promise<void>;
  openEditSession: (surface: string) => Promise<EditSession>;
  closeEditSession: (sessionId: string) => Promise<void>;
  undoEditSession: (sessionId: string) => Promise<number>;
}

export type DayRailStore = DayRailState & DayRailActions;

// ============ Y.Doc singleton + persistence wiring ============

let docInstance: YDoc | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 750;

export function getYDoc(): YDoc {
  if (!docInstance) {
    docInstance = createYDoc();
  }
  return docInstance;
}

/** Origins reserved for non-user-authored Y.Doc transactions. The
 *  sync layer hooks Y.Doc's afterTransaction directly and skips
 *  dirty-count bumps for these origins (origin lives in the closure
 *  of that listener — see syncController.startSyncBackgroundLoop).
 *  Local actions tag their transacts with sessionId / actionLabel —
 *  none of those collide with these reserved strings. */
export const REMOTE_ORIGIN = 'remote';
export const OPFS_ORIGIN = 'opfs';

let observerAttached = false;
function attachObservers(doc: YDoc): void {
  if (observerAttached) return;
  // Single document-wide subscriber. Fires once per top-level
  // transaction; we re-derive the whole flat state from the doc and
  // hand it to zustand. This is O(N) over current entity counts but
  // those are small enough (hundreds to low thousands) that it's
  // negligible in practice. Origin-aware logic (echo prevention) is
  // NOT done here — the sync layer attaches its own afterTransaction
  // listener via getYDoc() so the origin is closure-bound rather
  // than threaded through a fragile module-scoped global.
  doc.on('afterTransaction', () => {
    const flat = readFlatStateFromDoc(doc);
    useStore.setState((prev) => ({
      ...prev,
      ...stateFromFlat(flat),
    }));
    schedulePersist();
  });
  observerAttached = true;
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow().catch((err) => {
      console.warn('[storeYjs] persist failed:', err);
    });
  }, SAVE_DEBOUNCE_MS);
}

async function persistNow(): Promise<void> {
  const doc = getYDoc();
  const update = encodeDocAsUpdate(doc);
  const meta: DryjMeta = {
    snapshotId: cryptoUUID(),
    deviceId: 'local', // Real deviceId comes from identity layer in sync controller; persistence-only meta is local-only and not authoritative.
    deviceLabel: 'local',
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
  };
  const bytes = encodeDryj(meta, update);
  await saveYDocBytes(bytes);
}

function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Note id with a stable prefix so the entity is grep-friendly in
 *  exported `.dryj` blobs. ERD §14.3. */
function newNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function stateFromFlat(flat: FlatState): Omit<DayRailState, 'ready' | 'error' | 'sessions' | 'pendingShiftPrompt' | 'v05MigrationApplied'> {
  const profileEntity = (flat.userProfile as Record<string, unknown>)[USER_PROFILE_ID];
  const userProfile: UserProfile | null =
    profileEntity && typeof profileEntity === 'object'
      ? (profileEntity as UserProfile)
      : null;
  return {
    templates: flat.templates as Record<TemplateKey, Template>,
    rails: flat.rails as Record<string, Rail>,
    signals: flat.signals as Record<string, Signal>,
    shifts: flat.shifts as Record<string, Shift>,
    lines: flat.lines as Record<string, Line>,
    tasks: flat.tasks as Record<string, Task>,
    taskOccurrences: flat.taskOccurrences as Record<string, TaskOccurrence>,
    adhocEvents: flat.adhocEvents as Record<string, AdhocEvent>,
    calendarRules: flat.calendarRules as Record<string, CalendarRule>,
    cycles: flat.cycles as Record<string, Cycle>,
    habitPhases: flat.habitPhases as Record<string, HabitPhase>,
    reflections: flat.dailyReflections as Record<string, DailyReflection>,
    habitBindings: flat.habitBindings as Record<string, HabitBinding>,
    userDayNotes: flat.userDayNotes as Record<string, UserDayNote>,
    userProfile,
    railRevisions: flat.railRevisions as Record<string, RailRevision[]>,
    templateRevisions: flat.templateRevisions as Record<TemplateKey, TemplateRevision[]>,
    calendarRuleRevisions: flat.calendarRuleRevisions as Record<string, CalendarRuleRevision[]>,
    habitBindingRevisions: flat.habitBindingRevisions as Record<string, HabitBindingRevision[]>,
    railTombstones: flat.railTombstones as Record<string, Tombstone>,
    templateTombstones: flat.templateTombstones as Record<TemplateKey, Tombstone>,
    calendarRuleTombstones: flat.calendarRuleTombstones as Record<string, Tombstone>,
    habitBindingTombstones: flat.habitBindingTombstones as Record<string, Tombstone>,
  };
}

// ============ Sync layer hand-off ============

/** Used by the sync controller's pull path. Decodes `.dryj` bytes
 *  and applies the embedded Yjs update to the local Y.Doc. Yjs's
 *  internal LWW + Lamport clock handles convergence; the observer
 *  re-derives flat state and zustand setState fires, so no reload
 *  is required. */
export function applyRemoteUpdate(dryjBytes: Uint8Array): void {
  const decoded = decodeDryj(dryjBytes);
  // Tag the transaction so the dirty-tracking subscriber in
  // syncController skips bumping the dirty cursor — otherwise the
  // store observer's setState would convince syncController this is
  // a user-authored change and schedule an echo push 60s later.
  Y.applyUpdate(getYDoc(), decoded.update, REMOTE_ORIGIN);
}

/** Apply a `.dryj` that the user supplied locally (Settings → Backup
 *  history → 恢复, "Import from snapshot" in-place flow, etc.). The
 *  intent is "treat this as if I authored these merges locally" —
 *  unlike applyRemoteUpdate, the dirty cursor SHOULD bump so the
 *  next debounced push sweeps the merged state up to Drive. The
 *  origin is a non-reserved string so syncController's afterTransaction
 *  listener doesn't filter it. */
export function applyImportedUpdate(dryjBytes: Uint8Array): void {
  const decoded = decodeDryj(dryjBytes);
  Y.applyUpdate(getYDoc(), decoded.update, 'imported');
}

/** "First device joining an existing Drive canonical" path: clear
 *  every top-level Y.Map, then apply the remote update. Distinct
 *  from applyRemoteUpdate (which CRDT-merges into existing local
 *  state) — `replaceFromRemote` is for when the user explicitly
 *  wants the remote to BE their state, not be merged with what
 *  happens to be locally seeded.
 *
 *  Use case: user installed v0.7 fresh on a new device, the app
 *  seeded sample templates / rails / Inbox, then they connected
 *  Drive. Without this, "Pull from cloud" CRDT-merges samples with
 *  the user's actual cloud data, and the next push uploads the
 *  union — polluting Drive with samples for every other device. */
export function replaceFromRemote(dryjBytes: Uint8Array): void {
  const decoded = decodeDryj(dryjBytes);
  const doc = getYDoc();
  doc.transact(() => {
    for (const name of TOP_LEVEL_MAPS) {
      doc.getMap(name).clear();
    }
    // Apply remote inside the same transact so observers see one
    // atomic transition rather than "wipe → empty → restore"
    // intermediate states.
    Y.applyUpdate(doc, decoded.update, REMOTE_ORIGIN);
  }, REMOTE_ORIGIN);
}

/** Used by the sync controller's push path. */
export function exportYDocAsUpdate(): Uint8Array {
  return encodeDocAsUpdate(getYDoc());
}

// ============ Hydrate ============

async function hydrateImpl(): Promise<void> {
  // 1. Get (or lazy-create) the singleton Y.Doc and load OPFS bytes
  //    onto it.
  const doc = getYDoc();
  const bytes = await loadYDocBytes().catch(() => null);
  if (bytes) {
    try {
      const decoded = decodeDryj(bytes);
      Y.applyUpdate(doc, decoded.update, OPFS_ORIGIN);
    } catch (err) {
      console.warn(
        '[store] failed to decode OPFS state, starting fresh:',
        err,
      );
    }
  }
  // 2. Attach the document-wide observer so subsequent transacts
  //    (including the very first action call after boot) re-derive
  //    flat state and trigger debounced persistence. Idempotent.
  attachObservers(doc);

  // 3. ERD §10.6 v0.11 — one-shot subItems → TaskOccurrence migration +
  //    orphan GC. Both are idempotent (see runOccurrencesMigration);
  //    safe to run on every hydrate. Wrapped in a single transact tagged
  //    with the OPFS_ORIGIN so syncController doesn't push an echo for
  //    pure migration writes.
  runOccurrencesMigration(doc);

  // 4. Derive flat state and seed zustand.
  const flat = readFlatStateFromDoc(doc);
  useStore.setState((prev) => ({
    ...prev,
    ...stateFromFlat(flat),
    ready: true,
    v05MigrationApplied: true, // No-op in v0.7; see file header.
  }));
}

/** ERD §10.6 v0.11 cross-version migration. Runs at every hydrate.
 *  Two passes inside one transact:
 *
 *    1. **subItems → TaskOccurrence**. For each Task with non-empty
 *       `subItems`, create one occurrence per subItem if absent. The
 *       occurrence id is derived `occ-{taskId}-{subItemId}` so re-runs
 *       (or runs after an older client appended new subItems) idempotently
 *       fill in only what's missing. We do NOT delete `Task.subItems`
 *       — older clients may still write to that field, and the new
 *       client dual-reads (subItems + occurrences) so writes from older
 *       peers stay visible.
 *
 *    2. **Orphan GC**. Drop any occurrence whose `taskId` no longer
 *       exists in `state.tasks`. The original Task may have been hard-
 *       deleted by an older client (which doesn't know about
 *       `taskOccurrences`); leftover occurrences would render as
 *       phantom rows otherwise.
 *
 *  Tagged origin `'occMigration'` so the dirty-tracking subscriber in
 *  syncController can be configured to skip echo pushes for pure-
 *  migration writes if needed. Currently it falls through to the
 *  normal user-authored path (debounced 8s push), which is acceptable —
 *  migrating once per device push isn't user-visible noise. */
function runOccurrencesMigration(doc: YDoc): void {
  doc.transact(() => {
    const tasksMap = getEntityMap(doc, 'tasks');
    const occMap = getEntityMap(doc, 'taskOccurrences');

    // Build a set of existing taskIds for orphan GC.
    const taskIds = new Set<string>();
    tasksMap.forEach((_value, id) => {
      taskIds.add(id);
    });

    // Pass 1 — subItems migration. Iterate every Task; for each
    // subItem that doesn't already have a corresponding occurrence id,
    // create one.
    tasksMap.forEach((value, taskId) => {
      if (!(value instanceof Y.Map)) return;
      const taskYMap = value as YMap<unknown>;
      const subItems = taskYMap.get('subItems');
      if (!Array.isArray(subItems)) return;
      for (let i = 0; i < subItems.length; i++) {
        const sub = subItems[i] as
          | { id?: unknown; title?: unknown; done?: unknown }
          | null
          | undefined;
        if (!sub || typeof sub !== 'object') continue;
        const subId = typeof sub.id === 'string' ? sub.id : null;
        const subTitle = typeof sub.title === 'string' ? sub.title : '';
        const subDone = sub.done === true;
        if (subId === null) continue;
        const occId = `occ-${taskId}-${subId}`;
        if (occMap.has(occId)) continue;
        const occ: TaskOccurrence = {
          id: occId,
          taskId,
          label: subTitle,
          status: subDone ? 'done' : 'pending',
          order: i,
        };
        occMap.set(
          occId,
          entityToYMap(occ as unknown as Record<string, unknown>),
        );
      }
    });

    // Pass 2 — orphan GC.
    const orphanIds: string[] = [];
    occMap.forEach((value, occId) => {
      if (!(value instanceof Y.Map)) {
        orphanIds.push(occId);
        return;
      }
      const tId = (value as YMap<unknown>).get('taskId');
      if (typeof tId !== 'string' || !taskIds.has(tId)) {
        orphanIds.push(occId);
      }
    });
    for (const id of orphanIds) occMap.delete(id);
  }, 'occMigration');
}

// ============ Y.Doc write helpers ============

function getEntityMap(doc: YDoc, name: string): YMap<unknown> {
  return doc.getMap(name) as YMap<unknown>;
}

function upsertEntity(
  doc: YDoc,
  mapName: string,
  id: string,
  entity: Record<string, unknown>,
  arrayFields: ReadonlyArray<string> = [],
): void {
  const map = getEntityMap(doc, mapName);
  const existing = map.get(id);
  if (existing instanceof Y.Map) {
    patchEntityYMap(existing as YMap<unknown>, entity, arrayFields);
  } else {
    map.set(id, entityToYMap(entity, arrayFields));
  }
}

function deleteEntity(doc: YDoc, mapName: string, id: string): void {
  getEntityMap(doc, mapName).delete(id);
}

/** ERD §6.6 / §14.2 — patch the singleton `userProfile` Y.Map.
 *  Creates the entity on first write. Use for any UserProfile field
 *  that should ride the Y.Doc sync stream. */
function patchUserProfile(doc: YDoc, patch: Partial<UserProfile>): void {
  const map = getEntityMap(doc, 'userProfile');
  const existing = map.get(USER_PROFILE_ID);
  if (existing instanceof Y.Map) {
    patchEntityYMap(existing as YMap<unknown>, patch as Record<string, unknown>);
  } else {
    map.set(
      USER_PROFILE_ID,
      entityToYMap(patch as unknown as Record<string, unknown>),
    );
  }
}

function appendRevision(
  doc: YDoc,
  mapName: string,
  parentId: string,
  revision: Record<string, unknown>,
): void {
  const map = getEntityMap(doc, mapName);
  let arr = map.get(parentId);
  if (!(arr instanceof Y.Array)) {
    arr = new Y.Array<unknown>();
    map.set(parentId, arr);
  }
  // Same-(entity, effectiveFrom) replacement: drop any prior entry
  // with the same id, then append. Mirrors store.ts's
  // upsertRevisionInArray semantics (id schema makes same-day
  // re-edits collide on id, so we replace in place).
  const yarr = arr as YArray<unknown>;
  const revs = yarr.toArray() as Array<{ id?: string }>;
  const idx = revs.findIndex((r) => r?.id === revision['id']);
  if (idx >= 0) yarr.delete(idx, 1);
  yarr.push([revision]);
}

function setTombstone(
  doc: YDoc,
  mapName: string,
  parentId: string,
  tomb: Tombstone,
): void {
  getEntityMap(doc, mapName).set(parentId, { ...tomb });
}

function clearTombstone(doc: YDoc, mapName: string, parentId: string): void {
  getEntityMap(doc, mapName).delete(parentId);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ulidLite(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** ERD §10.6 v0.11 adoption-edge helper. Called from
 *  `addTaskOccurrence` / `updateTaskOccurrence` / `scheduleTaskOccurrence`
 *  whenever an occurrence is about to gain a slot or percent (= Task
 *  is about to enter occurrence-managed mode for the first time).
 *  When the host Task currently has a legacy `Task.slot` AND none of
 *  its sibling occurrences carry slot/percent yet, fold that slot
 *  into a fresh sibling occurrence and clear `Task.slot`. Result:
 *  the Today/Cycle scheduling visible before the user's edit is
 *  preserved as a label-less / percent-less occurrence, no surprise
 *  data loss when the rendering surface flips. Idempotent — re-runs
 *  short-circuit because subsequent calls find a slot-bearing
 *  occurrence already present.
 *
 *  Caller must already be inside a doc.transact. The `triggeringOcc`
 *  parameter is the occurrence Y.Map driving the adoption (excluded
 *  from the "any sibling already managed?" scan). */
function maybeConvertLegacyTaskSlot(
  doc: YDoc,
  triggeringOcc: YMap<unknown>,
): void {
  const taskId = triggeringOcc.get('taskId');
  if (typeof taskId !== 'string') return;
  const tasksMap = getEntityMap(doc, 'tasks');
  const taskYMap = tasksMap.get(taskId);
  if (!(taskYMap instanceof Y.Map)) return;
  const legacySlot = (taskYMap as YMap<unknown>).get('slot');
  if (legacySlot == null || typeof legacySlot !== 'object') return;
  // Already in occurrence-managed mode? Some sibling carries slot or
  // percent — leave the legacy slot alone (it's already being ignored
  // by selectors via isOccurrenceManaged).
  const occMap = getEntityMap(doc, 'taskOccurrences');
  let alreadyManaged = false;
  occMap.forEach((value, occId) => {
    if (alreadyManaged) return;
    if (!(value instanceof Y.Map)) return;
    if ((value as YMap<unknown>).get('taskId') !== taskId) return;
    if (occId === triggeringOcc.get('id')) return;
    const slotVal = (value as YMap<unknown>).get('slot');
    const pctVal = (value as YMap<unknown>).get('percent');
    if (slotVal != null || pctVal != null) alreadyManaged = true;
  });
  if (alreadyManaged) return;
  // Fold legacy slot into a fresh occurrence at a high `order` so it
  // sits after the existing checklist items.
  let maxOrder = -1;
  occMap.forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    if ((value as YMap<unknown>).get('taskId') !== taskId) return;
    const o = (value as YMap<unknown>).get('order');
    if (typeof o === 'number' && o > maxOrder) maxOrder = o;
  });
  const conv: TaskOccurrence = {
    id: ulidLite('occ'),
    taskId,
    slot: legacySlot as TaskOccurrence['slot'],
    status: 'pending',
    order: maxOrder + 1,
  };
  occMap.set(
    conv.id,
    entityToYMap(conv as unknown as Record<string, unknown>),
  );
  (taskYMap as YMap<unknown>).delete('slot');
}

// ============ Revision builders ============
//
// Mirrors the runtime revision builders in store.ts:875-942. The id
// schema `rev-{kind}-{entityId}-{effectiveFrom}` makes same-day
// re-edits replace in place via appendRevision's id-collision check.

function buildRailRevisionY(
  rail: Rail,
  effectiveFrom: string,
  sessionId: string | undefined,
): RailRevision {
  return {
    id: `rev-rail-${rail.id}-${effectiveFrom}`,
    railId: rail.id,
    effectiveFrom,
    templateKey: rail.templateKey,
    name: rail.name,
    ...(rail.subtitle !== undefined && { subtitle: rail.subtitle }),
    startMinutes: rail.startMinutes,
    durationMinutes: rail.durationMinutes,
    color: rail.color,
    ...(rail.icon !== undefined && { icon: rail.icon }),
    showInCheckin: rail.showInCheckin,
    authoredAt: Date.now(),
    ...(sessionId && { sessionId }),
  };
}

function buildTemplateRevisionY(
  tpl: Template,
  effectiveFrom: string,
  sessionId: string | undefined,
): TemplateRevision {
  return {
    id: `rev-template-${tpl.key}-${effectiveFrom}`,
    templateKey: tpl.key,
    effectiveFrom,
    name: tpl.name,
    ...(tpl.color !== undefined && { color: tpl.color }),
    authoredAt: Date.now(),
    ...(sessionId && { sessionId }),
  };
}

function buildCalendarRuleRevisionY(
  rule: CalendarRule,
  effectiveFrom: string,
  sessionId: string | undefined,
): CalendarRuleRevision {
  return {
    id: `rev-calrule-${rule.id}-${effectiveFrom}`,
    ruleId: rule.id,
    effectiveFrom,
    priority: rule.priority,
    value: rule.value,
    authoredAt: Date.now(),
    ...(sessionId && { sessionId }),
  };
}

function buildHabitBindingRevisionY(
  binding: HabitBinding,
  effectiveFrom: string,
  sessionId: string | undefined,
): HabitBindingRevision {
  return {
    id: `rev-hbinding-${binding.id}-${effectiveFrom}`,
    bindingId: binding.id,
    effectiveFrom,
    habitId: binding.habitId,
    railId: binding.railId,
    ...(binding.weekdays !== undefined && { weekdays: binding.weekdays }),
    authoredAt: Date.now(),
    ...(sessionId && { sessionId }),
  };
}

// Calendar rule helpers — mirror the constants in store.ts. Pre-v0.8.1
// table; the new `external-event` kind has no fallback priority since
// it only exists in v0.8.1+ where calendarRuleOrder is authoritative.
const CALENDAR_RULE_PRIORITY_Y: Record<
  Exclude<CalendarRule['kind'], 'external-event'>,
  number
> = {
  'single-date': 100,
  'date-range': 50,
  cycle: 30,
  weekday: 10,
};

function singleDateRuleIdY(date: string): string {
  return `cr-single-${date}`;
}

// ============ userProfile.calendarRuleOrder helpers (v0.8.1) ============
//
// Persisted as a string[] field on the userProfile singleton Y.Map.
// Maintaining it from the action layer (rather than UI-side) keeps
// the store layer responsible for "every rule has a position" and
// gives the resolver a single read path. The CRDT semantics here are
// last-writer-wins on the array — concurrent reorders on two devices
// resolve via Yjs internal LWW + Lamport clock; that's acceptable
// since rule-priority changes are infrequent and the worst-case
// outcome is the user's ordering reverting one drop, not data loss.

function readCalendarRuleOrderY(doc: YDoc): string[] {
  const profile = getEntityMap(doc, 'userProfile').get(USER_PROFILE_ID);
  if (!(profile instanceof Y.Map)) return [];
  const raw = (profile as YMap<unknown>).get('calendarRuleOrder');
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function writeCalendarRuleOrderY(doc: YDoc, order: string[]): void {
  const map = getEntityMap(doc, 'userProfile');
  const existing = map.get(USER_PROFILE_ID);
  if (existing instanceof Y.Map) {
    patchEntityYMap(existing as YMap<unknown>, {
      calendarRuleOrder: [...order],
    });
  } else {
    map.set(
      USER_PROFILE_ID,
      entityToYMap({
        calendarRuleOrder: [...order],
      } as Record<string, unknown>),
    );
  }
}

/** Idempotent: if `ruleId` is already in the list, no-op. New ids
 *  prepend so the user's most-recent intent wins by default. */
function prependToCalendarRuleOrderY(doc: YDoc, ruleId: string): void {
  const current = readCalendarRuleOrderY(doc);
  if (current.includes(ruleId)) return;
  writeCalendarRuleOrderY(doc, [ruleId, ...current]);
}

/** Strip a deleted rule's id out of the priority list. */
function removeFromCalendarRuleOrderY(doc: YDoc, ruleId: string): void {
  const current = readCalendarRuleOrderY(doc);
  if (!current.includes(ruleId)) return;
  writeCalendarRuleOrderY(
    doc,
    current.filter((id) => id !== ruleId),
  );
}

function addDaysIsoY(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Persist a Shift to Y.Doc and queue the same record on
 *  pendingShiftPrompt so the §5.5.6 Reason toast can surface.
 *  Mirrors the legacy persistShiftAndQueuePrompt helper in store.ts. */
function persistShiftAndQueuePromptY(
  taskId: string,
  type: ShiftType,
  payload: ReschedulePayload | UnschedulePayload,
  sessionId?: string,
): void {
  const doc = getYDoc();
  const shiftId = ulidLite('shift');
  const at = new Date().toISOString();
  const shift: Shift = {
    id: shiftId,
    taskId,
    type,
    at,
    payload: payload as unknown as Record<string, unknown>,
    tags: [],
  };
  // sessionId threads into the transact origin below so the session's
  // Y.UndoManager rolls this shift back as part of undoEditSession.
  // The persisted Shift record itself does NOT carry sessionId today
  // (Shift type has no such field). If a future "which session
  // authored this shift" surface needs it, extend Shift in types.ts
  // and round-trip the field through both the Y.Map upsert below and
  // the pendingShiftPrompt setState.
  doc.transact(() => {
    upsertEntity(doc, 'shifts', shiftId, {
      id: shiftId,
      taskId,
      type,
      at,
      payload: payload as unknown as Record<string, unknown>,
      tags: [],
    });
  }, sessionId ?? 'persistShiftAndQueuePrompt');
  useStore.setState((prev) => ({
    ...prev,
    pendingShiftPrompt: {
      ...shift,
      payload: { ...shift.payload },
      ...(shift.tags && { tags: [...shift.tags] }),
    },
  }));
}

// ============ Zustand store ============

const initialState: DayRailState = {
  ready: false,
  templates: {},
  rails: {},
  signals: {},
  shifts: {},
  lines: {},
  tasks: {},
  taskOccurrences: {},
  adhocEvents: {},
  calendarRules: {},
  cycles: {},
  habitPhases: {},
  reflections: {},
  habitBindings: {},
  userDayNotes: {},
  userProfile: null,
  railRevisions: {},
  templateRevisions: {},
  calendarRuleRevisions: {},
  habitBindingRevisions: {},
  railTombstones: {},
  templateTombstones: {},
  calendarRuleTombstones: {},
  habitBindingTombstones: {},
  v05MigrationApplied: true,
  sessions: {},
  pendingShiftPrompt: null,
};

const notImplemented = (action: string): never => {
  throw new Error(
    `[storeYjs] ${action} not yet implemented in v0.7 — fall back to legacy store.ts via @dayrail/core/store`,
  );
};

export const useStore = create<DayRailStore>()((_set, get) => ({
  ...initialState,

  hydrate: hydrateImpl,

  // ============ Templates ============

  // Legacy: store.ts:1775 — appendEvent(template.created/updated) +
  // applyEventInPlace + emitTemplateRevision + tombstone-clear.
  upsertTemplate: async (tpl, sessionId, effectiveFrom) => {
    // sessionId is used as the transact origin so per-session
    // Y.UndoManager (set up in openEditSession) can track and roll
    // back this operation. When undefined, falls back to the action
    // label — operations outside any session aren't tracked.
    const doc = getYDoc();
    doc.transact(() => {
      // Mirror current-state map.
      upsertEntity(doc, 'templates', tpl.key, {
        key: tpl.key,
        name: tpl.name,
        ...(tpl.color !== undefined && { color: tpl.color }),
        isDefault: tpl.isDefault ?? false,
      });
      // Append revision (effectiveFrom default = today).
      const ef = effectiveFrom ?? todayIso();
      appendRevision(
        doc,
        'templateRevisions',
        tpl.key,
        { ...buildTemplateRevisionY({ ...tpl }, ef, sessionId) } as Record<
          string,
          unknown
        >,
      );
      // Resurrect: clear any tombstone.
      const tombs = getEntityMap(doc, 'templateTombstones');
      if (tombs.has(tpl.key)) clearTombstone(doc, 'templateTombstones', tpl.key);
    }, sessionId ?? 'upsertTemplate');
  },

  // Legacy: store.ts:1804 — cascade-delete dependent rails (each with
  // tombstone), then template.deleted, then template tombstone.
  deleteTemplate: async (key, sessionId, effectiveFrom) => {
    const doc = getYDoc();
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      // Cascade rails belonging to this template.
      const railsMap = getEntityMap(doc, 'rails');
      const railIds: string[] = [];
      railsMap.forEach((value, id) => {
        if (value instanceof Y.Map) {
          const rail = value as YMap<unknown>;
          if (rail.get('templateKey') === key) railIds.push(id);
        }
      });
      for (const railId of railIds) {
        deleteEntity(doc, 'rails', railId);
        setTombstone(doc, 'railTombstones', railId, {
          effectiveFrom: ef,
          at: Date.now(),
          ...(sessionId && { sessionId }),
        });
      }
      // Delete template + tombstone.
      deleteEntity(doc, 'templates', key);
      setTombstone(doc, 'templateTombstones', key, {
        effectiveFrom: ef,
        at: Date.now(),
        ...(sessionId && { sessionId }),
      });
    }, sessionId ?? 'deleteTemplate');
  },

  // ============ Rails ============

  // Legacy: store.ts:1839
  createRail: async (rail, sessionId, effectiveFrom) => {
    const doc = getYDoc();
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      upsertEntity(doc, 'rails', rail.id, { ...rail });
      appendRevision(
        doc,
        'railRevisions',
        rail.id,
        { ...buildRailRevisionY({ ...rail }, ef, sessionId) } as Record<
          string,
          unknown
        >,
      );
      const tombs = getEntityMap(doc, 'railTombstones');
      if (tombs.has(rail.id)) clearTombstone(doc, 'railTombstones', rail.id);
    }, sessionId ?? 'createRail');
  },

  // Legacy: store.ts:1864
  updateRail: async (id, patch, sessionId, effectiveFrom) => {
    const doc = getYDoc();
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      const map = getEntityMap(doc, 'rails');
      const existing = map.get(id);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, { ...patch });
      // Revision uses the post-patch value.
      const merged = {
        id,
        ...((existing as YMap<unknown>).toJSON() as Record<string, unknown>),
      } as Rail;
      appendRevision(
        doc,
        'railRevisions',
        id,
        { ...buildRailRevisionY(merged, ef, sessionId) } as Record<
          string,
          unknown
        >,
      );
    }, sessionId ?? 'updateRail');
  },

  // Legacy: store.ts:1880
  deleteRail: async (id, sessionId, effectiveFrom) => {
    const doc = getYDoc();
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      deleteEntity(doc, 'rails', id);
      setTombstone(doc, 'railTombstones', id, {
        effectiveFrom: ef,
        at: Date.now(),
        ...(sessionId && { sessionId }),
      });
    }, sessionId ?? 'deleteRail');
  },

  // ============ Daily reflections ============

  // Legacy: store.ts → setReflection. Empty content drops the row.
  setReflection: async (date, content) => {
    const doc = getYDoc();
    const trimmed = content.trim();
    doc.transact(() => {
      if (trimmed.length === 0) {
        deleteEntity(doc, 'dailyReflections', date);
      } else {
        upsertEntity(doc, 'dailyReflections', date, {
          date,
          content,
          updatedAt: Date.now(),
        });
      }
    }, 'setReflection');
  },

  // ============ ERD §14.3 · User day notes ============

  upsertUserDayNote: async ({ id, date, label, color }) => {
    const doc = getYDoc();
    const noteId = id ?? newNoteId();
    const now = Date.now();
    doc.transact(() => {
      const map = getEntityMap(doc, 'userDayNotes');
      const existing = map.get(noteId);
      if (existing instanceof Y.Map) {
        // Update path — preserve createdAt, bump updatedAt.
        patchEntityYMap(existing as YMap<unknown>, {
          date,
          label,
          color,
          updatedAt: now,
        });
      } else {
        // Create path.
        const note: UserDayNote = {
          id: noteId,
          date,
          label,
          ...(color !== undefined && { color }),
          createdAt: now,
          updatedAt: now,
        };
        map.set(noteId, entityToYMap(note as unknown as Record<string, unknown>));
      }
    }, 'upsertUserDayNote');
    return noteId;
  },

  removeUserDayNote: async (id) => {
    const doc = getYDoc();
    doc.transact(() => {
      deleteEntity(doc, 'userDayNotes', id);
    }, 'removeUserDayNote');
  },

  // ============ ERD §14.2 / §6.6.1 · User profile ============

  setEnabledHolidayRegions: async (regions) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'userProfile');
      const existing = map.get(USER_PROFILE_ID);
      if (existing instanceof Y.Map) {
        patchEntityYMap(existing as YMap<unknown>, {
          enabledHolidayRegions: [...regions],
        });
      } else {
        const profile: UserProfile = {
          enabledHolidayRegions: [...regions],
        };
        map.set(
          USER_PROFILE_ID,
          entityToYMap(profile as unknown as Record<string, unknown>),
        );
      }
    }, 'setEnabledHolidayRegions');
  },

  // ============ ERD §6.6 v0.8.2 · AI MVP user-profile fields ============
  //
  // Four "settings inside the channel" — Y.Doc sync stream.
  // `aiApiKey` is intentionally NOT here (browser localStorage only,
  // see `apps/web/src/lib/aiApiKey.ts`); see ERD §6.6 "userProfile
  // field-split policy" for the credential vs setting dichotomy.

  setAiEnabled: async (enabled) => {
    const doc = getYDoc();
    doc.transact(() => {
      patchUserProfile(doc, { aiEnabled: enabled });
    }, 'setAiEnabled');
  },

  setAiBaseUrl: async (baseUrl) => {
    const doc = getYDoc();
    doc.transact(() => {
      patchUserProfile(doc, { aiBaseUrl: baseUrl });
    }, 'setAiBaseUrl');
  },

  setAiModel: async (model) => {
    const doc = getYDoc();
    doc.transact(() => {
      patchUserProfile(doc, { aiModel: model });
    }, 'setAiModel');
  },

  setUserBackground: async (background) => {
    const doc = getYDoc();
    doc.transact(() => {
      patchUserProfile(doc, { background });
    }, 'setUserBackground');
  },

  setDailyReflectionAiObservation: async (date, observation) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'dailyReflections');
      const existing = map.get(date);
      // UX gate enforces "reflection.content non-empty before AI call"
      // upstream; defensive no-op here when the row is missing so we
      // never create a half-formed reflection without `content`.
      if (existing instanceof Y.Map) {
        patchEntityYMap(existing as YMap<unknown>, {
          lastAiObservation: observation,
        });
      }
    }, 'setDailyReflectionAiObservation');
  },

  setCycleAiObservation: async (cycleId, observation) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'cycles');
      const existing = map.get(cycleId);
      if (existing instanceof Y.Map) {
        patchEntityYMap(existing as YMap<unknown>, {
          lastAiObservation: observation,
        });
      }
    }, 'setCycleAiObservation');
  },

  // ============ TODO — to be translated in subsequent commits ============
  //
  // Each stub below points to its legacy implementation. The
  // translation pattern is identical to the actions above:
  //   - open ydoc.transact
  //   - mirror what applyEventInPlace does (set / delete / cascade)
  //   - emit revision/tombstone via the helpers when the legacy
  //     impl called emitRailRevision / emitTemplateTombstone / etc.
  //   - return; the observer derives state and triggers persistence.

  // ============ Signals + Shifts ============

  // Legacy: store.ts:1895 — append signal.acted with ulid id.
  recordSignal: async (taskId, response, surface) => {
    const doc = getYDoc();
    const id = ulidLite('sig');
    const actedAt = new Date().toISOString();
    doc.transact(() => {
      upsertEntity(doc, 'signals', id, {
        id,
        taskId,
        actedAt,
        response,
        surface,
      });
    }, 'recordSignal');
  },

  // Legacy: store.ts:1919 — append shift.recorded. Note: pendingShiftPrompt
  // is UI-only state; the legacy reducer set it as a side-effect of
  // shift.recorded with `payload`/`tags` cloned. v0.7 keeps the same
  // semantic: synced shifts go to Y.Doc, pendingShiftPrompt is set
  // directly on zustand for the toast handoff.
  recordShift: async (shift) => {
    const doc = getYDoc();
    doc.transact(() => {
      upsertEntity(doc, 'shifts', shift.id, {
        id: shift.id,
        taskId: shift.taskId,
        type: shift.type,
        at: shift.at,
        payload: shift.payload ?? {},
        ...(shift.tags !== undefined && { tags: shift.tags }),
        ...(shift.reason !== undefined && { reason: shift.reason }),
      });
    }, 'recordShift');
    useStore.setState((prev) => ({
      ...prev,
      pendingShiftPrompt: {
        ...shift,
        payload: { ...shift.payload },
        ...(shift.tags && { tags: [...shift.tags] }),
      },
    }));
  },

  // Legacy: store.ts:1931 — merge tags into the Shift's tag list.
  // NOT commutative across devices: Shift.tags is a plain JS array
  // stored as an atomic LWW value (yjs.ts schema header), so
  // concurrent setShiftTags calls on two devices each read prevTags,
  // compute distinct merges locally, write atomically — Yjs picks
  // one writer's result by Lamport order, dropping the other side's
  // additions. Acceptable for v0.7's single-user / occasional-multi-
  // device target where two devices simultaneously tagging the same
  // overdue Shift is vanishingly rare. If this ever bites, migrate
  // `Shift.tags` to a Y.Array via Y_ARRAY_FIELDS in yjs.ts and
  // emit per-tag insert ops here instead of the read-modify-write.
  setShiftTags: async (shiftId, tags) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'shifts');
      const existing = map.get(shiftId);
      if (!(existing instanceof Y.Map)) return;
      const current = existing.get('tags');
      const prevTags = Array.isArray(current) ? (current as string[]) : [];
      const merged = Array.from(new Set([...prevTags, ...tags]));
      (existing as YMap<unknown>).set('tags', merged);
    }, 'setShiftTags');
  },

  // Legacy: store.ts:1943 — UI flag clear, no Y.Doc write.
  ackShiftPrompt: (shiftId) => {
    useStore.setState((prev) =>
      prev.pendingShiftPrompt?.id === shiftId
        ? { ...prev, pendingShiftPrompt: null }
        : prev,
    );
  },

  // ============ Lines ============

  // Legacy: store.ts:1953
  createLine: async (line, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      upsertEntity(doc, 'lines', line.id, { ...line });
    }, sessionId ?? 'createLine');
  },

  // Legacy: store.ts:1963
  updateLine: async (id, patch) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'lines');
      const existing = map.get(id);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, { ...patch });
    }, 'updateLine');
  },

  // Legacy: store.ts:1978 — Inbox is undeletable; status patch.
  deleteLine: async (id) => {
    const doc = getYDoc();
    const map = getEntityMap(doc, 'lines');
    const existing = map.get(id);
    if (!(existing instanceof Y.Map)) return;
    if ((existing as YMap<unknown>).get('isDefault') === true) return;
    doc.transact(() => {
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'deleted',
        deletedAt: Date.now(),
      });
    }, 'deleteLine');
  },

  // Legacy: store.ts:1992 — restore to active, clear timestamps.
  restoreLine: async (id) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'lines');
      const existing = map.get(id);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'active',
        deletedAt: undefined,
        archivedAt: undefined,
      });
    }, 'restoreLine');
  },

  // Legacy: store.ts:2002 — purge + cascade tasks belonging to the Line.
  purgeLine: async (id) => {
    const doc = getYDoc();
    const linesMap = getEntityMap(doc, 'lines');
    const existing = linesMap.get(id);
    if (!(existing instanceof Y.Map)) return;
    if ((existing as YMap<unknown>).get('isDefault') === true) return;
    doc.transact(() => {
      // Cascade: drop tasks whose lineId matches.
      const tasksMap = getEntityMap(doc, 'tasks');
      const cascade: string[] = [];
      tasksMap.forEach((value, taskId) => {
        if (value instanceof Y.Map) {
          const t = value as YMap<unknown>;
          if (t.get('lineId') === id) cascade.push(taskId);
        }
      });
      for (const tid of cascade) tasksMap.delete(tid);
      linesMap.delete(id);
    }, 'purgeLine');
  },

  // ============ Tasks ============

  // Legacy: store.ts:2017. subItems is plain LWW (see yjs.ts file
  // header for why per-element CRDT was reverted).
  createTask: async (task, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      upsertEntity(doc, 'tasks', task.id, { ...task });
    }, sessionId ?? 'createTask');
  },

  // Legacy: store.ts:2029. subItems patch is whole-list replacement.
  updateTask: async (id, patch, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'tasks');
      const existing = map.get(id);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, { ...patch });
    }, sessionId ?? 'updateTask');
  },

  // Legacy: store.ts:2041 · v0.11+ ERD §10.6 D7: when occurrences exist,
  // cascade archive to all pending / in-progress occurrences (NOT
  // 'done', preserving "I never actually did them" truth on the ones
  // the user already finished).
  archiveTask: async (id) => {
    const doc = getYDoc();
    const archivedAtIso = new Date().toISOString();
    doc.transact(() => {
      const map = getEntityMap(doc, 'tasks');
      const existing = map.get(id);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'archived',
        archivedAt: archivedAtIso,
      });
      // ERD §10.6 v0.11 D7 cascade — only fires in occurrence-managed
      // mode. For pure-checklist (pre-adoption) tasks, archiving the
      // Task simply hides the task per the legacy semantics; the
      // checklist occurrences ride along (no separate scheduling state
      // to clean up). For occurrence-managed tasks, archive any
      // pending sibling occurrence so it stops surfacing in
      // Today/Cycle/Pending.
      const occMap = getEntityMap(doc, 'taskOccurrences');
      let manageMode = false;
      occMap.forEach((value) => {
        if (manageMode) return;
        if (!(value instanceof Y.Map)) return;
        if ((value as YMap<unknown>).get('taskId') !== id) return;
        const slotVal = (value as YMap<unknown>).get('slot');
        const pctVal = (value as YMap<unknown>).get('percent');
        if (slotVal != null || pctVal != null) manageMode = true;
      });
      if (!manageMode) return;
      occMap.forEach((value) => {
        if (!(value instanceof Y.Map)) return;
        const occ = value as YMap<unknown>;
        if (occ.get('taskId') !== id) return;
        if (occ.get('status') === 'archived' || occ.get('status') === 'done') {
          return;
        }
        patchEntityYMap(occ, {
          status: 'archived',
          archivedAt: archivedAtIso,
        });
      });
    }, 'archiveTask');
  },

  // Legacy: store.ts:2052 — restore to pending, clear timestamps.
  restoreTask: async (id) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'tasks');
      const existing = map.get(id);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'pending',
        archivedAt: undefined,
        deletedAt: undefined,
      });
    }, 'restoreTask');
  },

  // Legacy: store.ts:2065
  deleteTask: async (id) => {
    const doc = getYDoc();
    doc.transact(() => {
      const map = getEntityMap(doc, 'tasks');
      const existing = map.get(id);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'deleted',
        deletedAt: new Date().toISOString(),
      });
    }, 'deleteTask');
  },

  // Legacy: store.ts:2076 — hard delete from the map.
  purgeTask: async (id, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      deleteEntity(doc, 'tasks', id);
    }, sessionId ?? 'purgeTask');
  },

  // Legacy: store.ts:2521 — idempotent on existing id.
  upsertAutoTask: async (task) => {
    const doc = getYDoc();
    const tasksMap = getEntityMap(doc, 'tasks');
    if (tasksMap.has(task.id)) return;
    doc.transact(() => {
      upsertEntity(doc, 'tasks', task.id, { ...task });
    }, 'upsertAutoTask');
  },

  // ============ ERD §10.6 v0.11 · Task occurrences ============

  addTaskOccurrence: async (taskId, partial, sessionId) => {
    const doc = getYDoc();
    const occId = ulidLite('occ');
    doc.transact(() => {
      const tasksMap = getEntityMap(doc, 'tasks');
      const taskYMap = tasksMap.get(taskId);
      if (!(taskYMap instanceof Y.Map)) return;

      const occMap = getEntityMap(doc, 'taskOccurrences');
      // Count this task's existing occurrences and detect whether any
      // of them carry a slot/percent (i.e., the Task is already in
      // occurrence-managed mode per §10.6 adoption gate).
      let existingCount = 0;
      let alreadyManaged = false;
      occMap.forEach((value) => {
        if (!(value instanceof Y.Map)) return;
        if ((value as YMap<unknown>).get('taskId') !== taskId) return;
        existingCount++;
        const slotVal = (value as YMap<unknown>).get('slot');
        const pctVal = (value as YMap<unknown>).get('percent');
        if (slotVal != null || pctVal != null) alreadyManaged = true;
      });

      let baseOrder = existingCount;

      // Adoption-edge conversion (§10.6 Q1 boundary): if this newly-
      // created occurrence will itself be slot/percent-bearing AND the
      // Task is not yet in occurrence-managed mode AND Task.slot is
      // currently set, convert that legacy slot into a label-less /
      // percent-less occurrence in the same transaction. Without this,
      // the user's existing scheduling on the Task would silently
      // disappear from Today/Cycle the moment they add their first
      // slot-bearing occurrence.
      const willAdopt =
        partial?.slot != null || partial?.percent != null;
      const legacySlot = (taskYMap as YMap<unknown>).get('slot');
      if (
        willAdopt &&
        !alreadyManaged &&
        legacySlot != null &&
        typeof legacySlot === 'object'
      ) {
        const conv: TaskOccurrence = {
          id: ulidLite('occ'),
          taskId,
          slot: legacySlot as TaskOccurrence['slot'],
          status: 'pending',
          order: baseOrder,
        };
        occMap.set(
          conv.id,
          entityToYMap(conv as unknown as Record<string, unknown>),
        );
        (taskYMap as YMap<unknown>).delete('slot');
        baseOrder += 1;
      }

      const occ: TaskOccurrence = {
        id: occId,
        taskId,
        status: 'pending',
        ...(partial?.label !== undefined && { label: partial.label }),
        ...(partial?.percent !== undefined && { percent: partial.percent }),
        ...(partial?.slot !== undefined && { slot: partial.slot }),
        order: partial?.order ?? baseOrder,
        ...(partial?.status !== undefined && { status: partial.status }),
        ...(partial?.doneAt !== undefined && { doneAt: partial.doneAt }),
      };
      occMap.set(
        occId,
        entityToYMap(occ as unknown as Record<string, unknown>),
      );
    }, sessionId ?? 'addTaskOccurrence');
    return occId;
  },

  updateTaskOccurrence: async (occurrenceId, patch, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      const occMap = getEntityMap(doc, 'taskOccurrences');
      const existing = occMap.get(occurrenceId);
      if (!(existing instanceof Y.Map)) return;
      // Adoption-edge conversion: if this update is the first time
      // *any* of this Task's occurrences gain a slot or percent (i.e.,
      // the Task is transitioning out of pure-checklist mode), and
      // Task.slot is set, fold that legacy slot into a fresh slot-
      // bearing occurrence so the Today/Cycle scheduling visible
      // before the update isn't silently dropped.
      const willAdopt =
        (patch.slot !== undefined && patch.slot !== null) ||
        (patch.percent !== undefined && patch.percent !== null);
      if (willAdopt) {
        maybeConvertLegacyTaskSlot(doc, existing as YMap<unknown>);
      }
      patchEntityYMap(existing as YMap<unknown>, { ...patch });
    }, sessionId ?? 'updateTaskOccurrence');
  },

  completeTaskOccurrence: async (occurrenceId, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      const occMap = getEntityMap(doc, 'taskOccurrences');
      const existing = occMap.get(occurrenceId);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'done',
        doneAt: new Date().toISOString(),
      });
    }, sessionId ?? 'completeTaskOccurrence');
  },

  reopenTaskOccurrence: async (occurrenceId, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      const occMap = getEntityMap(doc, 'taskOccurrences');
      const existing = occMap.get(occurrenceId);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'pending',
        doneAt: undefined,
      });
    }, sessionId ?? 'reopenTaskOccurrence');
  },

  archiveTaskOccurrence: async (occurrenceId, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      const occMap = getEntityMap(doc, 'taskOccurrences');
      const existing = occMap.get(occurrenceId);
      if (!(existing instanceof Y.Map)) return;
      patchEntityYMap(existing as YMap<unknown>, {
        status: 'archived',
        archivedAt: new Date().toISOString(),
      });
    }, sessionId ?? 'archiveTaskOccurrence');
  },

  removeTaskOccurrence: async (occurrenceId, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      deleteEntity(doc, 'taskOccurrences', occurrenceId);
    }, sessionId ?? 'removeTaskOccurrence');
  },

  scheduleTaskOccurrence: async (occurrenceId, slot, sessionId) => {
    const doc = getYDoc();
    doc.transact(() => {
      const occMap = getEntityMap(doc, 'taskOccurrences');
      const existing = occMap.get(occurrenceId);
      if (!(existing instanceof Y.Map)) return;
      if (slot == null) {
        (existing as YMap<unknown>).delete('slot');
      } else {
        // Adoption-edge: scheduling an occurrence may flip the Task
        // into occurrence-managed mode for the first time; fold legacy
        // Task.slot into a sibling occurrence beforehand so it survives.
        maybeConvertLegacyTaskSlot(doc, existing as YMap<unknown>);
        patchEntityYMap(existing as YMap<unknown>, { slot });
      }
    }, sessionId ?? 'scheduleTaskOccurrence');
  },

  // ============ Ad-hoc events ============

  // Legacy: store.ts:2536 — standalone (no taskId), status='active'.
  createAdhocEvent: async (opts) => {
    const id = ulidLite('adhoc');
    const doc = getYDoc();
    doc.transact(() => {
      upsertEntity(doc, 'adhocEvents', id, {
        id,
        date: opts.date,
        name: opts.name,
        startMinutes: opts.startMinutes,
        durationMinutes: opts.durationMinutes,
        status: 'active',
        ...(opts.color && { color: opts.color }),
        ...(opts.lineId && { lineId: opts.lineId }),
      });
    }, 'createAdhocEvent');
    return id;
  },

  // Legacy: store.ts:2558 — refuses task-backed; soft-delete others.
  deleteAdhocEvent: async (id) => {
    const doc = getYDoc();
    const map = getEntityMap(doc, 'adhocEvents');
    const existing = map.get(id);
    if (!(existing instanceof Y.Map)) return;
    const ad = existing as YMap<unknown>;
    if (ad.get('taskId')) {
      throw new Error(
        '不能直接删除绑定 Task 的 Ad-hoc 事件 —— 去 Tasks 视图把任务移出自由时间排期。',
      );
    }
    if (ad.get('status') === 'deleted') return;
    doc.transact(() => {
      patchEntityYMap(ad, {
        status: 'deleted',
        deletedAt: new Date().toISOString(),
      });
    }, 'deleteAdhocEvent');
  },

  // ============ Calendar rules ============

  // Legacy: store.ts:2256 — single-date rule keyed `cr-single-{date}`.
  overrideCycleDay: async (date, templateKey, sessionId, effectiveFrom) => {
    const doc = getYDoc();
    const id = singleDateRuleIdY(date);
    const map = getEntityMap(doc, 'calendarRules');
    const existing = map.get(id);
    if (existing instanceof Y.Map) {
      const value = (existing as YMap<unknown>).get('value') as
        | { templateKey?: string }
        | undefined;
      if (value?.templateKey === templateKey) return;
    }
    const rule: CalendarRule = {
      id,
      kind: 'single-date',
      priority: CALENDAR_RULE_PRIORITY_Y['single-date'],
      value: { date, templateKey },
      createdAt:
        existing instanceof Y.Map
          ? ((existing as YMap<unknown>).get('createdAt') as number) ??
            Date.now()
          : Date.now(),
    };
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      upsertEntity(doc, 'calendarRules', id, { ...rule });
      appendRevision(
        doc,
        'calendarRuleRevisions',
        id,
        { ...buildCalendarRuleRevisionY(rule, ef, sessionId) } as Record<
          string,
          unknown
        >,
      );
      // v0.8.1 — every new rule joins the user's priority list at the
      // top by default. Idempotent for re-overrides on the same date
      // (single-date rule id is deterministic per date).
      prependToCalendarRuleOrderY(doc, id);
    }, sessionId ?? 'overrideCycleDay');
  },

  // Legacy: store.ts:2283
  clearCycleDayOverride: async (date, sessionId, effectiveFrom) => {
    const doc = getYDoc();
    const id = singleDateRuleIdY(date);
    const map = getEntityMap(doc, 'calendarRules');
    if (!map.has(id)) return;
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      deleteEntity(doc, 'calendarRules', id);
      setTombstone(doc, 'calendarRuleTombstones', id, {
        effectiveFrom: ef,
        at: Date.now(),
        ...(sessionId && { sessionId }),
      });
      removeFromCalendarRuleOrderY(doc, id);
    }, sessionId ?? 'clearCycleDayOverride');
  },

  // Legacy: store.ts:2298 — one rule per template, deterministic id.
  upsertWeekdayRule: async (templateKey, weekdays, effectiveFrom) => {
    const doc = getYDoc();
    const id = `cr-weekday-${templateKey}`;
    const ef = effectiveFrom ?? todayIso();
    const existing = getEntityMap(doc, 'calendarRules').get(id);
    const createdAt =
      existing instanceof Y.Map
        ? ((existing as YMap<unknown>).get('createdAt') as number) ??
          Date.now()
        : Date.now();
    const rule: CalendarRule = {
      id,
      kind: 'weekday',
      priority: CALENDAR_RULE_PRIORITY_Y.weekday,
      value: { templateKey, weekdays: [...weekdays].sort() },
      createdAt,
    };
    doc.transact(() => {
      upsertEntity(doc, 'calendarRules', id, { ...rule });
      appendRevision(
        doc,
        'calendarRuleRevisions',
        id,
        { ...buildCalendarRuleRevisionY(rule, ef, undefined) } as Record<
          string,
          unknown
        >,
      );
      prependToCalendarRuleOrderY(doc, id);
    }, 'upsertWeekdayRule');
  },

  // Legacy: store.ts:2320
  upsertDateRangeRule: async ({ id, from, to, templateKey, label, effectiveFrom }) => {
    const doc = getYDoc();
    const ruleId = id ?? ulidLite('cr-range');
    const ef = effectiveFrom ?? todayIso();
    const existing = id
      ? getEntityMap(doc, 'calendarRules').get(id)
      : undefined;
    const createdAt =
      existing instanceof Y.Map
        ? ((existing as YMap<unknown>).get('createdAt') as number) ??
          Date.now()
        : Date.now();
    const rule: CalendarRule = {
      id: ruleId,
      kind: 'date-range',
      priority: CALENDAR_RULE_PRIORITY_Y['date-range'],
      value: { from, to, templateKey, ...(label && { label }) },
      createdAt,
    };
    doc.transact(() => {
      upsertEntity(doc, 'calendarRules', ruleId, { ...rule });
      appendRevision(
        doc,
        'calendarRuleRevisions',
        ruleId,
        { ...buildCalendarRuleRevisionY(rule, ef, undefined) } as Record<
          string,
          unknown
        >,
      );
      prependToCalendarRuleOrderY(doc, ruleId);
    }, 'upsertDateRangeRule');
    return ruleId;
  },

  // Legacy: store.ts:2346
  upsertCycleRule: async ({ id, cycleLength, anchor, mapping, effectiveFrom }) => {
    const doc = getYDoc();
    const ruleId = id ?? ulidLite('cr-cycle');
    const ef = effectiveFrom ?? todayIso();
    const existing = id
      ? getEntityMap(doc, 'calendarRules').get(id)
      : undefined;
    const createdAt =
      existing instanceof Y.Map
        ? ((existing as YMap<unknown>).get('createdAt') as number) ??
          Date.now()
        : Date.now();
    const rule: CalendarRule = {
      id: ruleId,
      kind: 'cycle',
      priority: CALENDAR_RULE_PRIORITY_Y.cycle,
      value: { cycleLength, anchor, mapping: [...mapping] },
      createdAt,
    };
    doc.transact(() => {
      upsertEntity(doc, 'calendarRules', ruleId, { ...rule });
      appendRevision(
        doc,
        'calendarRuleRevisions',
        ruleId,
        { ...buildCalendarRuleRevisionY(rule, ef, undefined) } as Record<
          string,
          unknown
        >,
      );
      prependToCalendarRuleOrderY(doc, ruleId);
    }, 'upsertCycleRule');
    return ruleId;
  },

  // Legacy: store.ts:2368
  removeCalendarRule: async (id, effectiveFrom) => {
    const doc = getYDoc();
    if (!getEntityMap(doc, 'calendarRules').has(id)) return;
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      deleteEntity(doc, 'calendarRules', id);
      setTombstone(doc, 'calendarRuleTombstones', id, {
        effectiveFrom: ef,
        at: Date.now(),
      });
      // Keep the user's priority order tidy — remove the deleted rule
      // id so the drawer doesn't render a phantom drag handle.
      removeFromCalendarRuleOrderY(doc, id);
    }, 'removeCalendarRule');
  },

  // ERD §5.4 v0.8.1
  upsertExternalEventRule: async ({
    id,
    kinds,
    regions,
    noteLabelFilter,
    templateKey,
    label,
    effectiveFrom,
  }) => {
    const doc = getYDoc();
    const ruleId = id ?? ulidLite('cr-ext');
    const ef = effectiveFrom ?? todayIso();
    const existing = id
      ? getEntityMap(doc, 'calendarRules').get(id)
      : undefined;
    const createdAt =
      existing instanceof Y.Map
        ? ((existing as YMap<unknown>).get('createdAt') as number) ??
          Date.now()
        : Date.now();
    const trimmedNoteQuery = noteLabelFilter?.query.trim() ?? '';
    const value: CalendarRuleExternalEvent = {
      kinds: [...kinds],
      ...(regions && regions.length > 0 && { regions: [...regions] }),
      // Persist noteLabelFilter only when the user actually entered
      // a non-empty query — an empty filter is equivalent to "match
      // any note" and should not waste storage / clutter the rule
      // summary.
      ...(noteLabelFilter && trimmedNoteQuery.length > 0 && {
        noteLabelFilter: {
          mode: noteLabelFilter.mode,
          query: trimmedNoteQuery,
        },
      }),
      templateKey,
      ...(label !== undefined && label.trim().length > 0 && { label }),
    };
    const rule: CalendarRule = {
      id: ruleId,
      kind: 'external-event',
      value,
      createdAt,
      // Note: no `priority` set — v0.8.1 leaves that field undefined
      // and lets userProfile.calendarRuleOrder decide precedence.
    };
    doc.transact(() => {
      upsertEntity(doc, 'calendarRules', ruleId, { ...rule });
      appendRevision(
        doc,
        'calendarRuleRevisions',
        ruleId,
        {
          ...buildCalendarRuleRevisionY(rule, ef, undefined),
        } as Record<string, unknown>,
      );
      // First write of this rule id → prepend to the user's priority
      // list so the new rule wins by default. If the user already
      // dragged it elsewhere we leave their position alone.
      prependToCalendarRuleOrderY(doc, ruleId);
    }, 'upsertExternalEventRule');
    return ruleId;
  },

  setCalendarRuleOrder: async (orderedIds) => {
    const doc = getYDoc();
    doc.transact(() => {
      // Filter out ids that don't exist as rules anymore (defensive
      // against the UI passing a stale list across a tombstone).
      const ruleMap = getEntityMap(doc, 'calendarRules');
      const filtered = orderedIds.filter((id) => ruleMap.has(id));
      writeCalendarRuleOrderY(doc, filtered);
    }, 'setCalendarRuleOrder');
  },

  // ============ Cycles ============

  // Legacy: store.ts:2380 — deterministic id keyed on Monday startDate.
  // v0.8.2: optional `id` + `endDate` overrides for synthetic Month-
  // scope cycles (ERD §6.6.2). Default path unchanged.
  upsertCycle: async ({ startDate, label, id, endDate }) => {
    const doc = getYDoc();
    const cycleId = id ?? `cycle-${startDate}`;
    const computedEndDate = endDate ?? addDaysIsoY(startDate, 6);
    const existing = getEntityMap(doc, 'cycles').get(cycleId);
    const createdAt =
      existing instanceof Y.Map
        ? ((existing as YMap<unknown>).get('createdAt') as number) ??
          Date.now()
        : Date.now();
    doc.transact(() => {
      upsertEntity(doc, 'cycles', cycleId, {
        id: cycleId,
        startDate,
        endDate: computedEndDate,
        ...(label && { label }),
        createdAt,
      });
    }, 'upsertCycle');
    return cycleId;
  },

  // Legacy: store.ts:2404
  removeCycle: async (id) => {
    const doc = getYDoc();
    if (!getEntityMap(doc, 'cycles').has(id)) return;
    doc.transact(() => {
      deleteEntity(doc, 'cycles', id);
    }, 'removeCycle');
  },

  // ============ Habit phases ============

  // Legacy: store.ts:2415
  upsertHabitPhase: async ({ id, lineId, name, description, startDate }) => {
    const doc = getYDoc();
    const phaseId = id ?? ulidLite('hp');
    const existing = id
      ? getEntityMap(doc, 'habitPhases').get(id)
      : undefined;
    const createdAt =
      existing instanceof Y.Map
        ? ((existing as YMap<unknown>).get('createdAt') as number) ??
          Date.now()
        : Date.now();
    doc.transact(() => {
      upsertEntity(doc, 'habitPhases', phaseId, {
        id: phaseId,
        lineId,
        name,
        startDate,
        createdAt,
        ...(description && { description }),
      });
    }, 'upsertHabitPhase');
    return phaseId;
  },

  // Legacy: store.ts:2436
  removeHabitPhase: async (id) => {
    const doc = getYDoc();
    if (!getEntityMap(doc, 'habitPhases').has(id)) return;
    doc.transact(() => {
      deleteEntity(doc, 'habitPhases', id);
    }, 'removeHabitPhase');
  },

  // ============ Habit bindings ============

  // Legacy: store.ts:2470 — revision-bearing + tombstone-clear.
  upsertHabitBinding: async (opts, sessionId) => {
    const doc = getYDoc();
    const id = opts.id ?? ulidLite('binding');
    const ef = opts.effectiveFrom ?? todayIso();
    const existing = getEntityMap(doc, 'habitBindings').get(id);
    const createdAt =
      existing instanceof Y.Map
        ? ((existing as YMap<unknown>).get('createdAt') as number) ??
          Date.now()
        : Date.now();
    const binding: HabitBinding = {
      id,
      habitId: opts.habitId,
      railId: opts.railId,
      ...(opts.weekdays !== undefined && { weekdays: opts.weekdays }),
      createdAt,
    };
    doc.transact(() => {
      upsertEntity(doc, 'habitBindings', id, { ...binding });
      appendRevision(
        doc,
        'habitBindingRevisions',
        id,
        { ...buildHabitBindingRevisionY(binding, ef, sessionId) } as Record<
          string,
          unknown
        >,
      );
      const tombs = getEntityMap(doc, 'habitBindingTombstones');
      if (tombs.has(id)) clearTombstone(doc, 'habitBindingTombstones', id);
    }, sessionId ?? 'upsertHabitBinding');
    return id;
  },

  // Legacy: store.ts:2507
  removeHabitBinding: async (id, sessionId, effectiveFrom) => {
    const doc = getYDoc();
    if (!getEntityMap(doc, 'habitBindings').has(id)) return;
    const ef = effectiveFrom ?? todayIso();
    doc.transact(() => {
      deleteEntity(doc, 'habitBindings', id);
      setTombstone(doc, 'habitBindingTombstones', id, {
        effectiveFrom: ef,
        at: Date.now(),
        ...(sessionId && { sessionId }),
      });
    }, sessionId ?? 'removeHabitBinding');
  },

  // ============ Task scheduling ============

  // Legacy: store.ts:2090. Capture prior state BEFORE the transact,
  // mutate inside, then post-mutation check whether to emit a
  // §5.5.6 reschedule Shift.
  scheduleTaskToRail: async (taskId, slot, sessionId) => {
    const doc = getYDoc();
    const priorState = useStore.getState();
    const priorTask = priorState.tasks[taskId];
    // ERD §10.6 v0.11.5 — `Task.slot` is ignored when the Task has
    // occurrences (occurrence-managed mode). Writing it here would be
    // a silent dead-end: the field gets persisted but every read path
    // skips it. Throw so any caller forgetting the UI guard surfaces
    // the bug immediately instead of confusing the user.
    const occs = selectOccurrencesForTask(priorState, taskId);
    if (isOccurrenceManaged(occs)) {
      throw new Error(
        `scheduleTaskToRail: Task ${taskId} is occurrence-managed; schedule its occurrences via scheduleTaskOccurrence instead.`,
      );
    }
    const priorSlot = priorTask?.slot;
    const priorAdhoc = Object.values(priorState.adhocEvents).find(
      (a) => a.taskId === taskId && a.status === 'active',
    );
    const isAutoHabit = priorTask?.source === 'auto-habit';
    const wasDeferred = priorTask?.status === 'deferred';

    doc.transact(() => {
      // Drop any active free-time Ad-hoc backing this task — the two
      // scheduling modes are mutually exclusive.
      const adhocsMap = getEntityMap(doc, 'adhocEvents');
      adhocsMap.forEach((value, adhocId) => {
        if (!(value instanceof Y.Map)) return;
        const ad = value as YMap<unknown>;
        if (ad.get('taskId') === taskId && ad.get('status') === 'active') {
          patchEntityYMap(ad, {
            status: 'deleted',
            deletedAt: new Date().toISOString(),
          });
          void adhocId;
        }
      });
      // Bind the slot.
      const tasksMap = getEntityMap(doc, 'tasks');
      const taskYMap = tasksMap.get(taskId);
      if (taskYMap instanceof Y.Map) {
        patchEntityYMap(taskYMap as YMap<unknown>, { slot });
        // Re-scheduling a deferred task = reverse the defer.
        if (wasDeferred) {
          patchEntityYMap(taskYMap as YMap<unknown>, {
            status: 'pending',
            deferredAt: undefined,
          });
        }
      }
    }, sessionId ?? 'scheduleTaskToRail');

    const decision = detectReschedule({
      priorSlot,
      priorAdhoc,
      nextDate: slot.date,
      todayIso: todayIso(),
      isAutoHabit,
    });
    if (decision.shouldEmit) {
      const payload: ReschedulePayload = {
        fromDate: decision.priorDate,
        toDate: slot.date,
        ...(priorSlot?.railId != null && { fromRailId: priorSlot.railId }),
        ...(priorSlot == null &&
          priorAdhoc?.id != null && { fromAdhocId: priorAdhoc.id }),
        toRailId: slot.railId,
      };
      persistShiftAndQueuePromptY(taskId, 'reschedule', payload, sessionId);
    }
  },

  // Legacy: store.ts:2161. Caller-supplied visual order; assigns
  // slotOrder = 0..N-1, skipping tasks that are already at their
  // target index.
  setSlotTaskOrder: async (slot, orderedTaskIds, sessionId) => {
    void slot;
    const doc = getYDoc();
    doc.transact(() => {
      const tasksMap = getEntityMap(doc, 'tasks');
      for (let i = 0; i < orderedTaskIds.length; i++) {
        const id = orderedTaskIds[i]!;
        const taskYMap = tasksMap.get(id);
        if (!(taskYMap instanceof Y.Map)) continue;
        const t = taskYMap as YMap<unknown>;
        if (t.get('status') === 'deleted') continue;
        if (t.get('slotOrder') === i) continue;
        t.set('slotOrder', i);
      }
    }, sessionId ?? 'setSlotTaskOrder');
  },

  // Legacy: store.ts:2173. Switches a task to free-time scheduling:
  // creates or updates an Ad-hoc event keyed to this task, clears any
  // Rail slot the task previously had.
  scheduleTaskFreeTime: async (taskId, opts) => {
    const doc = getYDoc();
    const priorState = useStore.getState();
    const priorTask = priorState.tasks[taskId];
    const priorSlot = priorTask?.slot;
    const priorAdhoc = Object.values(priorState.adhocEvents).find(
      (a) => a.taskId === taskId && a.status === 'active',
    );
    const isAutoHabit = priorTask?.source === 'auto-habit';
    const wasDeferred = priorTask?.status === 'deferred';

    let nextAdhocId: string;
    if (priorAdhoc) {
      nextAdhocId = priorAdhoc.id;
    } else {
      nextAdhocId = `adhoc-${taskId}-${Date.now().toString(36)}`;
    }

    doc.transact(() => {
      const tasksMap = getEntityMap(doc, 'tasks');
      const taskYMap = tasksMap.get(taskId);
      if (taskYMap instanceof Y.Map) {
        // Clear Rail slot if present (modes A and B mutually exclusive).
        if ((taskYMap as YMap<unknown>).has('slot')) {
          (taskYMap as YMap<unknown>).delete('slot');
        }
      }
      const adhocsMap = getEntityMap(doc, 'adhocEvents');
      if (priorAdhoc) {
        const existing = adhocsMap.get(priorAdhoc.id);
        if (existing instanceof Y.Map) {
          patchEntityYMap(existing as YMap<unknown>, {
            date: opts.date,
            startMinutes: opts.startMinutes,
            durationMinutes: opts.durationMinutes,
          });
        }
      } else {
        upsertEntity(doc, 'adhocEvents', nextAdhocId, {
          id: nextAdhocId,
          date: opts.date,
          startMinutes: opts.startMinutes,
          durationMinutes: opts.durationMinutes,
          name: priorTask?.title ?? 'Task',
          ...(priorTask?.lineId && { lineId: priorTask.lineId }),
          taskId,
          status: 'active',
        });
      }
      if (wasDeferred && taskYMap instanceof Y.Map) {
        patchEntityYMap(taskYMap as YMap<unknown>, {
          status: 'pending',
          deferredAt: undefined,
        });
      }
    }, 'scheduleTaskFreeTime');

    const decision = detectReschedule({
      priorSlot,
      priorAdhoc,
      nextDate: opts.date,
      todayIso: todayIso(),
      isAutoHabit,
    });
    if (decision.shouldEmit) {
      const payload: ReschedulePayload = {
        fromDate: decision.priorDate,
        toDate: opts.date,
        ...(priorSlot?.railId != null && { fromRailId: priorSlot.railId }),
        ...(priorSlot == null &&
          priorAdhoc?.id != null && { fromAdhocId: priorAdhoc.id }),
        toAdhocId: nextAdhocId,
      };
      persistShiftAndQueuePromptY(taskId, 'reschedule', payload);
    }
  },

  // Legacy: store.ts:2583. Removes whichever schedule the task has;
  // conditionally emits a §5.5.6 unschedule Shift on overdue clears.
  unscheduleTask: async (taskId, sessionId) => {
    const doc = getYDoc();
    const priorState = useStore.getState();
    const priorTask = priorState.tasks[taskId];
    const priorSlot = priorTask?.slot;
    const priorAdhoc = Object.values(priorState.adhocEvents).find(
      (a) => a.taskId === taskId && a.status === 'active',
    );
    const isAutoHabit = priorTask?.source === 'auto-habit';
    let touched = false;

    doc.transact(() => {
      const tasksMap = getEntityMap(doc, 'tasks');
      const taskYMap = tasksMap.get(taskId);
      if (taskYMap instanceof Y.Map) {
        if ((taskYMap as YMap<unknown>).has('slot')) {
          (taskYMap as YMap<unknown>).delete('slot');
          touched = true;
        }
      }
      const adhocsMap = getEntityMap(doc, 'adhocEvents');
      adhocsMap.forEach((value, adhocId) => {
        if (!(value instanceof Y.Map)) return;
        const ad = value as YMap<unknown>;
        if (ad.get('taskId') === taskId && ad.get('status') === 'active') {
          patchEntityYMap(ad, {
            status: 'deleted',
            deletedAt: new Date().toISOString(),
          });
          touched = true;
          void adhocId;
        }
      });
    }, sessionId ?? 'unscheduleTask');

    if (touched) {
      const decision = detectUnschedule({
        priorSlot,
        priorAdhoc,
        todayIso: todayIso(),
        isAutoHabit,
      });
      if (decision.shouldEmit) {
        const payload: UnschedulePayload = {
          fromDate: decision.priorDate,
          ...(priorSlot?.railId != null && { fromRailId: priorSlot.railId }),
          ...(priorSlot == null &&
            priorAdhoc?.id != null && { fromAdhocId: priorAdhoc.id }),
        };
        persistShiftAndQueuePromptY(taskId, 'unschedule', payload, sessionId);
      }
    }
  },

  // ============ Sessions ============
  //
  // v0.7 sessions: each open session creates a Y.UndoManager that
  // tracks Y.Doc operations whose origin matches the sessionId. Every
  // session-aware action (upsertTemplate, createTask, scheduleTask*,
  // etc.) calls `doc.transact(..., sessionId ?? actionLabel)` so its
  // operations are captured by the manager.
  //
  // undoEditSession loops um.undo() until the undo stack is empty,
  // returning the number of stack items rolled back. Then it closes
  // the session record and clears the manager from the registry.
  //
  // Behavior delta vs legacy event-log undo: equivalent for the
  // common case (one user edits in one session, hits Cancel, all
  // operations roll back). Edge case difference: Yjs's undo manages
  // per-Y.Doc state, not events; concurrently-pulled remote changes
  // applied during a session are NOT subject to session undo (legacy
  // event log would have replayed them either way after a session
  // rollback). Acceptable for v0.7's single-user workload.

  openEditSession: async (surface) => {
    const sessionId = ulidLite('sess');
    const now = Date.now();
    const session: EditSession = {
      id: sessionId,
      surface,
      openedAt: now,
      lastActivityAt: now,
      changeCount: 0,
      closed: false,
    };
    const doc = getYDoc();
    const scope = TOP_LEVEL_MAPS.map((name) => doc.getMap(name));
    const um = new Y.UndoManager(
      scope as unknown as Y.AbstractType<unknown>[],
      {
        trackedOrigins: new Set([sessionId]),
        // -1 disables time-based capture coalescing — every transact
        // becomes its own undo step, so the stack length matches the
        // number of operations the session accumulated. We loop undo()
        // until empty regardless, but explicit stepping keeps the
        // behavior predictable if a future caller wants partial undo.
        captureTimeout: -1,
      },
    );
    sessionUndoManagers.set(sessionId, um);
    useStore.setState((prev) => ({
      ...prev,
      sessions: { ...prev.sessions, [sessionId]: session },
    }));
    return session;
  },

  closeEditSession: async (sessionId) => {
    const um = sessionUndoManagers.get(sessionId);
    if (um) {
      um.destroy();
      sessionUndoManagers.delete(sessionId);
    }
    useStore.setState((prev) => {
      if (!prev.sessions[sessionId]) return prev;
      const next = { ...prev.sessions };
      delete next[sessionId];
      return { ...prev, sessions: next };
    });
  },

  undoEditSession: async (sessionId) => {
    const um = sessionUndoManagers.get(sessionId);
    if (!um) return 0;
    let count = 0;
    // undo() returns the rolled-back StackItem or null on empty stack.
    while (um.undo() != null) count++;
    um.destroy();
    sessionUndoManagers.delete(sessionId);
    useStore.setState((prev) => {
      if (!prev.sessions[sessionId]) return prev;
      const next = { ...prev.sessions };
      delete next[sessionId];
      return { ...prev, sessions: next };
    });
    return count;
  },
}));

// Keyed by sessionId; lifecycle managed by openEditSession /
// closeEditSession / undoEditSession.
const sessionUndoManagers = new Map<string, Y.UndoManager>();

// ============ Calendar rule resolution (preserved from legacy store.ts) ============

import { calendarRuleRevisionsActiveOn } from './revisions';

/** Deterministic id for a `single-date` CalendarRule. Flipping the same
 *  day's template repeatedly resolves to an upsert on one row, not a
 *  growing pile of same-day rules. */
export function singleDateRuleId(date: string): string {
  return `cr-single-${date}`;
}

/** Pre-v0.8.1 hardcoded priorities per CalendarRule kind. Kept around
 *  for back-compat reads of legacy rules that still carry the field;
 *  v0.8.1 writes leave `priority` undefined and let the user-controlled
 *  `UserProfile.calendarRuleOrder` decide precedence (§5.4). New
 *  `external-event` kind has no fallback priority — rules of that kind
 *  exist only in v0.8.1+ where the order list is the single source of
 *  truth. */
export const CALENDAR_RULE_PRIORITY: Record<
  Exclude<CalendarRule['kind'], 'external-event'>,
  number
> = {
  'single-date': 100,
  'date-range': 50,
  cycle: 30,
  weekday: 10,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Return true iff `rule` matches `date`. The `external-event` branch
 *  needs the `userDayNotes` map and the `enabledHolidayRegions` filter
 *  to query `selectExternalEventsOn`; callers without that context
 *  (legacy non-resolver paths) should pass an empty `extCtx` and the
 *  external-event branch will return false. */
export function calendarRuleApplies(
  rule: CalendarRule,
  date: string,
  extCtx?: {
    userDayNotes: Record<string, UserDayNote>;
    enabledHolidayRegions: string[];
  },
): boolean {
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
      return v.mapping[idx] != null;
    }
    case 'external-event': {
      const v = rule.value as CalendarRuleExternalEvent;
      if (v.kinds.length === 0) return false;
      // Without a context (legacy callers / unit tests passing through
      // `calendarRuleApplies` directly) we cannot resolve external
      // events; treat as no-match rather than crashing.
      if (!extCtx) return false;
      const events = selectExternalEventsOn(date, {
        enabledHolidayRegions: extCtx.enabledHolidayRegions,
        userDayNotes: extCtx.userDayNotes,
      });
      const kindSet = new Set<ExternalEventMatchKind>(v.kinds);
      const regionFilter =
        v.regions && v.regions.length > 0 ? new Set(v.regions) : null;
      // Pre-trim the note-label query so the per-event closure does
      // a single .includes / equality check; empty query degrades to
      // "match any note".
      const noteFilter = v.noteLabelFilter;
      const noteQuery = noteFilter?.query.trim() ?? '';
      const noteFilterActive = noteFilter !== undefined && noteQuery.length > 0;
      return events.some((ev) => {
        if (!kindSet.has(ev.kind as ExternalEventMatchKind)) return false;
        // user-note has no region; rule's regions filter is silently
        // ignored for those (otherwise the user can never match notes
        // when they've also restricted regions for holidays).
        if (regionFilter && ev.regionCode) {
          if (!regionFilter.has(ev.regionCode)) return false;
        }
        // Note-label filter applies only to user-note events; other
        // kinds pass through unchanged.
        if (ev.kind === 'user-note' && noteFilterActive) {
          if (noteFilter!.mode === 'exact' && ev.label !== noteQuery) return false;
          if (
            noteFilter!.mode === 'contains' &&
            !ev.label.includes(noteQuery)
          )
            return false;
        }
        return true;
      });
    }
  }
}

/** Extract the `templateKey` a rule resolves to for the given date. */
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
    case 'external-event':
      return (rule.value as CalendarRuleExternalEvent).templateKey;
  }
}

/** Resolve the active Template for `date` by walking every
 *  CalendarRule revision active on that date.
 *
 *  v0.8.1 ordering: `userProfile.calendarRuleOrder` is the user's
 *  authoritative priority list (front = highest). Rules in the list
 *  are tried first in their listed order; rules NOT yet in the list
 *  fall back to the legacy numeric `priority` field (descending),
 *  with `createdAt` desc as final tie-breaker. This dual mode lets
 *  pre-v0.8.1 rules keep working until the user touches the
 *  rules drawer, at which point the implicit migration writes the
 *  full ordered list once and from then on the order list dominates. */
export function resolveTemplateForDate(
  state: Pick<
    DayRailState,
    'calendarRules' | 'calendarRuleRevisions' | 'calendarRuleTombstones'
  > &
    Partial<Pick<DayRailState, 'userDayNotes' | 'userProfile'>>,
  date: string,
  heuristic: (date: string) => TemplateKey | null,
): TemplateKey | null {
  const active = calendarRuleRevisionsActiveOn(state, date);
  if (active.length > 0) {
    type Slot = {
      rule: CalendarRule;
      rev: CalendarRuleRevision;
      orderIdx: number;
    };
    const order = state.userProfile?.calendarRuleOrder ?? [];
    const orderIdx = new Map<string, number>();
    order.forEach((id, i) => orderIdx.set(id, i));
    const slots: Slot[] = [];
    for (const { ruleId, revision } of active) {
      const shell = state.calendarRules[ruleId];
      if (!shell) continue;
      slots.push({
        rule: {
          ...shell,
          ...(revision.priority !== undefined && {
            priority: revision.priority,
          }),
          value: revision.value,
        },
        rev: revision,
        orderIdx: orderIdx.get(ruleId) ?? Infinity,
      });
    }
    const sorted = slots.sort((a, b) => {
      // 1. In the user's order list → ascending position (front wins).
      if (a.orderIdx !== b.orderIdx) return a.orderIdx - b.orderIdx;
      // 2. Legacy fallback: numeric priority desc.
      const aP = a.rev.priority ?? a.rule.priority ?? 0;
      const bP = b.rev.priority ?? b.rule.priority ?? 0;
      if (aP !== bP) return bP - aP;
      // 3. Final tie-breaker: createdAt desc (newest first).
      return b.rule.createdAt - a.rule.createdAt;
    });
    const extCtx = {
      userDayNotes: state.userDayNotes ?? {},
      enabledHolidayRegions:
        state.userProfile?.enabledHolidayRegions ?? [],
    };
    for (const { rule } of sorted) {
      if (!calendarRuleApplies(rule, date, extCtx)) continue;
      const tpl = calendarRuleTemplate(rule, date);
      if (tpl) return tpl;
    }
  }
  return heuristic(date);
}

// ============ One-shot selectors (preserved from legacy store.ts) ============

export function selectRailsByTemplate(state: DayRailState, key: TemplateKey): Rail[] {
  return Object.values(state.rails)
    .filter((r) => r.templateKey === key)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

export function selectTemplateList(state: DayRailState): Template[] {
  return Object.values(state.templates);
}

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

export function selectReflection(
  state: Pick<DayRailState, 'reflections'>,
  date: string,
): DailyReflection | undefined {
  return state.reflections[date];
}

export function selectHabitPhasesByLine(
  state: Pick<DayRailState, 'habitPhases'>,
  lineId: string,
): HabitPhase[] {
  return Object.values(state.habitPhases)
    .filter((p) => p.lineId === lineId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

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

export function hasMilestone(state: DayRailState, lineId: string): boolean {
  for (const t of Object.values(state.tasks)) {
    if (t.lineId !== lineId) continue;
    if (t.status === 'deleted') continue;
    if (t.milestonePercent != null) return true;
    // ERD §10.6 v0.11 — a Task with at least one occurrence carrying
    // `percent` also counts as a milestone-bearing task.
    const occs = selectOccurrencesForTask(state, t.id);
    if (occs.some((o) => o.percent != null)) return true;
  }
  return false;
}

export function selectProjectProgress(state: DayRailState, lineId: string): number {
  let max = 0;
  for (const t of Object.values(state.tasks)) {
    if (t.lineId !== lineId) continue;
    // ERD §10.6 v0.11 — fold in occurrence-driven progress. For a
    // Task with no occurrences the existing "done + milestonePercent"
    // path applies; with occurrences `deriveTaskProgress` returns the
    // max-of-done occurrence percent (also counts the legacy
    // milestonePercent as a fallback when no occurrence has percent).
    const occs = selectOccurrencesForTask(state, t.id);
    const derivedStatus = deriveTaskStatus(t, occs);
    if (derivedStatus !== 'done') continue;
    const progress = deriveTaskProgress(t, occs);
    if (progress != null && progress > max) max = progress;
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
    // ERD §10.6 v0.11 — derived status when in occurrence-managed mode;
    // legacy / pre-adoption Tasks count by their explicit task.status.
    const occs = selectOccurrencesForTask(state, t.id);
    const derived = deriveTaskStatus(t, occs);
    if (derived === 'archived' || derived === 'deleted') continue;
    if (derived === 'done') done++;
    else open++;
  }
  return { done, open, total: done + open };
}

// ============ ERD §10.6 v0.11 · occurrence selectors ============

/** All TaskOccurrences belonging to a given Task, sorted by `order`
 *  (asc, undefined → end), then by id for stability. Excludes the
 *  Task itself — caller queries `state.tasks[taskId]` separately for
 *  the title / lineId / etc. */
export function selectOccurrencesForTask(
  state: Pick<DayRailState, 'taskOccurrences'>,
  taskId: string,
): TaskOccurrence[] {
  const out: TaskOccurrence[] = [];
  for (const occ of Object.values(state.taskOccurrences)) {
    if (occ.taskId === taskId) out.push(occ);
  }
  return out.sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.id.localeCompare(b.id);
  });
}

/** Look up a single occurrence by id. */
export function selectOccurrenceById(
  state: Pick<DayRailState, 'taskOccurrences'>,
  occurrenceId: string,
): TaskOccurrence | undefined {
  return state.taskOccurrences[occurrenceId];
}

/** Occurrences placed on a specific (cycleId, date, railId) slot.
 *  Used by Today Track + Cycle View rendering to surface multi-day
 *  splits as individual rows on each day's slot. */
export function selectOccurrencesForSlot(
  state: Pick<DayRailState, 'taskOccurrences'>,
  slot: { cycleId: string; date: string; railId: string },
): TaskOccurrence[] {
  const out: TaskOccurrence[] = [];
  for (const occ of Object.values(state.taskOccurrences)) {
    if (!occ.slot) continue;
    if (
      occ.slot.cycleId === slot.cycleId &&
      occ.slot.date === slot.date &&
      occ.slot.railId === slot.railId
    ) {
      out.push(occ);
    }
  }
  return out.sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.id.localeCompare(b.id);
  });
}

export {
  INBOX_LINE_ID,
  deriveTaskStatus,
  deriveTaskProgress,
  isOccurrenceManaged,
} from './types';
