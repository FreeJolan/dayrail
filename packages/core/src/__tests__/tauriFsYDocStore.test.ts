// Regression tests for TauriFsYDocStore (desktop backend). The real
// `@tauri-apps/api` + `@tauri-apps/plugin-fs` JS modules run as-is;
// the test stubs the IPC boundary (`window.__TAURI_INTERNALS__`)
// with an in-memory filesystem — the same seam the Rust process
// provides in production.
//
//   - audit #9  — saves must route through the dedicated
//     `ydoc_atomic_write` Rust command (write unique tmp → fsync →
//     rename → fsync parent dir); plugin-fs's writeFile+rename never
//     fsyncs, so a power cut could leave a 0-byte state.dryj. Any
//     attempt to write through `plugin:fs|write_file` here fails the
//     test (unknown command);
//   - audit #48 — reset()/deleteYDoc() queue behind in-flight saves
//     on the same per-file serial chain instead of racing them;
//   - audit #40 — quarantineYDoc() renames the corrupt state file to
//     `.corrupt-<n>` instead of deleting or overwriting it.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriFsYDocStore } from '../../../db/src/tauriFsYDocStore';

type InvokeArgs = Record<string, unknown>;

const harness = {
  files: new Map<string, Uint8Array>(),
  ydocWrites: [] as { relPath: string; byteLen: number }[],
  writeGate: null as Promise<void> | null,
};

function enoent(path: string): Error {
  return new Error(`No such file or directory (os error 2): ${path}`);
}

async function fakeInvoke(cmd: string, args: InvokeArgs = {}): Promise<unknown> {
  switch (cmd) {
    case 'plugin:path|resolve_directory':
      return '/appdata';
    case 'plugin:path|join':
      return (args.paths as string[]).join('/');
    case 'plugin:fs|exists':
      return harness.files.has(args.path as string);
    case 'plugin:fs|read_file': {
      const data = harness.files.get(args.path as string);
      if (data === undefined) throw enoent(args.path as string);
      return data;
    }
    case 'plugin:fs|read_text_file': {
      const data = harness.files.get(args.path as string);
      if (data === undefined) throw enoent(args.path as string);
      return data;
    }
    case 'plugin:fs|remove': {
      if (!harness.files.delete(args.path as string)) {
        throw enoent(args.path as string);
      }
      return null;
    }
    case 'plugin:fs|rename': {
      const from = args.oldPath as string;
      const to = args.newPath as string;
      const data = harness.files.get(from);
      if (data === undefined) throw enoent(from);
      harness.files.delete(from);
      harness.files.set(to, data);
      return null;
    }
    case 'plugin:fs|read_dir': {
      const dir = args.path as string;
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = new Set<string>();
      for (const key of harness.files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes('/')) names.add(rest);
      }
      return [...names].map((name) => ({
        name,
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      }));
    }
    case 'plugin:fs|mkdir':
      return null;
    case 'ydoc_atomic_write': {
      const relPath = args.relPath as string;
      const bytes = args.bytes as number[];
      harness.ydocWrites.push({ relPath, byteLen: bytes.length });
      if (harness.writeGate) await harness.writeGate;
      // The Rust side resolves relPath against app_data_dir, writes a
      // unique tmp, fsyncs, renames, fsyncs the dir — model the final
      // effect.
      harness.files.set(`/appdata/${relPath}`, new Uint8Array(bytes));
      return null;
    }
    default:
      // In particular `plugin:fs|write_file` / `write_text_file` land
      // here — the store must never write Y.Doc files through the
      // fsync-less JS APIs again (audit #9).
      throw new Error(`unexpected IPC command: ${cmd}`);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const STATE_PATH = '/appdata/ydoc/state.dryj';

// The window stub stays up for the whole file (torn down in afterAll,
// not afterEach): each store's `pathsPromise` chain may still be
// resolving `plugin:path|join` calls after the test body returns, and
// yanking `window` out from under it would turn that dangling promise
// into an unhandled rejection.
beforeEach(() => {
  harness.files.clear();
  harness.ydocWrites.length = 0;
  harness.writeGate = null;
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: { invoke: fakeInvoke },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('TauriFsYDocStore', () => {
  it('saves via the durable Rust command and round-trips loadYDoc', async () => {
    const store = new TauriFsYDocStore();
    await store.saveYDoc(new Uint8Array([1, 2, 3]));
    expect(harness.ydocWrites).toEqual([
      { relPath: 'ydoc/state.dryj', byteLen: 3 },
    ]);
    expect(Array.from((await store.loadYDoc())!)).toEqual([1, 2, 3]);
  });

  it('namespaces dev-mode writes under ydoc-dev/', async () => {
    const store = new TauriFsYDocStore({ devMode: true });
    await store.saveYDoc(new Uint8Array([7]));
    expect(harness.ydocWrites[0]?.relPath).toBe('ydoc-dev/state.dryj');
  });

  it('routes sync-meta writes through the same durable command', async () => {
    const store = new TauriFsYDocStore();
    await store.saveSyncMeta({ dirtyCount: 3 } as never);
    expect(harness.ydocWrites[0]?.relPath).toBe('ydoc/sync-meta.json');
    const text = new TextDecoder().decode(
      harness.files.get('/appdata/ydoc/sync-meta.json'),
    );
    expect(JSON.parse(text)).toEqual({ dirtyCount: 3 });
  });

  it('reset() queues behind an in-flight save instead of racing it (audit #48)', async () => {
    const store = new TauriFsYDocStore();
    const gate = deferred();
    harness.writeGate = gate.promise;
    const save = store.saveYDoc(new Uint8Array([9, 9]));
    await tick();
    const reset = store.reset();
    await tick();
    // The wipe hasn't jumped the queue while the save is parked.
    gate.resolve();
    harness.writeGate = null;
    await Promise.all([save, reset]);
    // Save landed, then the wipe removed it — nothing resurrects.
    expect(harness.files.has(STATE_PATH)).toBe(false);
    expect(await store.loadYDoc()).toBeNull();
  });

  it('reset() sweeps stranded tmp files from interrupted writes', async () => {
    const store = new TauriFsYDocStore();
    harness.files.set(`${STATE_PATH}.tmp`, new Uint8Array([1]));
    harness.files.set(`${STATE_PATH}.5f3a.tmp`, new Uint8Array([2]));
    harness.files.set(
      '/appdata/ydoc/last-pulled.dryj.abc.tmp',
      new Uint8Array([3]),
    );
    await store.reset();
    expect([...harness.files.keys()]).toEqual([]);
  });

  it('quarantineYDoc renames the state file to .corrupt-<n> (audit #40)', async () => {
    const store = new TauriFsYDocStore();
    harness.files.set(STATE_PATH, new Uint8Array([0xde, 0xad]));
    const first = await store.quarantineYDoc();
    expect(first).toBe('state.dryj.corrupt-1');
    expect(harness.files.has(STATE_PATH)).toBe(false);
    expect(Array.from(harness.files.get(`${STATE_PATH}.corrupt-1`)!)).toEqual([
      0xde, 0xad,
    ]);

    harness.files.set(STATE_PATH, new Uint8Array([0xbe]));
    expect(await store.quarantineYDoc()).toBe('state.dryj.corrupt-2');
    // The first quarantine file is untouched.
    expect(Array.from(harness.files.get(`${STATE_PATH}.corrupt-1`)!)).toEqual([
      0xde, 0xad,
    ]);
    expect(await store.quarantineYDoc()).toBeNull();
  });
});
