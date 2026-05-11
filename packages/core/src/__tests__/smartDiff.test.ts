// Tests for smartDiff (ERD §7.8 · v1.0 sync redesign · P2). Pure
// algorithm — every test builds three synthetic Y.Docs (base, local,
// remote), runs `classify`, and asserts the branch + payload.
//
// The classifier is the load-bearing piece of the redesign; its job
// is to replace v0.7's silent CRDT LWW with three transparent
// branches (same-direction / orthogonal / true-conflict). The tests
// here cover the cases the user can hit in real dogfood:
//   · concurrent same-direction reconfirms (mark done on both devices)
//   · concurrent orthogonal edits (A renames, B re-prioritizes)
//   · genuine field-level conflicts (A and B set title to different values)
//   · add/remove asymmetry (A adds entity, B unchanged · A removes, B modifies)
//   · array fields (subItems) — conservative deep-equal compare
//   · empty diffs (no local changes → vacuously same-direction)

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  ENTITY_LEVEL_CONFLICT_FIELD,
  classify,
  snapshotDiff,
  toSnapshotJson,
  unionTopLevelKeys,
  type Classification,
} from '../smartDiff';

// ── helpers ───────────────────────────────────────────────────────

function makeDoc(
  builder: (doc: Y.Doc) => void,
): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => builder(doc));
  return doc;
}

function setEntity(
  doc: Y.Doc,
  store: string,
  id: string,
  fields: Record<string, unknown>,
): void {
  const m = doc.getMap(store);
  const entity = new Y.Map();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      const arr = new Y.Array();
      arr.insert(0, v);
      entity.set(k, arr);
    } else {
      entity.set(k, v);
    }
  }
  m.set(id, entity);
}

function updateEntityField(
  doc: Y.Doc,
  store: string,
  id: string,
  field: string,
  value: unknown,
): void {
  const m = doc.getMap(store);
  const entity = m.get(id);
  if (!(entity instanceof Y.Map)) {
    throw new Error(`entity ${store}/${id} is not a Y.Map`);
  }
  if (Array.isArray(value)) {
    const arr = new Y.Array();
    arr.insert(0, value);
    entity.set(field, arr);
  } else {
    entity.set(field, value);
  }
}

function removeEntity(doc: Y.Doc, store: string, id: string): void {
  doc.getMap(store).delete(id);
}

function cloneDoc(src: Y.Doc): Y.Doc {
  const bytes = Y.encodeStateAsUpdate(src);
  const dst = new Y.Doc();
  Y.applyUpdate(dst, bytes);
  return dst;
}

// ── trivial cases ─────────────────────────────────────────────────

describe('smartDiff · trivial cases', () => {
  it('identical docs → same-direction', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A', priority: 'P1' });
    });
    const local = cloneDoc(base);
    const remote = cloneDoc(base);
    expect(classify(base, local, remote).type).toBe('same-direction');
  });

  it('empty docs → same-direction', () => {
    const base = new Y.Doc();
    const local = new Y.Doc();
    const remote = new Y.Doc();
    expect(classify(base, local, remote).type).toBe('same-direction');
  });

  it('local empty, remote has changes → same-direction (vacuous subset)', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
    });
    const local = cloneDoc(base);
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'title', 'B');
    const result = classify(base, local, remote);
    expect(result.type).toBe('same-direction');
  });

  it('remote empty, local has changes → orthogonal (local-only merge)', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'title', 'A2');
    const remote = cloneDoc(base);
    const result = classify(base, local, remote);
    expect(result.type).toBe('orthogonal');
    if (result.type === 'orthogonal') {
      expect((result.merged.tasks?.t1 as Record<string, unknown>)?.title).toBe(
        'A2',
      );
    }
  });
});

// ── same-direction ────────────────────────────────────────────────

describe('smartDiff · same-direction', () => {
  it('both devices made the same field change → same-direction', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A', done: false });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'done', true);
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'done', true);
    expect(classify(base, local, remote).type).toBe('same-direction');
  });

  it('both devices added the same entity with identical fields → same-direction', () => {
    const base = new Y.Doc();
    const local = cloneDoc(base);
    setEntity(local, 'tasks', 'new-t', { title: 'New', priority: 'P1' });
    const remote = cloneDoc(base);
    setEntity(remote, 'tasks', 'new-t', { title: 'New', priority: 'P1' });
    expect(classify(base, local, remote).type).toBe('same-direction');
  });

  it('both devices removed the same entity → same-direction', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
    });
    const local = cloneDoc(base);
    removeEntity(local, 'tasks', 't1');
    const remote = cloneDoc(base);
    removeEntity(remote, 'tasks', 't1');
    expect(classify(base, local, remote).type).toBe('same-direction');
  });

  it('local subset: A changed title+done, B changed title+done+priority (same values for shared) → still same-direction (local ⊆ remote)', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', {
        title: 'A',
        done: false,
        priority: 'P2',
      });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'title', 'A2');
    updateEntityField(local, 'tasks', 't1', 'done', true);
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'title', 'A2');
    updateEntityField(remote, 'tasks', 't1', 'done', true);
    updateEntityField(remote, 'tasks', 't1', 'priority', 'P0');
    expect(classify(base, local, remote).type).toBe('same-direction');
  });
});

