/// <reference path="../../../../apps/web/src/vite-env.d.ts" />
//
// End-to-end-ish regressions for the sync controller's correctness
// guards (apps/web/src/lib/sync/syncController.ts), driven through the
// real boot + store + controller modules with the Drive IO layer and
// the YDocStore mocked at the module boundary — the same harness shape
// as syncBoot.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { decodeDryj, encodeDryj } from '@dayrail/db/dryj';
import { classifyReconcile } from '../heartbeatStatus';

const disk = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>,
  connected: true,
  bytes: null as Uint8Array | null,
  savedBytes: null as Uint8Array | null,
  lastPulled: null as Uint8Array | null,
  savedLastPulled: null as Uint8Array | null,
  pendingImport: null as Uint8Array | null,
  getRemoteMeta: vi.fn(),
  downloadDryjById: vi.fn(),
  uploadDryj: vi.fn(),
  writeHeartbeat: vi.fn(),
  listHeartbeats: vi.fn(),
  getCurrentAccountEmail: vi.fn(),
}));

vi.mock('@dayrail/db/yDocStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dayrail/db/yDocStore')>();
  return {
    ...original,
    setYDocStoreDevMode: vi.fn(),
    getYDocStore: async () => ({
      loadSyncMeta: async () => ({ ...original.DEFAULT_SYNC_META, ...disk.meta }),
      saveSyncMeta: vi.fn(),
      loadLastPulled: async () => disk.lastPulled,
      saveLastPulled: async (bytes: Uint8Array) => {
        disk.savedLastPulled = bytes;
      },
      deleteLastPulled: async () => {
        disk.lastPulled = null;
      },
    }),
  };
});
vi.mock('@dayrail/db/yjsPersistence', () => ({
  loadYDocBytes: async () => disk.bytes,
  saveYDocBytes: async (bytes: Uint8Array) => {
    disk.savedBytes = bytes;
    disk.bytes = bytes;
  },
  quarantineYDocBytes: async () => null,
}));
vi.mock('../../../../apps/web/src/lib/importData', () => ({
  popPendingImport: () => {
    const pending = disk.pendingImport;
    disk.pendingImport = null;
    return pending ?? undefined;
  },
}));
vi.mock('../../../../apps/web/src/lib/sync/driveAuth', () => ({
  isDriveConnected: () => disk.connected,
}));
vi.mock('../../../../apps/web/src/lib/sync/driveBackend', () => ({
  getRemoteMeta: disk.getRemoteMeta,
  downloadDryjById: disk.downloadDryjById,
  uploadDryj: disk.uploadDryj,
  writeHeartbeat: disk.writeHeartbeat,
  listHeartbeats: disk.listHeartbeats,
  getCurrentAccountEmail: disk.getCurrentAccountEmail,
}));

function baseSnapshotBytes(): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('tasks').set(
    'task',
    new Y.Map(
      Object.entries({
        id: 'task',
        lineId: 'line-inbox',
        title: 'Existing task',
        order: 0,
        status: 'pending',
      }),
    ),
  );
  const bytes = encodeDryj(
    {
      snapshotId: 'snapshot-1',
      deviceId: 'test-device',
      deviceLabel: 'My Mac',
      createdAt: '2026-10-29T10:00:00Z',
      schemaVersion: 2,
    },
    Y.encodeStateAsUpdate(doc),
  );
  doc.destroy();
  return bytes;
}

/** Add a habit + rail + weekday rule to disk.bytes so boot's
 *  materializeAutoTasksForToday has something to materialize (a
 *  system-authored write AFTER the sync loop attaches). */
function seedHabitWorld(): void {
  const decoded = decodeDryj(disk.bytes!);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decoded.update);
  const entity = (map: string, id: string, value: Record<string, unknown>) => {
    doc.getMap(map).set(id, new Y.Map(Object.entries(value)));
  };
  const revision = (map: string, id: string, value: Record<string, unknown>) => {
    const array = new Y.Array();
    array.push([{ id: 'rev-' + id, effectiveFrom: '1970-01-01', authoredAt: 0, ...value }]);
    doc.getMap(map).set(id, array);
  };
  const rail = {
    id: 'rail',
    templateKey: 'workday',
    name: 'Morning',
    startMinutes: 540,
    durationMinutes: 30,
    color: 'indigo',
    showInCheckin: true,
  };
  const binding = { id: 'binding', habitId: 'habit', railId: 'rail', createdAt: 0 };
  const rule = {
    id: 'rule',
    kind: 'weekday',
    priority: 10,
    value: { templateKey: 'workday', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    createdAt: 0,
  };
  entity('templates', 'workday', { key: 'workday', name: 'Workday', isDefault: true });
  entity('lines', 'habit', { id: 'habit', name: 'Read', kind: 'habit', status: 'active', createdAt: 0 });
  entity('rails', 'rail', rail);
  entity('habitBindings', 'binding', binding);
  entity('calendarRules', 'rule', rule);
  revision('railRevisions', 'rail', { ...rail, railId: 'rail' });
  revision('habitBindingRevisions', 'binding', { ...binding, bindingId: 'binding' });
  revision('calendarRuleRevisions', 'rule', { ruleId: 'rule', priority: 10, value: rule.value });
  disk.bytes = encodeDryj(decoded.meta, Y.encodeStateAsUpdate(doc));
  doc.destroy();
}

