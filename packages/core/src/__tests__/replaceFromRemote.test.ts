// Regression tests for replaceFromRemote (ERD §7.8 replace semantics).
//
// The old implementation was `clear() + Y.applyUpdate(snapshot)`,
// which is a "replace" only for a doc that never integrated the
// snapshot's history. Yjs applyUpdate skips (client, clock) pairs the
// doc has already integrated and deletions are monotonic, so for a
// doc that SHARES history with the snapshot — rollback to its own
// backup (SettingsSections "回滚到历史快照", which force-pushes the
// result as the new Drive canonical), or the sync controller's
// same-direction pull on a previously-synced device — clear() won and
// the result was an EMPTY doc instead of the snapshot's content.
//
// These tests pin the fixed semantics: after replaceFromRemote the
// live doc's visible state equals the snapshot's content in every
// history topology, and the structures stay hydrate-compatible
// (entities as Y.Map, revision lists as Y.Array).

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createYDoc,
  entityToYMap,
  loadFlatStateIntoDoc,
  readFlatStateFromDoc,
  TOP_LEVEL_MAPS,
  type FlatState,
} from '@dayrail/db/yjs';
import { encodeDryj, type DryjMeta } from '@dayrail/db/dryj';
import { getYDoc, replaceFromRemote } from '../store';

function meta(snapshotId: string): DryjMeta {
  return {
    snapshotId,
    deviceId: 'test-device',
    deviceLabel: 'Test',
    createdAt: '2026-11-20T00:00:00Z',
    schemaVersion: 2,
  };
}

function toDryj(doc: Y.Doc, snapshotId: string): Uint8Array {
  return encodeDryj(meta(snapshotId), Y.encodeStateAsUpdate(doc));
}

function task(id: string, title: string): Record<string, unknown> {
  return { id, lineId: 'line-inbox', title, order: 0, status: 'pending' };
}

/** Representative slice of every structural flavor the Y.Doc holds:
 *  entity Y.Maps, a revision Y.Array, a plain-object tombstone, and
 *  the userProfile singleton. */
const SEED: Partial<FlatState> = {
  lines: {
    'line-inbox': {
      id: 'line-inbox',
      name: 'Inbox',
      kind: 'project',
      status: 'active',
      isDefault: true,
    },
  },
  tasks: { t1: task('t1', 'Original title') },
  rails: {
    r1: {
      id: 'r1',
      templateKey: 'workday',
      name: 'Morning',
      startMinutes: 540,
      durationMinutes: 60,
      color: 'sand',
      showInCheckin: false,
    },
  },
  railRevisions: {
    r1: [
      {
        id: 'rev-r1-2026-01-01',
        railId: 'r1',
        effectiveFrom: '2026-01-01',
        authoredAt: 100,
      },
    ],
  },
  railTombstones: {
    'r-dead': { effectiveFrom: '2026-01-05', at: 50 },
  },
  userProfile: {
    singleton: { id: 'singleton', enabledHolidayRegions: ['CN'] },
  },
};

beforeEach(() => {
  // The store's Y.Doc is a module singleton; start each test from
  // empty visible state (the accumulated CRDT history is exactly
  // what the shared-history scenarios below exercise).
  const doc = getYDoc();
  doc.transact(() => {
    for (const name of TOP_LEVEL_MAPS) doc.getMap(name).clear();
  });
});

