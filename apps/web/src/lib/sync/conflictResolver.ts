// Conflict resolution helpers (ERD §7.8 P3).
//
// When the smart-diff classifier returns `true-conflict`, the user
// picks a side per field via SyncConflictPanel. This module turns
// those picks into actual Y.Doc mutations, then triggers the push.
//
// Resolution algorithm:
//
// 1. Apply remoteBytes to the live local Y.Doc via Y.applyUpdate
//    (the same CRDT merge v0.7 used). After this:
//      - Conflicting fields hold REMOTE's values (Yjs LWW + later
//        Lamport clock favored remote since it was the one we just
//        pulled).
//      - Orthogonal changes from both sides are union-merged.
//
// 2. For each conflict where the user chose 'local': override the
//    merged value back to the pre-merge local value. The pre-merge
//    value is captured in `FieldConflict.localValue` (classify
//    already collected it from `localDiff.fields[field].next`).
//
// 3. Trigger a push of the resolved local Y.Doc.
//
// This approach delegates orthogonal merging to Yjs (which it does
// correctly when there are no conflicting fields) and only intervenes
// surgically for user-chosen overrides.
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
 *                     changes + LWW-resolve conflicting fields to
 *                     remote's value.
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

  // Step 2 · surgical overrides for user-chosen-local fields.
  const doc = getYDoc();
  doc.transact(() => {
    for (const c of conflicts) {
      const choice = resolutions.get(conflictKey(c)) ?? 'remote';
      if (choice === 'remote') continue;
      // 'local' → restore the pre-merge local value.
      if (c.field === ENTITY_LEVEL_CONFLICT_FIELD) {
        // Entity-level conflict (delete vs modify · add vs add with
        // different content). 'local' = whatever local's snapshot
        // was: null means "local deleted, keep that" → remove the
        // entity; otherwise install the local entity's fields.
        const store = doc.getMap(c.storeKey);
        if (c.localValue === null) {
          store.delete(c.entityId);
        } else if (c.localValue && typeof c.localValue === 'object') {
          const newEntity = jsToYjsValue(c.localValue) as Y.Map<unknown>;
          store.set(c.entityId, newEntity);
        }
        continue;
      }
      // Scalar / array / nested-object field override.
      const store = doc.getMap(c.storeKey);
      const entity = store.get(c.entityId);
      if (!(entity instanceof Y.Map)) continue;
      entity.set(c.field, jsToYjsValue(c.localValue));
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
