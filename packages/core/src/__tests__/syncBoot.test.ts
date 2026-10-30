/// <reference path="../../../../apps/web/src/vite-env.d.ts" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { encodeDryj } from '@dayrail/db/dryj';

const disk = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>,
  connected: true,
  getRemoteMeta: vi.fn(),
  bytes: null as Uint8Array | null,
}));

vi.mock('@dayrail/db/yDocStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dayrail/db/yDocStore')>();
  return {
    ...original,
    setYDocStoreDevMode: vi.fn(),
    getYDocStore: async () => ({
      loadSyncMeta: async () => ({ ...original.DEFAULT_SYNC_META, ...disk.meta }),
      saveSyncMeta: vi.fn(),
    }),
  };
});
vi.mock('@dayrail/db/yjsPersistence', () => ({
  loadYDocBytes: async () => disk.bytes,
  saveYDocBytes: vi.fn(),
}));
vi.mock('../../../../apps/web/src/lib/importData', () => ({ popPendingImport: () => null }));
vi.mock('../../../../apps/web/src/lib/sync/driveAuth', () => ({
  isDriveConnected: () => disk.connected,
}));
vi.mock('../../../../apps/web/src/lib/sync/driveBackend', () => ({
  getRemoteMeta: disk.getRemoteMeta,
}));

const lastSync = { at: Date.parse('2026-10-29T10:00:00Z'), label: 'My Mac' };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  disk.connected = true;
  disk.meta = {
    lastSyncAt: lastSync.at,
    lastSyncLabel: lastSync.label,
    lastPulledSnapshotId: 'snapshot-1',
    dirtyCount: 0,
  };
  disk.getRemoteMeta.mockReset();
  const doc = new Y.Doc();
  doc.getMap('tasks').set('task', new Y.Map(Object.entries({
    id: 'task', lineId: 'line-inbox', title: 'Existing task', order: 0, status: 'pending',
  })));
  disk.bytes = encodeDryj({
    snapshotId: 'snapshot-1', deviceId: 'test-device', deviceLabel: 'My Mac',
    createdAt: '2026-10-29T10:00:00Z', schemaVersion: 2,
  }, Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const local = new Map<string, string>([['dayrail.sync.deviceLabel', 'My Mac']]);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    },
  });
  vi.stubGlobal('navigator', {
    userAgent: 'Macintosh',
    storage: { getDirectory: async () => ({}), persisted: async () => true },
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sync status after cold boot', () => {
  it('restores history and pending writes after metadata loads without claiming a new round-trip', async () => {
    disk.meta.dirtyCount = 3;
    // Importing the UI store precedes boot's asynchronous disk read.
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    expect(syncStore.getSnapshot().lastSync).toBeNull();
    const listener = vi.fn();
    const unsubscribe = syncStore.subscribe(listener);
    const { boot } = await import('../../../../apps/web/src/boot');
    await boot();

    expect(syncStore.getSnapshot()).toMatchObject({
      lastSync,
      dirtyCount: 3,
      connected: true,
      deviceLabel: 'My Mac',
      sessionRoundTripDone: false,
    });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps a genuinely new device without invented sync history', async () => {
    disk.meta = {};
    disk.bytes = null;
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    const { boot } = await import('../../../../apps/web/src/boot');
    await boot();
    expect(syncStore.getSnapshot()).toMatchObject({ lastSync: null, dirtyCount: 0, sessionRoundTripDone: false });
  });

  it('retains restored history when manual sync succeeds without changes', async () => {
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    const { boot } = await import('../../../../apps/web/src/boot');
    await boot();
    disk.getRemoteMeta.mockResolvedValue({ fileId: 'file-1', snapshotId: 'snapshot-1' });
    const { runManualSync } = await import('../../../../apps/web/src/lib/sync/syncController');
    await expect(runManualSync()).resolves.toEqual({ kind: 'noop' });
    expect(syncStore.getSnapshot().lastSync).toEqual(lastSync);
    expect(syncStore.getSnapshot().phase).toEqual({ kind: 'idle' });
    expect(syncStore.getSnapshot().sessionRoundTripDone).toBe(false);
  });

  it('preserves a failed probe instead of returning the status to idle', async () => {
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    disk.getRemoteMeta.mockRejectedValue(new Error('NEEDS_RECONNECT · 请重新连接 Google Drive'));
    const { runBootProbe } = await import('../../../../apps/web/src/lib/sync/syncController');
    await expect(runBootProbe()).resolves.toEqual({
      kind: 'offline', reason: 'NEEDS_RECONNECT · 请重新连接 Google Drive',
    });
    expect(syncStore.getSnapshot().phase.kind).toBe('offline');
  });
});
