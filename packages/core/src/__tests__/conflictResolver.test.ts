/// <reference path="../../../../apps/web/src/vite-env.d.ts" />
//
// Regression tests for the SyncConflictPanel resolution pipeline
// (apps/web/src/lib/sync/conflictResolver.ts · ERD §7.8 P3).
//
// The bug (audit #3): the resolver assumed that re-applying the
// remote update makes remote win conflicting Y.Map fields ("Yjs LWW +
// later Lamport clock"), so a user pick of "remote" wrote NOTHING.
// Yjs actually resolves concurrent same-key map writes by clientID —
// random per Y.Doc — so about half the time the merged doc still held
// the LOCAL value and the user's explicit choice was silently
// inverted; a locally-deleted entity could never be restored at all
// (deletions are monotonic under merge).
//
// These tests pin the fixed contract: the chosen side's value is
// explicitly written for every conflict, so it wins regardless of
// which side the CRDT merge happened to favor. Conflicts are produced
// by the real `classify` (same pipeline as the push firewall), and
// after resolution we re-classify against the new base (the remote
// bytes, exactly what resolveConflictsAndPush persists) to confirm
// the conflict is truly gone.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { encodeDryj } from '@dayrail/db/dryj';

vi.mock('../../../../apps/web/src/lib/sync/identity', () => ({
  setLastPulledSnapshotId: vi.fn(),
}));
vi.mock('../../../../apps/web/src/lib/sync/lastPulledDoc', () => ({
  saveLastPulledDocBytes: vi.fn(async () => {}),
}));
vi.mock('../../../../apps/web/src/lib/sync/syncController', () => ({
  runManualSync: vi.fn(async () => ({ kind: 'noop' })),
}));

import {
  applyConflictResolutions,
  conflictKey,
} from '../../../../apps/web/src/lib/sync/conflictResolver';
import { getYDoc } from '../store';
import { classify, type FieldConflict } from '../smartDiff';

let seq = 0;

/** Build a (base, live-local, remote) triple sharing CRDT history.
 *  Local modifies `id`.title and DELETES `del`; remote modifies both.
 *  clientIDs are forced so each test controls which side the blind
 *  CRDT merge favors. Entity ids are unique per call because the
 *  live doc is the module singleton. */
function setup(localClientId: number, remoteClientId: number) {
  seq += 1;
  const id = `task-${seq}`;
  const del = `task-del-${seq}`;

  const seed = new Y.Doc();
  seed
    .getMap('tasks')
    .set(id, new Y.Map(Object.entries({ id, title: 'base-title', status: 'pending' })));
  seed
    .getMap('tasks')
    .set(del, new Y.Map(Object.entries({ id: del, title: 'doomed', status: 'pending' })));
  const baseUpdate = Y.encodeStateAsUpdate(seed);

  const live = getYDoc();
  Y.applyUpdate(live, baseUpdate);
  const remote = new Y.Doc();
  remote.clientID = remoteClientId;
  Y.applyUpdate(remote, baseUpdate);

  live.clientID = localClientId;
  live.transact(() => {
    (live.getMap('tasks').get(id) as Y.Map<unknown>).set('title', 'local-title');
    live.getMap('tasks').delete(del);
  });
  remote.transact(() => {
    (remote.getMap('tasks').get(id) as Y.Map<unknown>).set('title', 'remote-title');
    (remote.getMap('tasks').get(del) as Y.Map<unknown>).set('title', 'remote-edited');
  });

  const remoteBytes = encodeDryj(
    {
      snapshotId: `snap-${seq}`,
      deviceId: 'remote-device',
      deviceLabel: 'Remote Mac',
      createdAt: new Date().toISOString(),
      schemaVersion: 2,
    },
    Y.encodeStateAsUpdate(remote),
  );
  const baseDoc = new Y.Doc();
  Y.applyUpdate(baseDoc, baseUpdate);
  return { id, del, live, remote, remoteBytes, baseDoc };
}

