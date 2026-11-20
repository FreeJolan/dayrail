// Regression tests for OpfsYDocStore's write discipline against an
// in-memory fake OPFS root:
//
//   - audit #8  — two store instances (≈ two tabs) must never share a
//     .tmp filename, so overlapping atomic writes can't truncate each
//     other mid-flight;
//   - audit #48 — reset()/deleteYDoc() must queue behind in-flight
//     saves on the same per-file serial chain instead of racing them
//     (a save landing after the wipe would resurrect old data);
//   - audit #40 — quarantineYDoc() must move the corrupt state file
//     aside (never delete / overwrite) under `.corrupt-<n>` names.
//
// The store is imported by relative path — the class itself isn't a
// public export of @dayrail/db (only the factory is), and the tests
// need to construct isolated instances against a stubbed
// `navigator.storage.getDirectory`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpfsYDocStore } from '../../../db/src/opfsYDocStore';

// ---- In-memory fake OPFS ----

function notFound(): Error {
  const err = new Error('A requested file or directory could not be found');
  err.name = 'NotFoundError';
  return err;
}

type FakeFs = {
  files: Map<string, Uint8Array>;
  /** Every name passed to getFileHandle(create: true). */
  createdNames: string[];
  /** When set, writable.close() parks on this promise — lets a test
   *  hold a write "in flight" while other calls arrive. */
  writeGate: Promise<void> | null;
};