async function bootApp() {
  const { boot } = await import('../../../../apps/web/src/boot');
  await boot();
}

/** A genuine user-authored write through the real store action
 *  surface (createLine's transact origin is not a reserved one). */
async function userEdit(id: string) {
  const core = await import('@dayrail/core');
  await core.useStore.getState().createLine({
    id,
    name: `Line ${id}`,
    kind: 'project',
    status: 'active',
    createdAt: Date.now(),
  });
}

/** Drain microtasks/timer callbacks until `done()` or the attempt
 *  budget runs out (fake timers are active). */
async function waitUntil(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i++) {
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(done()).toBe(true);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T12:00:00'));
  disk.connected = true;
  disk.meta = {
    lastSyncAt: Date.parse('2026-10-29T10:00:00Z'),
    lastSyncLabel: 'My Mac',
    lastPulledSnapshotId: 'snapshot-1',
    dirtyCount: 0,
  };
  disk.bytes = baseSnapshotBytes();
  disk.savedBytes = null;
  disk.lastPulled = null;
  disk.savedLastPulled = null;
  disk.pendingImport = null;
  disk.getRemoteMeta.mockReset();
  disk.downloadDryjById.mockReset();
  disk.uploadDryj.mockReset();
  disk.uploadDryj.mockResolvedValue({ canonicalFileId: 'c-1', historyFileId: 'h-1' });
  disk.writeHeartbeat.mockReset();
  disk.writeHeartbeat.mockResolvedValue(undefined);
  disk.listHeartbeats.mockReset();
  disk.listHeartbeats.mockResolvedValue([]);
  disk.getCurrentAccountEmail.mockReset();
  disk.getCurrentAccountEmail.mockResolvedValue('me@example.com');

  const local = new Map<string, string>([['dayrail.sync.deviceLabel', 'My Mac']]);
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
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

// ============ audit #34 · boot heartbeat refresh (ERD §7.10.4) ============

describe('boot reconcile heartbeat refresh', () => {
  it('advertises activity-ahead-of-push so peers can reach ⚠ peer-stale', async () => {
    // Device edited yesterday but hasn't pushed successfully in 2+
    // weeks — the §7.10.4 data-stranded-on-a-device scenario.
    disk.meta.lastSuccessAt = { push: '2026-10-14T08:00:00.000Z', pull: '2026-10-30T08:00:00.000Z' };
    disk.meta.lastActivityAt = '2026-10-30T02:00:00.000Z';
    await bootApp();
    const { runReconcileAtBoot } = await import(
      '../../../../apps/web/src/lib/sync/syncController'
    );
    await runReconcileAtBoot();

    expect(disk.writeHeartbeat).toHaveBeenCalledTimes(1);
    const hb = disk.writeHeartbeat.mock.calls[0]![0] as {
      deviceId: string;
      deviceName: string;
      lastActivityAt: string;
      lastPushedAt: string;
    };
    expect(hb.lastActivityAt).toBe('2026-10-30T02:00:00.000Z');
    expect(hb.lastPushedAt).toBe('2026-10-14T08:00:00.000Z');

    // A peer that reads this heartbeat now actually reaches the ⚠
    // branch — with push-success-only heartbeat writes this shape
    // could never exist and the banner stayed ✓ forever.
    const result = classifyReconcile({
      nowMs: Date.now(),
      peerHeartbeats: [
        {
          deviceId: hb.deviceId,
          deviceName: hb.deviceName,
          lastActivityAt: hb.lastActivityAt,
          lastPushedAt: hb.lastPushedAt,
        },
      ],
      driveReachable: true,
    });
    expect(result.kind).toBe('peer-stale');
  });

  it('stays silent for a device that never pushed (nothing meaningful to advertise)', async () => {
    disk.meta.lastSuccessAt = { push: null, pull: null };
    disk.meta.lastActivityAt = '2026-10-30T02:00:00.000Z';
    await bootApp();
    const { runReconcileAtBoot } = await import(
      '../../../../apps/web/src/lib/sync/syncController'
    );
    await runReconcileAtBoot();
    expect(disk.writeHeartbeat).not.toHaveBeenCalled();
  });
});