// ── orthogonal ────────────────────────────────────────────────────

describe('smartDiff · orthogonal', () => {
  it('local + remote touched different entities → orthogonal merge', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
      setEntity(d, 'tasks', 't2', { title: 'B' });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'title', 'A2');
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't2', 'title', 'B2');
    const result = classify(base, local, remote);
    expect(result.type).toBe('orthogonal');
    if (result.type === 'orthogonal') {
      expect((result.merged.tasks?.t1 as Record<string, unknown>).title).toBe(
        'A2',
      );
      expect((result.merged.tasks?.t2 as Record<string, unknown>).title).toBe(
        'B2',
      );
    }
  });

  it('local + remote touched different fields of same entity → orthogonal merge', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A', priority: 'P1', done: false });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'title', 'A2');
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'priority', 'P0');
    const result = classify(base, local, remote);
    expect(result.type).toBe('orthogonal');
    if (result.type === 'orthogonal') {
      const t1 = result.merged.tasks?.t1 as Record<string, unknown>;
      expect(t1.title).toBe('A2');
      expect(t1.priority).toBe('P0');
      expect(t1.done).toBe(false); // unchanged
    }
  });

  it('local added entity, remote untouched on that entity → orthogonal includes local-add', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
    });
    const local = cloneDoc(base);
    setEntity(local, 'tasks', 't2', { title: 'B' });
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'title', 'A2');
    const result = classify(base, local, remote);
    expect(result.type).toBe('orthogonal');
    if (result.type === 'orthogonal') {
      expect((result.merged.tasks?.t1 as Record<string, unknown>).title).toBe(
        'A2',
      );
      expect((result.merged.tasks?.t2 as Record<string, unknown>).title).toBe(
        'B',
      );
    }
  });

  it('local removed entity, remote untouched on that entity → orthogonal omits removed', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
      setEntity(d, 'tasks', 't2', { title: 'B' });
    });
    const local = cloneDoc(base);
    removeEntity(local, 'tasks', 't1');
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't2', 'title', 'B2');
    const result = classify(base, local, remote);
    expect(result.type).toBe('orthogonal');
    if (result.type === 'orthogonal') {
      expect(result.merged.tasks?.t1).toBeUndefined();
      expect((result.merged.tasks?.t2 as Record<string, unknown>).title).toBe(
        'B2',
      );
    }
  });

  it('local touched store A, remote touched store B → orthogonal across stores', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
      setEntity(d, 'lines', 'l1', { name: 'Inbox' });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'title', 'A2');
    const remote = cloneDoc(base);
    updateEntityField(remote, 'lines', 'l1', 'name', 'Inbox-rev');
    const result = classify(base, local, remote);
    expect(result.type).toBe('orthogonal');
    if (result.type === 'orthogonal') {
      expect((result.merged.tasks?.t1 as Record<string, unknown>).title).toBe(
        'A2',
      );
      expect((result.merged.lines?.l1 as Record<string, unknown>).name).toBe(
        'Inbox-rev',
      );
    }
  });
});

// ── true conflict ─────────────────────────────────────────────────

