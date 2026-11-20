// Conflict resolution helpers (ERD §7.8 P3).
//
// When the smart-diff classifier returns `true-conflict`, the user
// picks a side per field via SyncConflictPanel. This module turns
// those picks into actual Y.Doc mutations, then triggers the push.
//
// Resolution algorithm:
//
// 1. Apply remoteBytes to the live local Y.Doc via Y.applyUpdate
//    (the same CRDT merge v0.7 used). This union-merges orthogonal
//    changes from both sides. For CONFLICTING map fields the merge
//    outcome is arbitrary: Yjs resolves concurrent Y.Map writes to
//    the same key by clientID (the item integrated right-most wins),
//    NOT by "whichever update was applied last" — and clientIDs are
//    random per Y.Doc instance, so either side can win. Deleted
//    entities stay deleted (Yjs deletions are monotonic).
//
// 2. For EVERY conflict, explicitly write the user's chosen value
//    (remote picks write `FieldConflict.remoteValue`, local picks
//    write `localValue`) as a fresh transaction. Fresh ops from this
//    client carry a later clock than everything merged in step 1, so
//    the chosen value wins deterministically regardless of which
//    side the CRDT merge happened to favor. This is also the ONLY
//    way a "remote" pick can resurrect an entity the local side had
//    deleted (step 1 alone leaves it deleted).
//
// 3. Trigger a push of the resolved local Y.Doc.
//
// This approach delegates orthogonal merging to Yjs (which it does
// correctly when there are no conflicting fields) and intervenes
// surgically for every field the user was actually asked about.
//
// Complex values (arrays, nested objects): the field-conflict's
// `localValue` is plain JS (the result of toJSON on the Y type). We
// re-encode to Yjs shape via `jsToYjsValue` before .set(). Y.Map.set
// accepts both plain JS values and Yjs types; using Yjs types
// preserves the field's character as a shared type (so future edits
// from this device track properly).

import * as Y from 'yjs';
import type { FieldConflict } from '@dayrail/core';
import {
  applyRemoteUpdate,
  getYDoc,
  ENTITY_LEVEL_CONFLICT_FIELD,
} from '@dayrail/core';
import { setLastPulledSnapshotId } from './identity';
import { saveLastPulledDocBytes } from './lastPulledDoc';
import { runManualSync } from './syncController';

export type ConflictChoice = 'local' | 'remote';

/** Map key shape: `${storeKey}/${entityId}/${field}` — same shape
 *  the SyncConflictPanel uses to track per-row radio state. */
export type ResolutionMap = Map<string, ConflictChoice>;

export function conflictKey(c: FieldConflict): string {
  return `${c.storeKey}/${c.entityId}/${c.field}`;
}

/** Convert a plain JS value (typically the result of Y.Map/Y.Array
 *  .toJSON()) back into a Yjs-compatible value. Recursive: arrays
 *  become Y.Array, nested objects become Y.Map. Primitives pass
 *  through unchanged. */
function jsToYjsValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const arr = new Y.Array();
    arr.insert(0, value.map((v) => jsToYjsValue(v)));
    return arr;
  }
  if (typeof value === 'object') {
    const m = new Y.Map();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      m.set(k, jsToYjsValue(v));
    }
    return m;
  }
  return value;
}

/**
 * Apply the user's per-field resolution choices to the live local
 * Y.Doc. Mutates in-place inside a single doc.transact so all field
 * overrides land atomically (one observer fire, one push trigger).
 *
 * @param remoteBytes  the Y.Doc bytes pulled from Drive (the same
 *                     ones classify ran against). Applied first via
 *                     CRDT merge to bring in orthogonal remote
 *                     changes; conflicting fields land on an
 *                     arbitrary side (clientID LWW) and are then
 *                     overridden per the user's picks below.
 * @param conflicts    the FieldConflict list classify returned.
 * @param resolutions  user picks · keyed by `conflictKey(c)`.
 */
export function applyConflictResolutions(
  remoteBytes: Uint8Array,
  conflicts: FieldConflict[],
  resolutions: ResolutionMap,
): void {
  // Step 1 · CRDT merge brings in everything from remote.
  applyRemoteUpdate(remoteBytes);

  // Step 2 · explicitly write the chosen side for EVERY conflict.
  // The merge above resolved each conflicting field by random
  // clientID, so neither side's value can be assumed present; and a
  // locally-deleted entity whose remote version the user chose to
  // keep is still deleted. Writing the chosen value as fresh local
  // ops makes the user's pick win deterministically.
  const doc = getYDoc();
  doc.transact(() => {
    for (const c of conflicts) {
      const choice = resolutions.get(conflictKey(c)) ?? 'remote';
      const chosen = choice === 'remote' ? c.remoteValue : c.localValue;
      if (c.field === ENTITY_LEVEL_CONFLICT_FIELD) {
        // Entity-level conflict (delete vs modify · add vs modify on
        // same id). The chosen side's snapshot: null means "that side
        // deleted the entity, keep the deletion" → remove it;
        // otherwise (re-)install the chosen entity's fields — this is
        // what resurrects a locally-deleted entity when the user picks
        // the remote modification.
        const store = doc.getMap(c.storeKey);
        if (chosen === null || chosen === undefined) {
          store.delete(c.entityId);
        } else if (typeof chosen === 'object') {
          store.set(c.entityId, jsToYjsValue(chosen));
        }
        continue;
      }
      // Scalar / array / nested-object field override.
      const store = doc.getMap(c.storeKey);
      const entity = store.get(c.entityId);
      if (!(entity instanceof Y.Map)) continue;
      if (chosen === undefined) {
        // The chosen side removed this field.
        if (entity.has(c.field)) entity.delete(c.field);
      } else {
        entity.set(c.field, jsToYjsValue(chosen));
      }
    }
  }, 'conflict-resolution');
}

/**
 * Full resolve-and-push pipeline. Called by SyncConflictPanel when
 * the user clicks "Apply":
 *
 *   1. apply user choices (CRDT merge of remote + surgical overrides
 *      for local picks)
 *   2. update lineage cursors (`lastPulledSnapshotId` +
 *      `lastPulledDocBytes`) so the next sync's classify uses remote
 *      as its base
 *   3. trigger a manual push to flush the resolved state to Drive
 *
 * Caller is responsible for clearing `syncStore.pendingConflict`
 * before / after this call (the panel does it before, so the panel
 * unmounts immediately on Apply).
 */
export async function resolveConflictsAndPush(
  remoteBytes: Uint8Array,
  remoteSnapshotId: string,
  conflicts: FieldConflict[],
  resolutions: ResolutionMap,
): Promise<void> {
  applyConflictResolutions(remoteBytes, conflicts, resolutions);
  setLastPulledSnapshotId(remoteSnapshotId);
  await saveLastPulledDocBytes(remoteBytes).catch((e) =>
    console.warn('[sync] saveLastPulledDocBytes failed:', e),
  );
  await runManualSync();
}
