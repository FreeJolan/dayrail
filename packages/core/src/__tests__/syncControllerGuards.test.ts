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
import { detectModeRegression } from '../modeRegression';

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

/** One shared base snapshot per test: regenerating it would mint new
 *  clientIDs, and a "remote" doc seeded from a REGENERATED copy would
 *  not share CRDT history with the local doc — merges would then
 *  resolve whole entities by clientID instead of per field. */
let baseBytes: Uint8Array;

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
  baseBytes = baseSnapshotBytes();
  disk.bytes = baseBytes;
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

// ============ audit #22 · samples-only flag vs real user edits ============

describe('samples-only flag lifecycle through the real controller', () => {
  it('survives boot auto-materialization but clears on the first genuine user edit', async () => {
    seedHabitWorld();
    disk.meta.samplesOnly = true;
    await bootApp();
    const identity = await import('../../../../apps/web/src/lib/sync/identity');
    const core = await import('@dayrail/core');

    // Boot materialized today's habit auto-task AFTER the sync loop
    // attached (a system-authored write). The disposable-seed marker
    // must survive it, and the write must stay untracked — clearing
    // here was the v0.9.0→v0.9.1 overwrite-cloud-with-seed hole.
    expect(core.useStore.getState().tasks['task-auto-habit-2026-10-30-rail']).toBeTruthy();
    expect(identity.isLocalSamplesOnly()).toBe(true);
    expect(identity.getDirtyCount()).toBe(0);

    // First GENUINE user write: the samplesOnlyFlag.test.ts contract
    // ("first user write → flag cleared") — without it the flag
    // sticks forever, real edits never bump the dirty cursor, and
    // the next samples-only pull replaceLocalFromRemote's them away.
    await userEdit('line-user-1');
    expect(identity.isLocalSamplesOnly()).toBe(false);
    expect(identity.getDirtyCount()).toBe(1);
  });
});

// ============ audit #24 · edits made during an upload stay dirty ============

describe('push success pays off only the exported edits', () => {
  it('keeps an edit made while the upload was in flight dirty (and queued)', async () => {
    disk.getRemoteMeta.mockResolvedValue(null); // no remote canonical
    let finishUpload!: () => void;
    disk.uploadDryj.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = () =>
            resolve({ canonicalFileId: 'c-1', historyFileId: 'h-1' });
        }),
    );
    await bootApp();
    const identity = await import('../../../../apps/web/src/lib/sync/identity');
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    const { runManualSync } = await import(
      '../../../../apps/web/src/lib/sync/syncController'
    );

    await userEdit('line-before-push');
    expect(identity.getDirtyCount()).toBe(1);

    const manualSync = runManualSync();
    await waitUntil(() => disk.uploadDryj.mock.calls.length === 1);

    // The upload is in flight (its bytes were exported BEFORE this
    // edit) — the user keeps typing.
    await userEdit('line-during-push');
    expect(identity.getDirtyCount()).toBe(2);

    finishUpload();
    await expect(manualSync).resolves.toEqual({ kind: 'pushed' });

    // Only the exported edit is paid off. A blanket clear left this
    // edit stranded with the UI showing 已同步 (every push trigger
    // gates on dirty > 0).
    expect(identity.getDirtyCount()).toBe(1);
    expect(syncStore.getSnapshot().dirtyCount).toBe(1);
  });
});

// ============ audit #23 · pull-side true-conflict gate (ERD §7.8) ============

