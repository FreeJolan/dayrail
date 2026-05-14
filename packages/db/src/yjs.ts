// Y.Doc schema for DayRail v0.7 (ERD §7.7) + v0.8 additions (ERD §14).
//
// Layout: top-level Y.Doc holds one Y.Map per existing store (the
// names mirror the keys on @dayrail/core's DayRailState shape so the
// store layer can derive a flat snapshot for zustand consumers via a
// per-store loop). Each entity is itself a Y.Map so field-level
// merge is the default (two devices changing different fields of the
// same Task converge silently).
//
// Array fields are stored as plain JS arrays — atomic LWW. Per-element
// CRDT semantics for `Task.subItems` was considered (Y.Array with
// per-element insert/delete/update ops) but the action layer's
// "patch the whole array" calling convention degenerates Y.Array into
// a delete-all-then-push pattern, which under concurrent edits
// produces duplicates / interleaved garbage *worse* than plain LWW.
// Until the action layer is rewritten to emit per-element ops,
// subItems sticks with whole-list LWW. Acceptable for v0.7's single-
// user workflow — the contested "two devices toggle subitems
// concurrently" case is rare and the most-recent edit wins cleanly.
//
// Revision tables (railRevisions etc.) live as Y.Map<entityId,
// Y.Array<plainRevisionObject>>. Concurrent appends on two devices
// converge via Y.Array; per-revision field edits are atomic but
// vanishingly rare in practice (revisions are append-only).
// Tombstones are Y.Map<entityId, plainTombstoneObject> — same
// rationale.
//
// Sync scope: every top-level map in this doc goes to Drive.
// `dailyReflections` is included even though v0.6 kept it local — at
// v0.7's threat model (single-user appdata scope) the device-portability
// win outweighs nothing concrete, and a partial-sync filter would
// require a Yjs sub-document split that's not worth the complexity.
// Revisit if v0.8 introduces a multi-user threat model.
//
// Wire/storage format: Y.encodeStateAsUpdate(doc) wrapped in a .dryj
// container (see dryj.ts).

import * as Y from 'yjs';

/** Top-level Y.Map names. */
export const TOP_LEVEL_MAPS = [
  'templates',
  'rails',
  'lines',
  'tasks',
  // ERD §10.6 (v0.11): scheduling atom under a Task. Top-level Y.Map
  // keyed by occurrence id (per-element CRDT). Sibling of `tasks`
  // by foreign key `taskId`. Pure additive schema — `.dryj` container
  // version unchanged; older clients ignore this map silently.
  'taskOccurrences',
  'signals',
  'shifts',
  'adhocEvents',
  'calendarRules',
  'cycles',
  'habitPhases',
  'habitBindings',
  'railRevisions',
  'templateRevisions',
  'calendarRuleRevisions',
  'habitBindingRevisions',
  'railTombstones',
  'templateTombstones',
  'calendarRuleTombstones',
  'habitBindingTombstones',
  'dailyReflections',
  // ERD §14.3: user-defined day notes. Keyed by note.id (ULID), not by
  // date — concurrent same-day creation on two devices both survive
  // (keyed-by-date would LWW one of them away).
  'userDayNotes',
  // ERD §14.2 / §6.6.1: singleton Y.Map of user-profile fields.
  // Stored as id-keyed entity at id 'singleton' so the existing
  // load/read pipeline applies unchanged. Currently holds:
  //   - enabledHolidayRegions: string[]  (v0.8.0, §14.2)
  // v0.8.1 will add: aiBaseUrl / aiApiKey / aiModel / background.
  'userProfile',
] as const;

export type TopLevelMapName = (typeof TOP_LEVEL_MAPS)[number];

/** Singleton id used for the userProfile Y.Map's only entity. */
export const USER_PROFILE_SINGLETON_ID = 'singleton';

/** Fields on each entity that should be stored as Y.Array (instead of
 *  a plain JS array atomic LWW). Currently empty — see file header
 *  for why subItems was reverted to atomic LWW. Add an entry here
 *  only after the action layer learns to emit per-element ops on the
 *  inner Y.Array. */
const Y_ARRAY_FIELDS: Record<string, ReadonlyArray<string>> = {};

/** Top-level maps holding revision arrays (Y.Map<id, Y.Array<plain>>).*/
const REVISION_MAPS: ReadonlySet<string> = new Set([
  'railRevisions',
  'templateRevisions',
  'calendarRuleRevisions',
  'habitBindingRevisions',
]);

/** Top-level maps holding tombstones as plain objects (Y.Map<id,
 *  plainTombstone>) — single-record, atomic LWW. */
const TOMBSTONE_MAPS: ReadonlySet<string> = new Set([
  'railTombstones',
  'templateTombstones',
  'calendarRuleTombstones',
  'habitBindingTombstones',
]);