describe('replaceFromRemote', () => {
  it('rollback: a doc sharing full history with the snapshot gets the snapshot content back, not an empty doc', () => {
    const doc = getYDoc();
    loadFlatStateIntoDoc(doc, SEED);
    const snapshot = toDryj(doc, 'snap-base');

    // Keep editing AFTER the snapshot was taken, so the live state
    // vector is strictly ahead and a bare history replay restores
    // nothing (the pre-fix failure mode).
    doc.transact(() => {
      const tasks = doc.getMap('tasks');
      (tasks.get('t1') as Y.Map<unknown>).set('title', 'Edited after snapshot');
      tasks.set('t2', entityToYMap(task('t2', 'Added after snapshot')));
      doc.getMap('rails').delete('r1');
      const revs = doc.getMap('railRevisions').get('r1') as Y.Array<unknown>;
      revs.push([
        {
          id: 'rev-r1-2026-02-01',
          railId: 'r1',
          effectiveFrom: '2026-02-01',
          authoredAt: 200,
        },
      ]);
    });

    replaceFromRemote(snapshot);

    const flat = readFlatStateFromDoc(doc);
    // Snapshot content restored — including the deleted rail…
    expect((flat.tasks['t1'] as { title?: string } | undefined)?.title).toBe(
      'Original title',
    );
    expect(Object.keys(flat.rails)).toEqual(['r1']);
    expect(flat.railRevisions['r1']).toHaveLength(1);
    expect((flat.railRevisions['r1']![0] as { id: string }).id).toBe(
      'rev-r1-2026-01-01',
    );
    expect(flat.railTombstones['r-dead']).toEqual({
      effectiveFrom: '2026-01-05',
      at: 50,
    });
    expect(
      (flat.userProfile['singleton'] as { enabledHolidayRegions?: string[] })
        .enabledHolidayRegions,
    ).toEqual(['CN']);
    // …and post-snapshot edits are gone (replace, not merge).
    expect(flat.tasks['t2']).toBeUndefined();
    expect(flat.railRevisions['r1']!).toHaveLength(1);

    // Structures stay hydrate-compatible: entities are Y.Maps,
    // revision lists are Y.Arrays (the read path type-filters on
    // these — plain-object entities would silently vanish).
    expect(doc.getMap('tasks').get('t1')).toBeInstanceOf(Y.Map);
    expect(doc.getMap('railRevisions').get('r1')).toBeInstanceOf(Y.Array);
    expect(doc.getMap('userProfile').get('singleton')).toBeInstanceOf(Y.Map);

    // Idempotent: replacing with the same snapshot again (now the
    // rewritten entries themselves share history) converges to the
    // same content.
    replaceFromRemote(snapshot);
    const again = readFlatStateFromDoc(doc);
    expect((again.tasks['t1'] as { title?: string } | undefined)?.title).toBe(
      'Original title',
    );
    expect(Object.keys(again.rails)).toEqual(['r1']);
  });

  it('same-direction pull: shared base + remote delta yields the full remote content, not just the delta', () => {
    const doc = getYDoc();
    loadFlatStateIntoDoc(doc, SEED);
    const baseUpdate = Y.encodeStateAsUpdate(doc);

    // Remote device: same base history, then edits a shared entity
    // and adds a new one.
    const remoteDoc = createYDoc();
    Y.applyUpdate(remoteDoc, baseUpdate);
    remoteDoc.transact(() => {
      const tasks = remoteDoc.getMap('tasks');
      (tasks.get('t1') as Y.Map<unknown>).set('title', 'Remote title');
      tasks.set('t2', entityToYMap(task('t2', 'Remote-added task')));
    });
    const remoteBytes = toDryj(remoteDoc, 'snap-remote');
    remoteDoc.destroy();

    replaceFromRemote(remoteBytes);

    const flat = readFlatStateFromDoc(doc);
    // Pre-fix behavior: only the remote delta (t2) survived; every
    // base entity (t1, r1, revisions, …) was wiped.
    expect((flat.tasks['t1'] as { title?: string } | undefined)?.title).toBe(
      'Remote title',
    );
    expect((flat.tasks['t2'] as { title?: string } | undefined)?.title).toBe(
      'Remote-added task',
    );
    expect(Object.keys(flat.rails)).toEqual(['r1']);
    expect(flat.railRevisions['r1']).toHaveLength(1);
    expect(flat.lines['line-inbox']).toBeDefined();
  });

  it('fresh device: no shared history — local samples are dropped and cloud content adopted under its original client ids', () => {
    const doc = getYDoc();
    loadFlatStateIntoDoc(doc, {
      lines: {
        'line-inbox': {
          id: 'line-inbox',
          name: 'Inbox',
          kind: 'project',
          status: 'active',
          isDefault: true,
        },
      },
      tasks: { 'sample-task': task('sample-task', 'Sample') },
    });

    // Cloud canonical authored entirely on other devices.
    const cloudDoc = createYDoc();
    loadFlatStateIntoDoc(cloudDoc, {
      tasks: { 't-cloud': task('t-cloud', 'Cloud task') },
      railRevisions: {
        r9: [
          {
            id: 'rev-r9-2026-03-01',
            railId: 'r9',
            effectiveFrom: '2026-03-01',
            authoredAt: 300,
          },
        ],
      },
    });
    const cloudUpdate = Y.encodeStateAsUpdate(cloudDoc);
    cloudDoc.destroy();

    replaceFromRemote(encodeDryj(meta('snap-cloud'), cloudUpdate));

    const flat = readFlatStateFromDoc(doc);
    expect(Object.keys(flat.tasks)).toEqual(['t-cloud']);
    expect(flat.lines['line-inbox']).toBeUndefined();
    expect(flat.railRevisions['r9']).toHaveLength(1);

    // The replay adopted the cloud items under their ORIGINAL client
    // ids (no local re-authoring), so a later field-level CRDT merge
    // from another synced device lands deterministically on the same
    // entity instead of forking a parallel copy.
    const otherDevice = createYDoc();
    Y.applyUpdate(otherDevice, cloudUpdate);
    otherDevice.transact(() => {
      (otherDevice.getMap('tasks').get('t-cloud') as Y.Map<unknown>).set(
        'title',
        'Edited on another device',
      );
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(otherDevice));
    otherDevice.destroy();

    const merged = readFlatStateFromDoc(doc);
    expect(
      (merged.tasks['t-cloud'] as { title?: string } | undefined)?.title,
    ).toBe('Edited on another device');
  });

  it('replacing with an empty snapshot empties the doc (replace semantics hold in the degenerate case)', () => {
    const doc = getYDoc();
    loadFlatStateIntoDoc(doc, SEED);

    const emptyDoc = createYDoc();
    const emptyBytes = toDryj(emptyDoc, 'snap-empty');
    emptyDoc.destroy();

    replaceFromRemote(emptyBytes);

    const flat = readFlatStateFromDoc(doc);
    expect(Object.keys(flat.tasks)).toEqual([]);
    expect(Object.keys(flat.rails)).toEqual([]);
    expect(Object.keys(flat.railRevisions)).toEqual([]);
  });
});