describe('pull routes same-field divergence into the conflict panel', () => {
  it('pauses instead of silently LWW-merging when local is dirty and classify says conflict', async () => {
    await bootApp();
    const core = await import('@dayrail/core');
    const identity = await import('../../../../apps/web/src/lib/sync/identity');
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');

    // Diff base = the snapshot both sides last agreed on.
    disk.lastPulled = baseBytes;

    // Local edits the task title…
    await core.useStore.getState().updateTask('task', { title: 'local-title' });
    expect(identity.getDirtyCount()).toBe(1);

    // …and the remote canonical moved on with a DIFFERENT title.
    const decoded = decodeDryj(baseBytes);
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, decoded.update);
    (remoteDoc.getMap('tasks').get('task') as Y.Map<unknown>).set('title', 'remote-title');
    const remoteBytes = encodeDryj(
      {
        snapshotId: 'snapshot-2',
        deviceId: 'other-device',
        deviceLabel: 'Other Mac',
        createdAt: '2026-10-30T11:00:00Z',
        schemaVersion: 2,
      },
      Y.encodeStateAsUpdate(remoteDoc),
    );
    remoteDoc.destroy();
    disk.getRemoteMeta.mockResolvedValue({
      fileId: 'file-2',
      snapshotId: 'snapshot-2',
      modifiedTime: '2026-10-30T11:00:00Z',
    });
    disk.downloadDryjById.mockResolvedValue(remoteBytes);

    const { runManualSync } = await import(
      '../../../../apps/web/src/lib/sync/syncController'
    );
    await expect(runManualSync()).resolves.toEqual({ kind: 'noop' });

    // The conflict surfaced instead of a random-clientID silent merge…
    const pending = syncStore.getSnapshot().pendingConflict;
    expect(pending).not.toBeNull();
    expect(pending!.remoteSnapshotId).toBe('snapshot-2');
    expect(pending!.conflicts).toMatchObject([
      { storeKey: 'tasks', entityId: 'task', field: 'title' },
    ]);
    // …nothing was merged, the lineage cursor did not advance (so the
    // push firewall still classifies), and nothing was uploaded.
    expect(core.useStore.getState().tasks['task']!.title).toBe('local-title');
    expect(identity.getLastPulledSnapshotId()).toBe('snapshot-1');
    expect(disk.uploadDryj).not.toHaveBeenCalled();
  });

  it('still CRDT-merges orthogonal remote changes without pausing', async () => {
    await bootApp();
    const core = await import('@dayrail/core');
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    disk.lastPulled = baseBytes;

    // Local edits the title; remote edits a DIFFERENT field.
    await core.useStore.getState().updateTask('task', { title: 'local-title' });
    const decoded = decodeDryj(baseBytes);
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, decoded.update);
    (remoteDoc.getMap('tasks').get('task') as Y.Map<unknown>).set('order', 5);
    const remoteBytes = encodeDryj(
      {
        snapshotId: 'snapshot-2',
        deviceId: 'other-device',
        deviceLabel: 'Other Mac',
        createdAt: '2026-10-30T11:00:00Z',
        schemaVersion: 2,
      },
      Y.encodeStateAsUpdate(remoteDoc),
    );
    remoteDoc.destroy();
    disk.getRemoteMeta.mockResolvedValue({
      fileId: 'file-2',
      snapshotId: 'snapshot-2',
      modifiedTime: '2026-10-30T11:00:00Z',
    });
    disk.downloadDryjById.mockResolvedValue(remoteBytes);

    const { runManualSync } = await import(
      '../../../../apps/web/src/lib/sync/syncController'
    );
    // linear-lead pull merges, then the manual flow pushes the union.
    await expect(runManualSync()).resolves.toEqual({ kind: 'pushed' });
    expect(syncStore.getSnapshot().pendingConflict).toBeNull();
    expect(core.useStore.getState().tasks['task']).toMatchObject({
      title: 'local-title',
      order: 5,
    });
  });
});

// ============ audit #2 · identity mismatch gates every pull surface ============

describe('identity mismatch gates the pull surfaces (ERD §7.10.2)', () => {
  it('refuses to merge or replace remote bytes while a mismatch is pending', async () => {
    await bootApp();
    const identity = await import('../../../../apps/web/src/lib/sync/identity');
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    const { applyRemoteDryj, replaceLocalFromRemote } = await import(
      '../../../../apps/web/src/lib/sync/syncController'
    );

    // Reconnect picked the wrong Google account: the verify hook has
    // recorded the mismatch, the modal is about to mount. From this
    // moment NO pull path may let the other account's bytes reach the
    // local doc — a Yjs merge is irreversible.
    syncStore.setPendingIdentityMismatch({
      stored: 'pinned@example.com',
      current: 'wrong@example.com',
      detectedAt: Date.now(),
      source: 'connect',
    });

    const remote = {
      fileId: 'file-wrong-account',
      snapshotId: 'snapshot-wrong-account',
      modifiedTime: '2026-10-30T11:00:00Z',
    };
    await expect(applyRemoteDryj(remote)).rejects.toThrow(/IDENTITY_MISMATCH/);
    await expect(replaceLocalFromRemote(remote)).rejects.toThrow(
      /IDENTITY_MISMATCH/,
    );

    // Nothing was downloaded, merged, or cursor-advanced.
    expect(disk.downloadDryjById).not.toHaveBeenCalled();
    expect(identity.getLastPulledSnapshotId()).toBe('snapshot-1');
  });

  it('pulls normally once the mismatch is resolved', async () => {
    await bootApp();
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    const { applyRemoteDryj } = await import(
      '../../../../apps/web/src/lib/sync/syncController'
    );
    const identity = await import('../../../../apps/web/src/lib/sync/identity');

    syncStore.setPendingIdentityMismatch({
      stored: 'pinned@example.com',
      current: 'wrong@example.com',
      detectedAt: Date.now(),
      source: 'connect',
    });
    syncStore.setPendingIdentityMismatch(null); // user resolved (re-picked)

    const decoded = decodeDryj(baseBytes);
    const remoteBytes = encodeDryj(
      {
        snapshotId: 'snapshot-2',
        deviceId: 'other-device',
        deviceLabel: 'Other Mac',
        createdAt: '2026-10-30T11:00:00Z',
        schemaVersion: 2,
      },
      decoded.update,
    );
    disk.downloadDryjById.mockResolvedValue(remoteBytes);
    await applyRemoteDryj({
      fileId: 'file-2',
      snapshotId: 'snapshot-2',
      modifiedTime: '2026-10-30T11:00:00Z',
    });
    expect(identity.getLastPulledSnapshotId()).toBe('snapshot-2');
  });
});

