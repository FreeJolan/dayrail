// Tests for the Y.Doc schema + state↔Y.Doc converters
// (packages/db/src/yjs.ts). These exercise the parts of the schema
// that have actually regressed during external review:
//   - Round 4 read-time dedupRevisions
//   - The "every revision-bearing entity round-trips" guarantee
//   - The "subItems is plain JS array, atomic LWW" decision
//
// Targeted at unit-level — full Y.applyUpdate-merge convergence
// tests would need a 2-doc fixture; defer to integration tests.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createYDoc,
  encodeDocAsUpdate,
  entityToYMap,
  loadFlatStateIntoDoc,
  patchEntityYMap,
  readFlatStateFromDoc,
  TOP_LEVEL_MAPS,
  yMapToEntity,
  type FlatState,
} from '@dayrail/db/yjs';

describe('createYDoc', () => {
  it('registers every top-level map', () => {
    const doc = createYDoc();
    for (const name of TOP_LEVEL_MAPS) {
      const m = doc.getMap(name);
      expect(m).toBeDefined();
      expect(m.size).toBe(0);
    }
  });
});

// entityToYMap returns a Y.Map with prelim content (not yet
// integrated into a doc); .forEach doesn't iterate prelim content
// in current Yjs. Real usage always immediately integrates the
// Y.Map into a parent map inside a transact, so all the tests below
// place the entity into a doc-integrated parent first.

function placeAndRead(
  doc: Y.Doc,
  parentName: string,
  id: string,
  entity: Record<string, unknown>,
  arrayFields: ReadonlyArray<string> = [],
): Record<string, unknown> {
  doc.transact(() => {
    doc.getMap(parentName).set(id, entityToYMap(entity, arrayFields));
  });
  const ymap = doc.getMap(parentName).get(id) as Y.Map<unknown>;
  return yMapToEntity(ymap);
}

describe('entityToYMap / yMapToEntity (doc-integrated)', () => {
  it('round-trips scalar fields', () => {
    const doc = createYDoc();
    const entity = {
      id: 'rail-1',
      name: 'Morning',
      startMinutes: 480,
      durationMinutes: 60,
      color: 'sand',
      showInCheckin: true,
    };
    expect(placeAndRead(doc, 'rails', 'rail-1', entity)).toEqual(entity);
  });

  it('drops undefined fields (matches v0.7 omit-undefined convention)', () => {
    const doc = createYDoc();
    const entity = { id: 'task-1', title: 'Test', note: undefined };
    const out = placeAndRead(doc, 'tasks', 'task-1', entity);
    expect(out).toEqual({ id: 'task-1', title: 'Test' });
    expect('note' in out).toBe(false);
  });

  it('stores plain arrays without Y.Array wrapping by default', () => {
    const doc = createYDoc();
    const entity = {
      id: 'task-1',
      subItems: [{ id: 's1', title: 'step', done: false }],
      tags: ['a', 'b'],
    };
    expect(placeAndRead(doc, 'tasks', 'task-1', entity)).toEqual(entity);
  });

  it('wraps explicitly-named array fields as Y.Array', () => {
    const doc = createYDoc();
    const entity = { id: 'x', items: ['a', 'b', 'c'] };
    doc.transact(() => {
      doc.getMap('tasks').set('x', entityToYMap(entity, ['items']));
    });
    const ymap = doc.getMap('tasks').get('x') as Y.Map<unknown>;
    expect(ymap.get('items')).toBeInstanceOf(Y.Array);
    expect(yMapToEntity(ymap)).toEqual(entity);
  });
});

describe('patchEntityYMap (doc-integrated)', () => {
  it('overwrites scalar fields', () => {
    const doc = createYDoc();
    doc.transact(() => {
      doc
        .getMap('tasks')
        .set('t1', entityToYMap({ id: 't1', title: 'old', order: 1 }));
    });
    const ymap = doc.getMap('tasks').get('t1') as Y.Map<unknown>;
    doc.transact(() => {
      patchEntityYMap(ymap, { title: 'new', order: 2 });
    });
    expect(yMapToEntity(ymap)).toEqual({ id: 't1', title: 'new', order: 2 });
  });

  it('removes a field when the patch sets it to undefined', () => {
    const doc = createYDoc();
    doc.transact(() => {
      doc.getMap('tasks').set(
        't1',
        entityToYMap({ id: 't1', title: 'x', deletedAt: '2026-01-01' }),
      );
    });
    const ymap = doc.getMap('tasks').get('t1') as Y.Map<unknown>;
    doc.transact(() => patchEntityYMap(ymap, { deletedAt: undefined }));
    expect(ymap.has('deletedAt')).toBe(false);
  });

  it('replaces a Y.Array field wholesale via the arrayFields hint', () => {
    const doc = createYDoc();
    doc.transact(() => {
      doc
        .getMap('tasks')
        .set('t', entityToYMap({ id: 't', items: ['a'] }, ['items']));
    });
    const ymap = doc.getMap('tasks').get('t') as Y.Map<unknown>;
    doc.transact(() => patchEntityYMap(ymap, { items: ['b', 'c'] }, ['items']));
    expect(yMapToEntity(ymap)).toEqual({ id: 't', items: ['b', 'c'] });
  });
});