/** Construct a fresh, empty Y.Doc with all top-level maps registered. */
export function createYDoc(): Y.Doc {
  const doc = new Y.Doc();
  for (const name of TOP_LEVEL_MAPS) {
    doc.getMap(name);
  }
  return doc;
}

// ============ Entity ↔ Y.Map conversion ============

/** Generic plain-object → Y.Map. Fields named in `arrayFields` are
 *  wrapped as Y.Array; all other arrays stay plain (atomic LWW). */
export function entityToYMap(
  entity: Record<string, unknown>,
  arrayFields: ReadonlyArray<string> = [],
): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(entity)) {
    if (value === undefined) continue;
    if (arrayFields.includes(key) && Array.isArray(value)) {
      const yarr = new Y.Array<unknown>();
      yarr.push(value);
      ymap.set(key, yarr);
    } else {
      ymap.set(key, value);
    }
  }
  return ymap;
}

/** Generic Y.Map → plain-object. Y.Array values become plain JS arrays. */
export function yMapToEntity<T = Record<string, unknown>>(ymap: Y.Map<unknown>): T {
  const out: Record<string, unknown> = {};
  ymap.forEach((value, key) => {
    if (value instanceof Y.Array) {
      out[key] = (value as Y.Array<unknown>).toArray();
    } else if (value instanceof Y.Map) {
      out[key] = yMapToEntity(value as Y.Map<unknown>);
    } else {
      out[key] = value;
    }
  });
  return out as T;
}

/** Apply a partial entity patch to an existing Y.Map (in-place,
 *  inside the caller's transaction). Field changes propagate
 *  individually so two devices editing different fields of the same
 *  entity converge without conflict. Use this in store actions when
 *  the entity already exists; for new entities call entityToYMap +
 *  parentMap.set. */
export function patchEntityYMap(
  ymap: Y.Map<unknown>,
  patch: Record<string, unknown>,
  arrayFields: ReadonlyArray<string> = [],
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      ymap.delete(key);
      continue;
    }
    if (arrayFields.includes(key) && Array.isArray(value)) {
      // Replace the Y.Array contents wholesale. Real "list-edit
      // operations" (add subitem, remove subitem, reorder) should
      // call Y.Array methods directly on the inner array; this is
      // the fallback for callers passing a whole new array.
      const existing = ymap.get(key);
      if (existing instanceof Y.Array) {
        const arr = existing as Y.Array<unknown>;
        if (arr.length > 0) arr.delete(0, arr.length);
        arr.push(value as unknown[]);
      } else {
        const yarr = new Y.Array<unknown>();
        yarr.push(value);
        ymap.set(key, yarr);
      }
    } else {
      ymap.set(key, value);
    }
  }
}

// ============ Top-level conversions (used by migration + hydrate) ============

/** Snapshot of a flat-shape store state (id-keyed records), used by
 *  the v0.6 → v0.7 migration script and by the @dayrail/core hydrate
 *  path. Field types are erased to `unknown` here to avoid a
 *  cyclic import on the entity types — callers in @dayrail/core cast
 *  back to their typed shapes. */
export interface FlatState {
  templates: Record<string, unknown>;
  rails: Record<string, unknown>;
  lines: Record<string, unknown>;
  tasks: Record<string, unknown>;
  taskOccurrences: Record<string, unknown>;
  signals: Record<string, unknown>;
  shifts: Record<string, unknown>;
  adhocEvents: Record<string, unknown>;
  calendarRules: Record<string, unknown>;
  cycles: Record<string, unknown>;
  habitPhases: Record<string, unknown>;
  habitBindings: Record<string, unknown>;
  railRevisions: Record<string, unknown[]>;
  templateRevisions: Record<string, unknown[]>;
  calendarRuleRevisions: Record<string, unknown[]>;
  habitBindingRevisions: Record<string, unknown[]>;
  railTombstones: Record<string, unknown>;
  templateTombstones: Record<string, unknown>;
  calendarRuleTombstones: Record<string, unknown>;
  habitBindingTombstones: Record<string, unknown>;
  dailyReflections: Record<string, unknown>;
  userDayNotes: Record<string, unknown>;
  userProfile: Record<string, unknown>;
}

/** Bulk-load a flat state snapshot into a fresh Y.Doc. Wraps the
 *  whole thing in a single transaction so the resulting update is
 *  one atomic operation. */
