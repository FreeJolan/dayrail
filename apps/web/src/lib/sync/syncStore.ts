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
  hasSessionRoundTrip,
  markSessionRoundTrip,
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

/** State surfaced when identity pin check (ERD §7.10.2) detects a
 *  different Drive account than the pinned one. The
 *  IdentityMismatchModal reads this · user picks among three
 *  branches (re-pick / switch / defer) · resolver clears it. */
export interface PendingIdentityMismatch {
  /** Email captured on the original first connect. */
  stored: string;
  /** Email currently authenticated against Drive. */
  current: string;
  /** Where the mismatch was detected (only for diagnostic logging
   *  · the modal copy is the same either way). */
  detectedAt: number;
  source: 'connect' | 'push';
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
  /** Set when identity-pin check detects a different account; null
   *  otherwise. IdentityMismatchModal mounts iff this is non-null. */
  pendingIdentityMismatch: PendingIdentityMismatch | null;
  /** True once a successful push or pull has completed in the
   *  current browser session (ERD §7.9 decision 5). The "已同步"
   *  label only displays when this is true — `lastSync` alone can
   *  reflect a stale value that survived a wipe. */
  sessionRoundTripDone: boolean;
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
    pendingIdentityMismatch: null,
    sessionRoundTripDone: hasSessionRoundTrip(),
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
    // A non-null update marks the session as having had a successful
    // round-trip — drives the SideNav "已同步" gate (ERD §7.9 #5).
    if (info !== null) {
      markSessionRoundTrip();
      update({ lastSync: info, sessionRoundTripDone: true });
    } else {
      update({ lastSync: info });
    }
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
  setPendingIdentityMismatch(m: PendingIdentityMismatch | null): void {
    update({ pendingIdentityMismatch: m });
  },
};

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot);
}