describe('loadFlatStateIntoDoc + readFlatStateFromDoc', () => {
  it('round-trips a multi-entity state', () => {
    const state: Partial<FlatState> = {
      templates: {
        weekday: { key: 'weekday', name: 'Workday', isDefault: true },
      },
      rails: {
        'rail-1': {
          id: 'rail-1',
          templateKey: 'weekday',
          name: 'Morning',
          startMinutes: 480,
          durationMinutes: 60,
          color: 'sand',
          showInCheckin: true,
        },
      },
      tasks: {
        't-1': {
          id: 't-1',
          lineId: 'line-inbox',
          title: 'Test',
          order: 0,
          status: 'pending',
          subItems: [{ id: 's1', title: 'step', done: false }],
        },
      },
      lines: {
        'line-inbox': {
          id: 'line-inbox',
          name: 'Inbox',
          status: 'active',
          kind: 'project',
          isDefault: true,
          createdAt: 1714440000000,
        },
      },
      railTombstones: {
        'old-rail': {
          effectiveFrom: '2026-01-01',
          at: 1714440000000,
        },
      },
    };
    const doc = createYDoc();
    loadFlatStateIntoDoc(doc, state);
    const flat = readFlatStateFromDoc(doc);
    expect(flat.templates).toEqual(state.templates);
    expect(flat.rails).toEqual(state.rails);
    expect(flat.tasks).toEqual(state.tasks);
    expect(flat.lines).toEqual(state.lines);
    expect(flat.railTombstones).toEqual(state.railTombstones);
  });

  it('round-trips revision arrays', () => {
    const state: Partial<FlatState> = {
      railRevisions: {
        'rail-1': [
          {
            id: 'rev-rail-rail-1-2026-01-01',
            railId: 'rail-1',
            effectiveFrom: '2026-01-01',
            templateKey: 'weekday',
            name: 'v1',
            startMinutes: 480,
            durationMinutes: 60,
            color: 'sand',
            showInCheckin: true,
            authoredAt: 1000,
          },
          {
            id: 'rev-rail-rail-1-2026-02-01',
            railId: 'rail-1',
            effectiveFrom: '2026-02-01',
            templateKey: 'weekday',
            name: 'v2',
            startMinutes: 540,
            durationMinutes: 60,
            color: 'sand',
            showInCheckin: true,
            authoredAt: 2000,
          },
        ],
      },
    };
    const doc = createYDoc();
    loadFlatStateIntoDoc(doc, state);
    const flat = readFlatStateFromDoc(doc);
    expect(flat.railRevisions).toEqual(state.railRevisions);
  });
});

describe('readFlatStateFromDoc dedupRevisions', () => {
  // Round 4 added dedup-by-id at read time. Same id with different
  // authoredAt → keep max authoredAt (handles concurrent appends
  // from two devices for the same deterministic-id revision).

  it('collapses same-id revision entries, keeping max authoredAt', () => {
    const doc = createYDoc();
    const railRevisions = doc.getMap('railRevisions');
    const arr = new Y.Array<unknown>();
    arr.push([
      {
        id: 'rev-rail-rail-1-2026-01-01',
        railId: 'rail-1',
        effectiveFrom: '2026-01-01',
        name: 'device-A version',
        authoredAt: 1000,
      },
      {
        id: 'rev-rail-rail-1-2026-01-01',
        railId: 'rail-1',
        effectiveFrom: '2026-01-01',
        name: 'device-B version (later)',
        authoredAt: 2000,
      },
    ]);
    railRevisions.set('rail-1', arr);

    const flat = readFlatStateFromDoc(doc);
    const revs = flat.railRevisions['rail-1'] as Array<{
      id: string;
      authoredAt: number;
      name: string;
    }>;
    expect(revs).toHaveLength(1);
    expect(revs[0]?.authoredAt).toBe(2000);
    expect(revs[0]?.name).toBe('device-B version (later)');
  });

  it('preserves revisions with distinct ids', () => {
    const doc = createYDoc();
    const railRevisions = doc.getMap('railRevisions');
    const arr = new Y.Array<unknown>();
    arr.push([
      {
        id: 'rev-rail-rail-1-2026-01-01',
        railId: 'rail-1',
        effectiveFrom: '2026-01-01',
        authoredAt: 1000,
      },
      {
        id: 'rev-rail-rail-1-2026-02-01',
        railId: 'rail-1',
        effectiveFrom: '2026-02-01',
        authoredAt: 2000,
      },
    ]);
    railRevisions.set('rail-1', arr);

    const flat = readFlatStateFromDoc(doc);
    expect(flat.railRevisions['rail-1']).toHaveLength(2);
  });

  it('handles entries without an id by dropping them (defensive)', () => {
    const doc = createYDoc();
    const railRevisions = doc.getMap('railRevisions');
    const arr = new Y.Array<unknown>();
    arr.push([
      { railId: 'rail-1', effectiveFrom: '2026-01-01', authoredAt: 1 },
      { id: 'good', railId: 'rail-1', effectiveFrom: '2026-01-01', authoredAt: 2 },
    ]);
    railRevisions.set('rail-1', arr);

    const flat = readFlatStateFromDoc(doc);
    const revs = flat.railRevisions['rail-1'] as Array<{ id?: string }>;
    expect(revs).toHaveLength(1);
    expect(revs[0]?.id).toBe('good');
  });
});

