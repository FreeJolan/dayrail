// OPFS-backed YDocStore (browser / dev). Co-locates Y.Doc bytes,
// last-pulled snapshot, and sync-meta JSON in the same OPFS root —
// see ERD §7.9 for the lifecycle co-residency argument.

import type { SyncMeta, YDocStore, YDocStoreOptions } from './yDocStore';
import { DEFAULT_SYNC_META } from './yDocStore';

// File name set (prod vs dev). For OPFS, browser origin already
// separates PWA dev (`localhost:5173`) from PWA prod, so the suffix
// is defense-in-depth more than functional — but keeps the two
// backends symmetrical and shields against any future surface that
// shares an origin between dev and prod.
function fileNames(devMode: boolean) {
  const suffix = devMode ? '-dev' : '';
  return {
    state: `dayrail-state${suffix}.dryj`,
    stateTmp: `dayrail-state${suffix}.dryj.tmp`,
    lastPulled: `dayrail-last-pulled${suffix}.dryj`,
    lastPulledTmp: `dayrail-last-pulled${suffix}.dryj.tmp`,
    syncMeta: `dayrail-sync-meta${suffix}.json`,
    syncMetaTmp: `dayrail-sync-meta${suffix}.json.tmp`,
  };
}

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

/** Generic OPFS-backed JSON store for a small, self-contained blob that
 *  must NOT live in the Y.Doc sync stream — e.g. the AI intent staging
 *  tray (ERD §6.7.3). Atomic write + per-store serial queue, same
 *  posture as `OpfsYDocStore`. The blob is read/written whole, so its
 *  lifecycle never drifts from itself (the §7.9 lesson). */
export class OpfsJsonStore<T> {
  private readonly queue = makeSerialQueue();
  private readonly name: string;
  private readonly tmpName: string;

  constructor(name: string, tmpName?: string) {
    this.name = name;
    this.tmpName = tmpName ?? `${name}.tmp`;
  }

  async load(): Promise<T | null> {
    const bytes = await loadBinaryFile(this.name);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      // Corrupt / partial blob — treat as empty rather than crash boot.
      return null;
    }
  }

  async save(value: T): Promise<void> {
    await this.queue(() => atomicWriteText(this.name, this.tmpName, JSON.stringify(value)));
  }
}

export class OpfsYDocStore implements YDocStore {
  private stateQueue = makeSerialQueue();
  private lastPulledQueue = makeSerialQueue();
  private syncMetaQueue = makeSerialQueue();
  private names: ReturnType<typeof fileNames>;

  constructor(options: YDocStoreOptions = {}) {
    this.names = fileNames(options.devMode === true);
  }

  loadYDoc(): Promise<Uint8Array | null> {
    return loadBinaryFile(this.names.state);
  }

  saveYDoc(bytes: Uint8Array): Promise<void> {
    return this.stateQueue(() =>
      atomicWriteBinary(this.names.state, this.names.stateTmp, bytes),
    );
  }

  async deleteYDoc(): Promise<void> {
    const root = await getRoot();
    await removeIfExists(root, this.names.state);
    await removeIfExists(root, this.names.stateTmp);
  }

  loadLastPulled(): Promise<Uint8Array | null> {
    return loadBinaryFile(this.names.lastPulled);
  }

  saveLastPulled(bytes: Uint8Array): Promise<void> {
    return this.lastPulledQueue(() =>
      atomicWriteBinary(this.names.lastPulled, this.names.lastPulledTmp, bytes),
    );
  }

  async deleteLastPulled(): Promise<void> {
    const root = await getRoot();
    await removeIfExists(root, this.names.lastPulled);
    await removeIfExists(root, this.names.lastPulledTmp);
  }

  async loadSyncMeta(): Promise<SyncMeta | null> {
    const text = await loadTextFile(this.names.syncMeta);
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
      atomicWriteText(this.names.syncMeta, this.names.syncMetaTmp, JSON.stringify(meta)),
    );
  }

  async reset(): Promise<void> {
    const root = await getRoot();
    await Promise.all([
      removeIfExists(root, this.names.state),
      removeIfExists(root, this.names.stateTmp),
      removeIfExists(root, this.names.lastPulled),
      removeIfExists(root, this.names.lastPulledTmp),
      removeIfExists(root, this.names.syncMeta),
      removeIfExists(root, this.names.syncMetaTmp),
    ]);
  }
}