function makeFakeRoot(fs: FakeFs) {
  const makeFileHandle = (name: string) => ({
    name,
    kind: 'file' as const,
    async createWritable() {
      const chunks: Uint8Array[] = [];
      return {
        async write(data: Uint8Array) {
          chunks.push(new Uint8Array(data));
        },
        async close() {
          if (fs.writeGate) await fs.writeGate;
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const out = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
          }
          fs.files.set(name, out);
        },
      };
    },
    async getFile() {
      const data = fs.files.get(name);
      if (data === undefined) throw notFound();
      const copy = data.slice();
      return {
        async arrayBuffer() {
          return copy.buffer;
        },
        async text() {
          return new TextDecoder().decode(copy);
        },
      };
    },
    // Storage-spec move(root, name) / move(name).
    async move(...args: unknown[]) {
      const target =
        typeof args[0] === 'string' ? args[0] : (args[1] as string);
      const data = fs.files.get(name);
      if (data === undefined) throw notFound();
      fs.files.delete(name);
      fs.files.set(target, data);
    },
  });
  return {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!fs.files.has(name)) {
        if (!opts?.create) throw notFound();
        fs.files.set(name, new Uint8Array(0));
      }
      if (opts?.create) fs.createdNames.push(name);
      return makeFileHandle(name);
    },
    async removeEntry(name: string) {
      if (!fs.files.has(name)) throw notFound();
      fs.files.delete(name);
    },
    async *keys() {
      for (const key of [...fs.files.keys()]) yield key;
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const STATE = 'dayrail-state.dryj';

let fakeFs: FakeFs;

beforeEach(() => {
  fakeFs = { files: new Map(), createdNames: [], writeGate: null };
  const root = makeFakeRoot(fakeFs);
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpfsYDocStore', () => {
  it('round-trips saveYDoc → loadYDoc and leaves no tmp files behind', async () => {
    const store = new OpfsYDocStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.saveYDoc(bytes);
    expect(Array.from((await store.loadYDoc())!)).toEqual([1, 2, 3, 4]);
    const tmpLeftovers = [...fakeFs.files.keys()].filter((n) =>
      n.includes('.tmp'),
    );
    expect(tmpLeftovers).toEqual([]);
  });

  it('two store instances never share a tmp filename (audit #8)', async () => {
    const tabA = new OpfsYDocStore();
    const tabB = new OpfsYDocStore();
    const gate = deferred();
    fakeFs.writeGate = gate.promise;
    // Both tabs write concurrently; their closes park on the gate so
    // the two atomic writes genuinely overlap in time.
    const saveA = tabA.saveYDoc(new Uint8Array([0xaa]));
    const saveB = tabB.saveYDoc(new Uint8Array([0xbb]));
    await tick();
    gate.resolve();
    fakeFs.writeGate = null;
    await Promise.all([saveA, saveB]);

    const tmpNames = fakeFs.createdNames.filter((n) => n.includes('.tmp'));
    expect(tmpNames.length).toBe(2);
    expect(new Set(tmpNames).size).toBe(2); // unique — no shared .tmp path
    for (const name of tmpNames) {
      expect(name.startsWith(`${STATE}.tmp-`)).toBe(true);
    }
    // Neither write errored; the final file is one tab's payload whole,
    // never an interleaved hybrid, and no tmp litter remains.
    const final = Array.from(fakeFs.files.get(STATE)!);
    expect([[0xaa], [0xbb]]).toContainEqual(final);
    expect([...fakeFs.files.keys()].filter((n) => n.includes('.tmp'))).toEqual(
      [],
    );
  });

  it('reset() queues behind an in-flight save instead of racing it (audit #48)', async () => {
    const store = new OpfsYDocStore();
    const gate = deferred();
    fakeFs.writeGate = gate.promise;
    // A debounced persist is mid-write…
    const save = store.saveYDoc(new Uint8Array([9, 9, 9]));
    await tick();
    // …when the user hits "重置本地数据".
    const reset = store.reset();
    await tick();
    // The wipe must not have jumped the queue while the save is parked.
    gate.resolve();
    fakeFs.writeGate = null;
    await Promise.all([save, reset]);
    // The save landed BEFORE the wipe — so after reset the store is
    // empty and stays empty (no resurrection on reload).
    expect(fakeFs.files.has(STATE)).toBe(false);
    expect(await store.loadYDoc()).toBeNull();
    expect([...fakeFs.files.keys()]).toEqual([]);
  });

  it('deleteYDoc() also runs behind the save queue', async () => {
    const store = new OpfsYDocStore();
    const gate = deferred();
    fakeFs.writeGate = gate.promise;
    const save = store.saveYDoc(new Uint8Array([7]));
    await tick();
    const del = store.deleteYDoc();
    await tick();
    gate.resolve();
    fakeFs.writeGate = null;
    await Promise.all([save, del]);
    expect(fakeFs.files.has(STATE)).toBe(false);
  });

  it('reset() sweeps stranded unique-suffix tmp files', async () => {
    const store = new OpfsYDocStore();
    // Simulate a crashed tab's leftovers: legacy fixed name + unique names.
    fakeFs.files.set(`${STATE}.tmp`, new Uint8Array([1]));
    fakeFs.files.set(`${STATE}.tmp-dead-beef`, new Uint8Array([2]));
    fakeFs.files.set('dayrail-sync-meta.json.tmp-0ld', new Uint8Array([3]));
    await store.reset();
    expect([...fakeFs.files.keys()]).toEqual([]);
  });

  it('quarantineYDoc moves the state file aside without overwriting (audit #40)', async () => {
    const store = new OpfsYDocStore();
    const corrupt = new Uint8Array([0xde, 0xad]);
    fakeFs.files.set(STATE, corrupt);

    const first = await store.quarantineYDoc();
    expect(first).toBe(`${STATE}.corrupt-1`);
    expect(fakeFs.files.has(STATE)).toBe(false);
    expect(Array.from(fakeFs.files.get(`${STATE}.corrupt-1`)!)).toEqual([
      0xde, 0xad,
    ]);

    // A second corruption must take the next slot, not clobber the first.
    fakeFs.files.set(STATE, new Uint8Array([0xbe, 0xef]));
    const second = await store.quarantineYDoc();
    expect(second).toBe(`${STATE}.corrupt-2`);
    expect(Array.from(fakeFs.files.get(`${STATE}.corrupt-1`)!)).toEqual([
      0xde, 0xad,
    ]);
    expect(Array.from(fakeFs.files.get(`${STATE}.corrupt-2`)!)).toEqual([
      0xbe, 0xef,
    ]);

    // No state file → nothing to quarantine.
    expect(await store.quarantineYDoc()).toBeNull();
  });
});