describe('encodeDocAsUpdate / Y.applyUpdate convergence', () => {
  it('a fresh doc applies the encoded update of another doc', () => {
    // Smoke test: two docs, write to A, copy A's state to B via
    // encodeStateAsUpdate + applyUpdate, B sees A's data.
    const a = createYDoc();
    const tasks = a.getMap('tasks');
    tasks.set('t-1', entityToYMap({ id: 't-1', title: 'from A', order: 0 }));

    const update = encodeDocAsUpdate(a);

    const b = createYDoc();
    Y.applyUpdate(b, update);

    const tasksB = b.getMap('tasks');
    const t = tasksB.get('t-1');
    expect(t).toBeInstanceOf(Y.Map);
    expect(yMapToEntity(t as Y.Map<unknown>)).toEqual({
      id: 't-1',
      title: 'from A',
      order: 0,
    });
  });

  it('field-level merge: two docs writing different fields of same entity converge', () => {
    // Both docs start from the same base (a → encode → b applies).
    // Then a writes title, b writes note. Both encode and apply each
    // other. Final state on both should have BOTH title and note.
    const base = createYDoc();
    const tBase = entityToYMap({ id: 't-1', title: 'orig', note: 'orig' });
    base.getMap('tasks').set('t-1', tBase);
    const baseUpdate = encodeDocAsUpdate(base);

    const docA = createYDoc();
    Y.applyUpdate(docA, baseUpdate);
    const docB = createYDoc();
    Y.applyUpdate(docB, baseUpdate);

    // A updates title; B updates note. Different fields.
    const tA = docA.getMap('tasks').get('t-1') as Y.Map<unknown>;
    docA.transact(() => tA.set('title', 'A-title'));
    const tB = docB.getMap('tasks').get('t-1') as Y.Map<unknown>;
    docB.transact(() => tB.set('note', 'B-note'));

    // Cross-apply.
    Y.applyUpdate(docA, encodeDocAsUpdate(docB));
    Y.applyUpdate(docB, encodeDocAsUpdate(docA));

    const finalA = yMapToEntity(
      docA.getMap('tasks').get('t-1') as Y.Map<unknown>,
    );
    const finalB = yMapToEntity(
      docB.getMap('tasks').get('t-1') as Y.Map<unknown>,
    );
    expect(finalA).toEqual({ id: 't-1', title: 'A-title', note: 'B-note' });
    expect(finalB).toEqual(finalA);
  });

  it('same-direction concurrent edit: two docs marking same task done converge', () => {
    // ERD §7.7's headline pain point: device A marks task done,
    // device B (without seeing A's change) marks task done. Both
    // transactions write the same value to the same field. After
    // exchange, no conflict UI fires; both end with status='done'.
    const base = createYDoc();
    base
      .getMap('tasks')
      .set('t-1', entityToYMap({ id: 't-1', status: 'pending' }));
    const baseUpdate = encodeDocAsUpdate(base);

    const docA = createYDoc();
    Y.applyUpdate(docA, baseUpdate);
    const docB = createYDoc();
    Y.applyUpdate(docB, baseUpdate);

    const tA = docA.getMap('tasks').get('t-1') as Y.Map<unknown>;
    docA.transact(() => tA.set('status', 'done'));
    const tB = docB.getMap('tasks').get('t-1') as Y.Map<unknown>;
    docB.transact(() => tB.set('status', 'done'));

    Y.applyUpdate(docA, encodeDocAsUpdate(docB));
    Y.applyUpdate(docB, encodeDocAsUpdate(docA));

    const finalA = yMapToEntity(
      docA.getMap('tasks').get('t-1') as Y.Map<unknown>,
    );
    const finalB = yMapToEntity(
      docB.getMap('tasks').get('t-1') as Y.Map<unknown>,
    );
    expect(finalA.status).toBe('done');
    expect(finalB.status).toBe('done');
  });
});
