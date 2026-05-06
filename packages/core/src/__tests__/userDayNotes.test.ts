// ERD §14.3 — Y.Doc CRUD + concurrent-merge tests for UserDayNote.
//
// The "keyed by id, not by date" claim from §14.3 deserves a real
// concurrent test: two devices each create a note on the same date,
// CRDT-merge, and we verify both notes survive (which is the
// motivation for keying by id in the first place — keying by date
// would LWW one of them away).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createYDoc,
  encodeDocAsUpdate,
  entityToYMap,
  patchEntityYMap,
  readFlatStateFromDoc,
} from '@dayrail/db/yjs';

function readNotes(doc: Y.Doc): Record<string, unknown> {
  return readFlatStateFromDoc(doc).userDayNotes;
}

function placeNote(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
): void {
  doc.transact(() => {
    doc.getMap('userDayNotes').set(id, entityToYMap(fields));
  });
}

describe('userDayNotes Y.Doc round-trip', () => {
  it('round-trips a single note', () => {
    const doc = createYDoc();
    placeNote(doc, 'n1', {
      id: 'n1',
      date: '2026-05-12',
      label: '妈妈生日',
      color: 'pink',
      createdAt: 1000,
      updatedAt: 1000,
    });
    const notes = readNotes(doc);
    expect(notes.n1).toEqual({
      id: 'n1',
      date: '2026-05-12',
      label: '妈妈生日',
      color: 'pink',
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('drops the row on delete', () => {
    const doc = createYDoc();
    placeNote(doc, 'n1', { id: 'n1', date: '2026-05-12', label: 'A', createdAt: 1, updatedAt: 1 });
    doc.transact(() => doc.getMap('userDayNotes').delete('n1'));
    expect(readNotes(doc)).toEqual({});
  });

  it('updates a single field via patchEntityYMap', () => {
    const doc = createYDoc();
    placeNote(doc, 'n1', {
      id: 'n1',
      date: '2026-05-12',
      label: 'A',
      createdAt: 1,
      updatedAt: 1,
    });
    doc.transact(() => {
      const map = doc.getMap('userDayNotes');
      const ymap = map.get('n1') as Y.Map<unknown>;
      patchEntityYMap(ymap, { label: 'B', updatedAt: 2 });
    });
    const notes = readNotes(doc);
    expect((notes.n1 as Record<string, unknown>).label).toBe('B');
    expect((notes.n1 as Record<string, unknown>).updatedAt).toBe(2);
    // Untouched fields remain.
    expect((notes.n1 as Record<string, unknown>).date).toBe('2026-05-12');
    expect((notes.n1 as Record<string, unknown>).createdAt).toBe(1);
  });
});

describe('userDayNotes CRDT merge across two devices', () => {
  it('keeps both notes when two devices create on the same date concurrently', () => {
    const docA = createYDoc();
    const docB = createYDoc();

    // Device A creates note `a1`. Device B creates note `b1`. Both
    // happen "concurrently" — neither has applied the other's update
    // before the next exchange.
    placeNote(docA, 'a1', {
      id: 'a1',
      date: '2026-05-12',
      label: 'A 端的备注',
      createdAt: 1000,
      updatedAt: 1000,
    });
    placeNote(docB, 'b1', {
      id: 'b1',
      date: '2026-05-12',
      label: 'B 端的备注',
      createdAt: 1001,
      updatedAt: 1001,
    });

    // Bidirectional merge: each device receives the other's update.
    Y.applyUpdate(docA, encodeDocAsUpdate(docB));
    Y.applyUpdate(docB, encodeDocAsUpdate(docA));

    const a = readNotes(docA);
    const b = readNotes(docB);
    expect(Object.keys(a).sort()).toEqual(['a1', 'b1']);
    expect(Object.keys(b).sort()).toEqual(['a1', 'b1']);
    expect((a.a1 as Record<string, unknown>).label).toBe('A 端的备注');
    expect((a.b1 as Record<string, unknown>).label).toBe('B 端的备注');
  });

  it('field-level CRDT merge — one device edits label, the other edits color', () => {
    const docA = createYDoc();
    placeNote(docA, 'n1', {
      id: 'n1',
      date: '2026-05-12',
      label: '原始 label',
      color: 'sand',
      createdAt: 100,
      updatedAt: 100,
    });
    // Both devices start from the same baseline.
    const docB = createYDoc();
    Y.applyUpdate(docB, encodeDocAsUpdate(docA));

    // Concurrent edits on different fields of the same note.
    docA.transact(() => {
      const map = docA.getMap('userDayNotes');
      patchEntityYMap(map.get('n1') as Y.Map<unknown>, {
        label: 'A 改的 label',
        updatedAt: 200,
      });
    });
    docB.transact(() => {
      const map = docB.getMap('userDayNotes');
      patchEntityYMap(map.get('n1') as Y.Map<unknown>, {
        color: 'pink',
        updatedAt: 201,
      });
    });

    Y.applyUpdate(docA, encodeDocAsUpdate(docB));
    Y.applyUpdate(docB, encodeDocAsUpdate(docA));

    const mergedA = readNotes(docA).n1 as Record<string, unknown>;
    const mergedB = readNotes(docB).n1 as Record<string, unknown>;
    // Both edits to *different fields* survive (this is the field-level
    // merge guarantee).
    expect(mergedA.label).toBe('A 改的 label');
    expect(mergedA.color).toBe('pink');
    // Both devices converge to the same state.
    expect(mergedB).toEqual(mergedA);
    // updatedAt is a LWW field — Yjs picks one of {200, 201} via its
    // internal Lamport clock, not by value. We don't assert which
    // (the user-data semantics here is "either is fine; it's just an
    // audit timestamp"); the important property is convergence.
    expect([200, 201]).toContain(mergedA.updatedAt);
  });

  it('one device delete, the other edit — Yjs converges (delete wins by default)', () => {
    const docA = createYDoc();
    placeNote(docA, 'n1', {
      id: 'n1',
      date: '2026-05-12',
      label: 'A',
      createdAt: 1,
      updatedAt: 1,
    });
    const docB = createYDoc();
    Y.applyUpdate(docB, encodeDocAsUpdate(docA));

    // A deletes; B edits.
    docA.transact(() => docA.getMap('userDayNotes').delete('n1'));
    docB.transact(() => {
      patchEntityYMap(
        docB.getMap('userDayNotes').get('n1') as Y.Map<unknown>,
        { label: 'B 改的', updatedAt: 5 },
      );
    });

    Y.applyUpdate(docA, encodeDocAsUpdate(docB));
    Y.applyUpdate(docB, encodeDocAsUpdate(docA));

    // Both devices converge. Default Yjs behavior: parent-map delete
    // removes the row even if the inner Y.Map has been edited — the
    // edits to the dangling Y.Map are kept inside the GC store but
    // not surfaced via the parent map. From our flat-state view this
    // looks like "delete wins". Acceptable for v0.8.0 user-day-notes
    // — the alternative (always preserve edits) would need a tombstone
    // scheme, which the spec explicitly didn't ask for.
    expect(readNotes(docA)).toEqual({});
    expect(readNotes(docB)).toEqual({});
  });

});
