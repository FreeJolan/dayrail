// Lightweight external store for the runtime sync status surface
// (top-bar indicator + Settings → 同步 row + boot-gate splash text).
// Uses useSyncExternalStore so React 18 can subscribe without a
// separate state-library import. Values mirror identity.ts cursors
// for everything that needs to survive a reload, but the runtime
// status (idle / syncing / error reason) lives only here.

import { useSyncExternalStore } from 'react';
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

export interface SyncSnapshot {
  /** OAuth-connected on this device. Mirrors identity flag; cached
   *  here so subscribers re-render on connect/disconnect. */
  connected: boolean;
  phase: SyncPhase;
  dirtyCount: number;
  lastSync: LastSyncInfo | null;
  deviceLabel: string;
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
};

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot);
}