describe('smartDiff · true conflict', () => {
  it('same entity, same field, different values → true-conflict', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'title', 'A-local');
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'title', 'A-remote');
    const result = classify(base, local, remote);
    expect(result.type).toBe('true-conflict');
    if (result.type === 'true-conflict') {
      expect(result.conflicts).toHaveLength(1);
      const c = result.conflicts[0]!;
      expect(c.storeKey).toBe('tasks');
      expect(c.entityId).toBe('t1');
      expect(c.field).toBe('title');
      expect(c.baseValue).toBe('A');
      expect(c.localValue).toBe('A-local');
      expect(c.remoteValue).toBe('A-remote');
    }
  });

  it('local deleted entity, remote modified it → entity-level conflict', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
    });
    const local = cloneDoc(base);
    removeEntity(local, 'tasks', 't1');
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'title', 'A2');
    const result = classify(base, local, remote);
    expect(result.type).toBe('true-conflict');
    if (result.type === 'true-conflict') {
      expect(result.conflicts).toHaveLength(1);
      const c = result.conflicts[0]!;
      expect(c.field).toBe(ENTITY_LEVEL_CONFLICT_FIELD);
      expect(c.localValue).toBeNull();
      expect((c.remoteValue as Record<string, unknown>).title).toBe('A2');
    }
  });

  it('both added same id with different content → field-level conflicts', () => {
    const base = new Y.Doc();
    const local = cloneDoc(base);
    setEntity(local, 'tasks', 'new-t', { title: 'Local', priority: 'P1' });
    const remote = cloneDoc(base);
    setEntity(remote, 'tasks', 'new-t', { title: 'Remote', priority: 'P1' });
    const result = classify(base, local, remote);
    expect(result.type).toBe('true-conflict');
    if (result.type === 'true-conflict') {
      // Only the differing field surfaces — priority matched.
      expect(result.conflicts).toHaveLength(1);
      const c = result.conflicts[0]!;
      expect(c.field).toBe('title');
      expect(c.localValue).toBe('Local');
      expect(c.remoteValue).toBe('Remote');
    }
  });

  it('conflict + orthogonal mixed → still classified as conflict (conflict wins)', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
      setEntity(d, 'tasks', 't2', { title: 'B' });
    });
    const local = cloneDoc(base);
    // t1: same field different value → conflict
    updateEntityField(local, 'tasks', 't1', 'title', 'A-local');
    // t2: local-only modification → would be orthogonal alone
    updateEntityField(local, 'tasks', 't2', 'title', 'B-local');
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'title', 'A-remote');
    // remote leaves t2 untouched
    const result = classify(base, local, remote);
    expect(result.type).toBe('true-conflict');
    if (result.type === 'true-conflict') {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.entityId).toBe('t1');
    }
  });
});

// ── arrays (conservative · deep-equal) ────────────────────────────

describe('smartDiff · array fields', () => {
  it('identical array changes on both sides → same-direction', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { tags: ['a', 'b'] });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'tags', ['a', 'b', 'c']);
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'tags', ['a', 'b', 'c']);
    expect(classify(base, local, remote).type).toBe('same-direction');
  });

  it('different array changes (conservative) → true-conflict', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { tags: ['a', 'b'] });
    });
    const local = cloneDoc(base);
    updateEntityField(local, 'tasks', 't1', 'tags', ['a', 'b', 'x']);
    const remote = cloneDoc(base);
    updateEntityField(remote, 'tasks', 't1', 'tags', ['a', 'b', 'y']);
    const result = classify(base, local, remote);
    // Both touched the `tags` field with different final values —
    // conservative deep-equal treats this as a conflict even though
    // semantically a set union ['a','b','x','y'] might be sensible.
    // Future P2.x refinement could add array-aware merging.
    expect(result.type).toBe('true-conflict');
  });
});

// ── snapshotDiff sanity ───────────────────────────────────────────

describe('snapshotDiff', () => {
  it('empty diff for identical docs', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', { title: 'A' });
    });
    const next = cloneDoc(base);
    const keys = unionTopLevelKeys([base, next]);
    expect(snapshotDiff(base, next, keys).changes).toEqual([]);
  });

  it('detects added / modified / removed in one pass', () => {
    const base = makeDoc((d) => {
      setEntity(d, 'tasks', 'keep', { title: 'K' });
      setEntity(d, 'tasks', 'modify', { title: 'M', priority: 'P2' });
      setEntity(d, 'tasks', 'remove', { title: 'R' });
    });
    const next = cloneDoc(base);
    setEntity(next, 'tasks', 'add', { title: 'A' });
    updateEntityField(next, 'tasks', 'modify', 'title', 'M-new');
    removeEntity(next, 'tasks', 'remove');
    const keys = unionTopLevelKeys([base, next]);
    const diff = snapshotDiff(base, next, keys);
    const byId = new Map(diff.changes.map((c) => [c.entityId, c]));
    expect(byId.get('keep')).toBeUndefined();
    expect(byId.get('add')?.kind).toBe('added');
    expect(byId.get('modify')?.kind).toBe('modified');
    expect(byId.get('modify')?.fields?.title).toEqual({
      base: 'M',
      next: 'M-new',
    });
    expect(byId.get('remove')?.kind).toBe('removed');
  });
});

// ── toSnapshotJson sanity ─────────────────────────────────────────

describe('toSnapshotJson', () => {
  it('walks top-level Y.Maps, recursively unwraps nested Y.Map/Y.Array', () => {
    const doc = makeDoc((d) => {
      setEntity(d, 'tasks', 't1', {
        title: 'A',
        tags: ['x', 'y'],
      });
    });
    const json = toSnapshotJson(doc, ['tasks']);
    const t1 = json.tasks?.t1 as Record<string, unknown>;
    expect(t1.title).toBe('A');
    expect(t1.tags).toEqual(['x', 'y']);
  });

  // Suppress no-op classification on the type-only Classification
  // export so tree-shaken builds don't drop it (and so future
  // refactors keep the public surface intact).
  it('Classification type is exported', () => {
    const c: Classification = { type: 'same-direction' };
    expect(c.type).toBe('same-direction');
  });
});