function conflictsFor(
  baseDoc: Y.Doc,
  live: Y.Doc,
  remote: Y.Doc,
  ids: string[],
): FieldConflict[] {
  const cls = classify(baseDoc, live, remote);
  if (cls.type !== 'true-conflict') {
    throw new Error(`expected true-conflict, got ${cls.type}`);
  }
  // Only this scenario's entities (the live doc is a singleton that
  // accumulates entities across tests in this file).
  return cls.conflicts.filter((c) => ids.includes(c.entityId));
}

function pickAll(
  conflicts: FieldConflict[],
  choice: 'local' | 'remote',
): Map<string, 'local' | 'remote'> {
  return new Map(conflicts.map((c) => [conflictKey(c), choice] as const));
}

describe('applyConflictResolutions · "choose remote"', () => {
  it('writes the remote value even when the blind CRDT merge favors local (larger local clientID)', () => {
    const { id, del, live, remote, remoteBytes, baseDoc } = setup(1_000_000, 1);
    const conflicts = conflictsFor(baseDoc, live, remote, [id, del]);
    expect(conflicts.length).toBeGreaterThanOrEqual(2);

    applyConflictResolutions(remoteBytes, conflicts, pickAll(conflicts, 'remote'));

    const tasks = live.getMap('tasks');
    expect((tasks.get(id) as Y.Map<unknown>).get('title')).toBe('remote-title');
    // Entity-level delete-vs-modify: picking remote must resurrect the
    // locally-deleted entity with remote's content (the merge alone can
    // never do this — Yjs deletions are monotonic).
    expect(tasks.has(del)).toBe(true);
    expect((tasks.get(del) as Y.Map<unknown>).toJSON()).toMatchObject({
      title: 'remote-edited',
    });

    // Conflict truly eliminated: against the NEW base (the remote
    // bytes, which resolveConflictsAndPush persists as lastPulledDoc),
    // classify must not see a true-conflict any more.
    const newBase = new Y.Doc();
    Y.applyUpdate(newBase, Y.encodeStateAsUpdate(remote));
    expect(classify(newBase, live, remote).type).not.toBe('true-conflict');
  });

  it('writes the remote value when the merge favors remote too (idempotent)', () => {
    const { id, del, live, remote, remoteBytes, baseDoc } = setup(1, 1_000_000);
    const conflicts = conflictsFor(baseDoc, live, remote, [id, del]);

    applyConflictResolutions(remoteBytes, conflicts, pickAll(conflicts, 'remote'));

    const tasks = live.getMap('tasks');
    expect((tasks.get(id) as Y.Map<unknown>).get('title')).toBe('remote-title');
    expect(tasks.has(del)).toBe(true);
  });

  it('defaults to remote for conflicts the user left untouched', () => {
    const { id, del, live, remote, remoteBytes, baseDoc } = setup(2_000_000, 2);
    const conflicts = conflictsFor(baseDoc, live, remote, [id, del]);

    applyConflictResolutions(remoteBytes, conflicts, new Map());

    expect((live.getMap('tasks').get(id) as Y.Map<unknown>).get('title')).toBe(
      'remote-title',
    );
  });
});

describe('applyConflictResolutions · "choose local"', () => {
  it('keeps the local value and the local deletion when the merge favored remote', () => {
    const { id, del, live, remote, remoteBytes, baseDoc } = setup(3, 3_000_000);
    const conflicts = conflictsFor(baseDoc, live, remote, [id, del]);

    applyConflictResolutions(remoteBytes, conflicts, pickAll(conflicts, 'local'));

    const tasks = live.getMap('tasks');
    expect((tasks.get(id) as Y.Map<unknown>).get('title')).toBe('local-title');
    expect(tasks.has(del)).toBe(false);

    const newBase = new Y.Doc();
    Y.applyUpdate(newBase, Y.encodeStateAsUpdate(remote));
    expect(classify(newBase, live, remote).type).not.toBe('true-conflict');
  });
});