// ============ audit #58 · honest teardown (no theater push) ============

describe('page teardown records the departure instead of a doomed push', () => {
  it('writes the pendingDeparture marker and starts no network call', async () => {
    await bootApp();
    const identity = await import('../../../../apps/web/src/lib/sync/identity');

    await userEdit('line-unpushed');
    expect(identity.getDirtyCount()).toBe(1);

    // The controller registered pagehide + beforeunload handlers on
    // the (stubbed) window — grab and fire them like a tab close does.
    const calls = (
      window.addEventListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls as Array<[string, () => void]>;
    const pagehide = calls.find((c) => c[0] === 'pagehide')?.[1];
    const beforeunload = calls.find((c) => c[0] === 'beforeunload')?.[1];
    expect(typeof pagehide).toBe('function');
    expect(typeof beforeunload).toBe('function');
    pagehide!();
    beforeunload!(); // both fire on a real close · marker is idempotent

    expect(identity.getPendingDeparture()).toMatchObject({ count: 1 });
    // The old keepalive push pretended to upload from here — it never
    // could (fetch aborts at unload, multi-roundtrip chain). The
    // honest teardown starts no network call at all; the persisted
    // dirty cursor + next boot's recovery push carry the edits up.
    expect(disk.getRemoteMeta).not.toHaveBeenCalled();
    expect(disk.uploadDryj).not.toHaveBeenCalled();
  });

  it('stays silent when there is nothing unpushed', async () => {
    await bootApp();
    const identity = await import('../../../../apps/web/src/lib/sync/identity');
    const calls = (
      window.addEventListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls as Array<[string, () => void]>;
    calls.find((c) => c[0] === 'pagehide')![1]();
    expect(identity.getPendingDeparture()).toBeNull();
  });
});

// ============ audit #20 · imported snapshot must still push ============

describe('import bumps the dirty cursor after the reload', () => {
  it('boots the imported bytes with dirty=1 and samples-only cleared', async () => {
    // Post-reset reality: resetLocalData wiped syncMeta (defaults
    // apply) and the state file; the import stash is waiting. The
    // hostile samplesOnly=true models a stale flag surviving through
    // any path — the import must clear it either way.
    disk.meta = { samplesOnly: true };
    disk.bytes = null;
    disk.pendingImport = baseBytes;
    await bootApp();

    const identity = await import('../../../../apps/web/src/lib/sync/identity');
    const { syncStore } = await import('../../../../apps/web/src/lib/sync/syncStore');
    const core = await import('@dayrail/core');

    // The stash landed as the persisted state and hydrated.
    expect(disk.savedBytes).toBe(baseBytes);
    expect(core.useStore.getState().tasks['task']).toBeTruthy();

    // The §7.9 regression: these two cursors used to be written
    // BEFORE resetLocalData wiped syncMeta, so the import booted with
    // dirty=0 and never pushed.
    expect(identity.getDirtyCount()).toBe(1);
    expect(syncStore.getSnapshot().dirtyCount).toBe(1);
    expect(identity.isLocalSamplesOnly()).toBe(false);
  });
});

// ============ audit #37 · explicit downgrade clears the pin ============

describe('explicit downgrade vs mode-regression guard (ERD §7.10.6)', () => {
  it('recordExplicitDowngrade silences the regression alarm and resets cursors', async () => {
    disk.meta.identityPin = {
      accountEmail: 'me@example.com',
      appdataFileId: null,
      lastKnownMode: 'backup',
      pinnedAt: '2026-10-01T00:00:00.000Z',
    };
    disk.meta.dirtyCount = 3;
    await bootApp();
    const identity = await import('../../../../apps/web/src/lib/sync/identity');

    // Sanity: an UNEXPLAINED drop to local with this pin must alarm —
    // that's the guard's whole job.
    expect(detectModeRegression(identity.getIdentityPin(), 'local').kind).toBe(
      'regression',
    );

    // The user confirms 断开连接 (or the modal's 明确降级): deliberate
    // downgrade — pin + lineage cursors go, local data stays.
    identity.recordExplicitDowngrade();
    expect(identity.getIdentityPin()).toBeNull();
    expect(identity.getLastPulledSnapshotId()).toBeNull();
    expect(identity.getDirtyCount()).toBe(0);
    expect(identity.isLocalSamplesOnly()).toBe(false);
    expect(detectModeRegression(identity.getIdentityPin(), 'local').kind).toBe(
      'none',
    );
  });
});
