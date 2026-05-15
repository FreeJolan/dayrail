// OPFS-backed YDocStore (browser / dev). Co-locates Y.Doc bytes,
// last-pulled snapshot, and sync-meta JSON in the same OPFS root —
// see ERD §7.9 for the lifecycle co-residency argument.

import type { SyncMeta, YDocStore } from './yDocStore';
import { DEFAULT_SYNC_META } from './yDocStore';

const STATE_FILE = 'dayrail-state.dryj';
const STATE_TMP = 'dayrail-state.dryj.tmp';
const LAST_PULLED_FILE = 'dayrail-last-pulled.dryj';
const LAST_PULLED_TMP = 'dayrail-last-pulled.dryj.tmp';
const SYNC_META_FILE = 'dayrail-sync-meta.json';
const SYNC_META_TMP = 'dayrail-sync-meta.json.tmp';

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (
    typeof navigator === 'undefined' ||
    !('storage' in navigator) ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    throw new Error('OPFS unavailable · navigator.storage.getDirectory');
  }
  return navigator.storage.getDirectory();
}

async function loadBinaryFile(name: string): Promise<Uint8Array | null> {
  const root = await getRoot();
  let handle: FileSystemFileHandle;
  try {
    handle = await root.getFileHandle(name, { create: false });
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') return null;
    throw err;
  }
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function loadTextFile(name: string): Promise<string | null> {
  const root = await getRoot();
  let handle: FileSystemFileHandle;
  try {
    handle = await root.getFileHandle(name, { create: false });
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') return null;
    throw err;
  }
  const file = await handle.getFile();
  return await file.text();
}

// Atomic write: write to .tmp, rename via FileSystemFileHandle.move
// (Chrome 110+, Safari 17+) with two-arg/one-arg/copy+delete fallbacks.
// Same shape as the original yjsPersistence.ts saveYDocBytes.
async function atomicWriteBinary(
  name: string,
  tmp: string,
  bytes: Uint8Array,
): Promise<void> {
  const root = await getRoot();
  const tmpHandle = await root.getFileHandle(tmp, { create: true });
  const writable = await tmpHandle.createWritable();
  await writable.write(bytes as unknown as BufferSource);
  await writable.close();
  // @ts-expect-error — `move` is in the Storage spec but not in
  //   lib.dom on every TS configuration.
  if (typeof tmpHandle.move === 'function') {
    try {
      // @ts-expect-error — see above.
      await tmpHandle.move(root, name);
      return;
    } catch {
      try {
        // @ts-expect-error — see above.
        await tmpHandle.move(name);
        return;
      } catch {
        /* fall through to copy+delete */
      }
    }
  }
  const file = await tmpHandle.getFile();
  const buf = new Uint8Array(await file.arrayBuffer());
  const finalHandle = await root.getFileHandle(name, { create: true });
  const w2 = await finalHandle.createWritable();
  await w2.write(buf as unknown as BufferSource);
  await w2.close();
  await root.removeEntry(tmp).catch(() => {
    /* best-effort cleanup */
  });
}

async function atomicWriteText(
  name: string,
  tmp: string,
  text: string,
): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  await atomicWriteBinary(name, tmp, bytes);
}

async function removeIfExists(root: FileSystemDirectoryHandle, name: string): Promise<void> {
  await root.removeEntry(name).catch((err) => {
    if ((err as DOMException).name === 'NotFoundError') return;
    throw err;
  });
}

// Per-file serial write chains — mirrors the wrapped/inFlightSave
// trick from the original yjsPersistence so concurrent callers don't
// race on the .tmp file. Each file gets its own chain since they
// don't conflict with each other.
function makeSerialQueue(): (task: () => Promise<void>) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return (taskFn) => {
    const prev = inFlight;
    const task = (async () => {
      if (prev) {
        try {
          await prev;
        } catch {
          /* prior task failed; we proceed */
        }
      }
      await taskFn();
    })();
    const wrapped: Promise<void> = task.finally(() => {
      if (inFlight === wrapped) inFlight = null;
    });
    inFlight = wrapped;
    return task;
  };
}

export class OpfsYDocStore implements YDocStore {
  private stateQueue = makeSerialQueue();
  private lastPulledQueue = makeSerialQueue();
  private syncMetaQueue = makeSerialQueue();

  loadYDoc(): Promise<Uint8Array | null> {
    return loadBinaryFile(STATE_FILE);
  }

  saveYDoc(bytes: Uint8Array): Promise<void> {
    return this.stateQueue(() => atomicWriteBinary(STATE_FILE, STATE_TMP, bytes));
  }

  async deleteYDoc(): Promise<void> {
    const root = await getRoot();
    await removeIfExists(root, STATE_FILE);
    await removeIfExists(root, STATE_TMP);
  }

  loadLastPulled(): Promise<Uint8Array | null> {
    return loadBinaryFile(LAST_PULLED_FILE);
  }

  saveLastPulled(bytes: Uint8Array): Promise<void> {
    return this.lastPulledQueue(() =>
      atomicWriteBinary(LAST_PULLED_FILE, LAST_PULLED_TMP, bytes),
    );
  }

  async deleteLastPulled(): Promise<void> {
    const root = await getRoot();
    await removeIfExists(root, LAST_PULLED_FILE);
    await removeIfExists(root, LAST_PULLED_TMP);
  }

  async loadSyncMeta(): Promise<SyncMeta | null> {
    const text = await loadTextFile(SYNC_META_FILE);
    if (text === null) return null;
    try {
      const parsed = JSON.parse(text) as Partial<SyncMeta>;
      // Defensive merge with defaults — tolerant to schema additions
      // across versions without crashing on read.
      return { ...DEFAULT_SYNC_META, ...parsed };
    } catch {
      return null;
    }
  }

  saveSyncMeta(meta: SyncMeta): Promise<void> {
    return this.syncMetaQueue(() =>
      atomicWriteText(SYNC_META_FILE, SYNC_META_TMP, JSON.stringify(meta)),
    );
  }

  async reset(): Promise<void> {
    const root = await getRoot();
    await Promise.all([
      removeIfExists(root, STATE_FILE),
      removeIfExists(root, STATE_TMP),
      removeIfExists(root, LAST_PULLED_FILE),
      removeIfExists(root, LAST_PULLED_TMP),
      removeIfExists(root, SYNC_META_FILE),
      removeIfExists(root, SYNC_META_TMP),
    ]);
  }
}
