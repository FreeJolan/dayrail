// Lightweight external store for the runtime sync status surface
// (top-bar indicator + Settings → 同步 row + boot-gate splash text).
// Uses useSyncExternalStore so React 18 can subscribe without a
// separate state-library import. Values mirror identity.ts cursors
// for everything that needs to survive a reload, but the runtime
// status (idle / syncing / error reason) lives only here.

import { useSyncExternalStore } from 'react';
import type {
  FieldConflict,
  ReconcileResult,
  SyncMode,
} from '@dayrail/core';
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

/** State surfaced when boot-time mode regression check (ERD §7.10.6)
 *  finds that `IdentityPin.lastKnownMode` is backup/sync but runtime
 *  reads local-only. The ModeRegressionModal lets the user pick
 *  reconnect / explicit-downgrade / defer-until-next-launch. */
export interface PendingModeRegression {
  /** What mode the pin remembers from the last successful run. */
  pinnedMode: 'backup' | 'sync';
  /** Email under which the pin was written. */
  pinnedAccountEmail: string;
  detectedAt: number;
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
  /** Set when boot-time check detects pin.lastKnownMode ∈ {backup,
   *  sync} but runtime is local. ModeRegressionModal mounts iff
   *  this is non-null. */
  pendingModeRegression: PendingModeRegression | null;
  /** Result of the boot-time heartbeat reconcile (ERD §7.10.4 ·
   *  v0.12 P4). null = not yet attempted this session · `no-peers`
   *  = single-device path (banner suppressed) · other variants
   *  feed the ReconcileBanner. */
  bootReconcile: ReconcileResult | null;
  /** Inferred sync mode (ERD §7.10.1 · v0.12 P5). Cached here so
   *  UI components can read without recomputing from heartbeats.
   *  Default 'local' until the first reconcile updates it. */
  syncMode: SyncMode;
  /** Show the mode-upgrade toast (backup → sync transition). UI
   *  flag · dismiss clears it · 24h cooldown lives in SyncMeta. */
  showModeUpgradeToast: boolean;
  /** Show the departure gate modal (Settings → 同步 → 安全退出 ·
   *  ERD §7.10.3 · v0.12 P6). UI-only flag · modal closes via the
   *  same setter. */
  showDepartureGate: boolean;
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
    pendingModeRegression: null,
    bootReconcile: null,
    syncMode: 'local',
    showModeUpgradeToast: false,
    showDepartureGate: false,
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
  setPendingModeRegression(m: PendingModeRegression | null): void {
    update({ pendingModeRegression: m });
  },
  setBootReconcile(r: ReconcileResult | null): void {
    update({ bootReconcile: r });
  },
  setSyncMode(m: SyncMode): void {
    update({ syncMode: m });
  },
  setShowModeUpgradeToast(v: boolean): void {
    update({ showModeUpgradeToast: v });
  },
  setShowDepartureGate(v: boolean): void {
    update({ showDepartureGate: v });
  },
};

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot);
}
