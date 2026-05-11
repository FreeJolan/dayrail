// Lightweight external store for the runtime sync status surface
// (top-bar indicator + Settings → 同步 row + boot-gate splash text).
// Uses useSyncExternalStore so React 18 can subscribe without a
// separate state-library import. Values mirror identity.ts cursors
// for everything that needs to survive a reload, but the runtime
// status (idle / syncing / error reason) lives only here.

import { useSyncExternalStore } from 'react';
import type { FieldConflict } from '@dayrail/core';
import {
  getDeviceLabel,
  getDirtyCount,
  getLastSyncInfo,
  type LastSyncInfo,
} from './identity';
import { isDriveConnected } from './driveAuth';

export type SyncPhase =
  | { kind: 'idle' }
  | { kind: 'syncing'; reason: 'push' | 'pull' | 'probe' }
  | { kind: 'offline'; message: string }
  | { kind: 'error'; message: string };

/** State surfaced when smart-diff classify (ERD §7.8) returns
 *  'true-conflict' during a push preflight. Push is paused; the
 *  SyncConflictPanel reads this state, lets the user pick a side
 *  per field, then dispatches `applyConflictResolutions` + clears
 *  this state via `syncStore.clearPendingConflict`. */
export interface PendingConflict {
  conflicts: FieldConflict[];
  /** The remote Y.Doc bytes that classify just compared against;
   *  the resolver re-applies these via CRDT merge then overrides
   *  user-chosen local fields. */
  remoteBytes: Uint8Array;
  /** The remote snapshotId · written to `lastPulledSnapshotId` once
   *  the user resolves and the push succeeds. */
  remoteSnapshotId: string;
  detectedAt: number;
  /** Set by the dev-only "试看冲突 UI" button. When true,
   *  SyncConflictPanel's Apply button is a no-op (just closes the
   *  panel) — the test data references fake entity IDs and applying
   *  it for real would corrupt lastPulled state. Production code
   *  paths never set this. */
  demo?: boolean;
}

export interface SyncSnapshot {
  /** OAuth-connected on this device. Mirrors identity flag; cached
   *  here so subscribers re-render on connect/disconnect. */
  connected: boolean;
  phase: SyncPhase;
  dirtyCount: number;
  lastSync: LastSyncInfo | null;
  deviceLabel: string;
  /** Set when classify returns 'true-conflict'; null otherwise. The
   *  SyncConflictPanel mounts iff this is non-null. */
  pendingConflict: PendingConflict | null;
}

let snapshot: SyncSnapshot = readSnapshot();
const listeners = new Set<() => void>();

function readSnapshot(): SyncSnapshot {
  return {
    connected: isDriveConnected(),
    phase: { kind: 'idle' },
    dirtyCount: getDirtyCount(),
    lastSync: getLastSyncInfo(),
    deviceLabel: getDeviceLabel(),
    pendingConflict: null,
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

function update(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export const syncStore = {
  getSnapshot(): SyncSnapshot {
    return snapshot;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setPhase(phase: SyncPhase): void {
    update({ phase });
  },
  setDirtyCount(n: number): void {
    update({ dirtyCount: n });
  },
  setLastSync(info: LastSyncInfo | null): void {
    update({ lastSync: info });
  },
  setConnected(v: boolean): void {
    update({ connected: v });
  },
  setDeviceLabel(label: string): void {
    update({ deviceLabel: label });
  },
  setPendingConflict(c: PendingConflict | null): void {
    update({ pendingConflict: c });
  },
};

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot);
}