export function loadFlatStateIntoDoc(doc: Y.Doc, state: Partial<FlatState>): void {
  doc.transact(() => {
    for (const name of TOP_LEVEL_MAPS) {
      const submap = doc.getMap(name);
      const slice = (state as Partial<Record<string, unknown>>)[name];
      if (!slice || typeof slice !== 'object') continue;
      if (REVISION_MAPS.has(name)) {
        for (const [id, revs] of Object.entries(slice as Record<string, unknown>)) {
          if (!Array.isArray(revs)) continue;
          const yarr = new Y.Array<unknown>();
          yarr.push(revs);
          submap.set(id, yarr);
        }
      } else if (TOMBSTONE_MAPS.has(name)) {
        for (const [id, tomb] of Object.entries(slice as Record<string, unknown>)) {
          if (tomb && typeof tomb === 'object') submap.set(id, tomb);
        }
      } else {
        const arrayFields = Y_ARRAY_FIELDS[name] ?? [];
        for (const [id, entity] of Object.entries(slice as Record<string, unknown>)) {
          if (entity && typeof entity === 'object') {
            submap.set(id, entityToYMap(entity as Record<string, unknown>, arrayFields));
          }
        }
      }
    }
  }, 'loadFlatStateIntoDoc');
}

/** Concurrent appends on two devices can both call
 *  `appendRevision(arr, rev)` for the same `rev.id` — the helper's
 *  in-place find/delete/push is idempotent against the *local* view
 *  only. After the merge each device's Y.Array carries both copies
 *  (same `id`, possibly different `authoredAt`). Dedupe at read time
 *  by `id`, keeping the entry with the latest `authoredAt`.
 *
 *  Caveat: same-id revisions are NOT guaranteed to encode the same
 *  content — two devices each running `updateRail(id, patchA)` and
 *  `updateRail(id, patchB)` against their local view of the rail's
 *  Y.Map produce two RailRevisions with the same id but different
 *  bodies. The live state's field-level CRDT merge is fine
 *  (entities are Y.Maps, fields converge). What's lost is *revision
 *  history fidelity* — "what did this rail look like on date X"
 *  returns the latest-authored device's body, not the merged truth.
 *  For a single-user occasional-multi-device app this is acceptable;
 *  if a real multi-user revision-history surface ever ships, the
 *  schema needs a non-deterministic id (e.g. include deviceId) so
 *  concurrent appends preserve both bodies. */
function dedupRevisions(revs: unknown[]): unknown[] {
  const byId = new Map<string, { rev: unknown; authoredAt: number }>();
  const orderedIds: string[] = [];
  for (const r of revs) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : null;
    if (id === null) continue;
    const authoredAt = typeof obj.authoredAt === 'number' ? obj.authoredAt : 0;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { rev: r, authoredAt });
      orderedIds.push(id);
    } else if (authoredAt > prev.authoredAt) {
      byId.set(id, { rev: r, authoredAt });
    }
  }
  return orderedIds.map((id) => byId.get(id)!.rev);
}

/** Read the entire Y.Doc into a flat state snapshot — the shape the
 *  @dayrail/core zustand store consumes. Called on hydrate and on
 *  every Y.Doc observe (to refresh the derived store). */
export function readFlatStateFromDoc(doc: Y.Doc): FlatState {
  const out: FlatState = {
    templates: {},
    rails: {},
    lines: {},
    tasks: {},
    taskOccurrences: {},
    signals: {},
    shifts: {},
    adhocEvents: {},
    calendarRules: {},
    cycles: {},
    habitPhases: {},
    habitBindings: {},
    railRevisions: {},
    templateRevisions: {},
    calendarRuleRevisions: {},
    habitBindingRevisions: {},
    railTombstones: {},
    templateTombstones: {},
    calendarRuleTombstones: {},
    habitBindingTombstones: {},
    dailyReflections: {},
    userDayNotes: {},
    userProfile: {},
  };
  for (const name of TOP_LEVEL_MAPS) {
    const submap = doc.getMap(name);
    const target = (out as unknown as Record<string, Record<string, unknown>>)[name]!;
    if (REVISION_MAPS.has(name)) {
      submap.forEach((value, id) => {
        if (value instanceof Y.Array) {
          (target as Record<string, unknown[]>)[id] = dedupRevisions(
            (value as Y.Array<unknown>).toArray(),
          );
        }
      });
    } else if (TOMBSTONE_MAPS.has(name)) {
      submap.forEach((value, id) => {
        if (value && typeof value === 'object' && !(value instanceof Y.AbstractType)) {
          target[id] = value;
        }
      });
    } else {
      submap.forEach((value, id) => {
        if (value instanceof Y.Map) {
          target[id] = yMapToEntity(value as Y.Map<unknown>);
        }
      });
    }
  }
  return out;
}

/** Encode the doc for Drive upload / OPFS persistence. v0.7 syncs
 *  everything in the Y.Doc — see file header for the threat-model
 *  rationale. */
export function encodeDocAsUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
