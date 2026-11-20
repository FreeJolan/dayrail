// OPFS-backed YDocStore (browser / dev). Co-locates Y.Doc bytes,
// last-pulled snapshot, and sync-meta JSON in the same OPFS root —
// see ERD §7.9 for the lifecycle co-residency argument.

import type { SyncMeta, YDocStore, YDocStoreOptions } from './yDocStore';
import { DEFAULT_SYNC_META } from './yDocStore';
import { makeSerialQueue } from './serialQueue';

// File name set (prod vs dev). For OPFS, browser origin already
// separates PWA dev (`localhost:5173`) from PWA prod, so the suffix
// is defense-in-depth more than functional — but keeps the two
// backends symmetrical and shields against any future surface that
// shares an origin between dev and prod.
//
// The `*Tmp` entries are PREFIXES, not literal filenames: each atomic
// write appends a per-call unique suffix (see atomicWriteBinary), so
// two tabs that both have this store open never write the same .tmp
// path and can't truncate each other's in-flight write. (Cross-tab
// whole-file LWW on the FINAL file is a separate, parked concern —
// ROADMAP "Single-tab guard"; the unique tmp names only remove the
// silent mutual-corruption mode.)
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

function uniqueTmpName(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
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

// Atomic write: write to a uniquely-named .tmp, rename via
// FileSystemFileHandle.move (Chrome 110+, Safari 17+) with
// two-arg/one-arg/copy+delete fallbacks. Same shape as the original
// yjsPersistence.ts saveYDocBytes. `tmpPrefix` gets a per-call random
// suffix so a second tab's concurrent write can never recycle /
// truncate this call's tmp file out from under it.
async function atomicWriteBinary(
  name: string,
  tmpPrefix: string,
  bytes: Uint8Array,
): Promise<void> {
  const root = await getRoot();
  const tmp = uniqueTmpName(tmpPrefix);
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

/** Remove the fixed-name legacy tmp file plus any uniquely-suffixed
 *  tmp files (`<prefix>-<rand>`) left behind by interrupted writes.
 *  Best-effort: directory iteration is typed loosely because
 *  FileSystemDirectoryHandle's async iterator isn't in lib.dom on
 *  every TS configuration. */
async function removeTmpFiles(
  root: FileSystemDirectoryHandle,
  tmpPrefix: string,
): Promise<void> {
  await removeIfExists(root, tmpPrefix);
  const iterable = root as unknown as { keys?: () => AsyncIterable<string> };
  if (typeof iterable.keys !== 'function') return;
  const stale: string[] = [];
  try {
    for await (const name of iterable.keys()) {
      if (name.startsWith(`${tmpPrefix}-`)) stale.push(name);
    }
  } catch {
    return; // iteration unsupported — fixed-name removal above is enough
  }
  for (const name of stale) {
    await removeIfExists(root, name).catch(() => {
      /* best-effort */
    });
  }
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

  // Deletion goes through the SAME serial queue as saveYDoc —
  // otherwise an in-flight / queued save interleaves with the wipe
  // and its final rename resurrects the file after the delete
  // claims to be done.
  deleteYDoc(): Promise<void> {
    return this.stateQueue(async () => {
      const root = await getRoot();
      await removeIfExists(root, this.names.state);
      await removeTmpFiles(root, this.names.stateTmp);
    });
  }

  /** Move a state file that failed to decode aside under a
   *  `.corrupt-<n>` name so the bytes survive for manual recovery /
   *  a future fixed build, while hydrate restarts from a clean slate
   *  without ever overwriting them. Serialized on the state queue so
   *  it can't interleave with an in-flight save. */
  quarantineYDoc(): Promise<string | null> {
    return this.stateQueue(async () => {
      const root = await getRoot();
      let handle: FileSystemFileHandle;
      try {
        handle = await root.getFileHandle(this.names.state, { create: false });
      } catch (err) {
        if ((err as DOMException).name === 'NotFoundError') return null;
        throw err;
      }
      const target = await this.firstFreeCorruptName(root);
      const movable = handle as unknown as {
        move?: (...args: unknown[]) => Promise<void>;
      };
      if (typeof movable.move === 'function') {
        try {
          await movable.move(root, target);
          return target;
        } catch {
          try {
            await movable.move(target);
            return target;
          } catch {
            /* fall through to copy+delete */
          }
        }
      }
      const file = await handle.getFile();
      const buf = new Uint8Array(await file.arrayBuffer());
      const quarantineHandle = await root.getFileHandle(target, { create: true });
      const w = await quarantineHandle.createWritable();
      await w.write(buf as unknown as BufferSource);
      await w.close();
      await root.removeEntry(this.names.state);
      return target;
    });
  }

  private async firstFreeCorruptName(
    root: FileSystemDirectoryHandle,
  ): Promise<string> {
    for (let i = 1; i <= 99; i++) {
      const candidate = `${this.names.state}.corrupt-${i}`;
      try {
        await root.getFileHandle(candidate, { create: false });
      } catch (err) {
        if ((err as DOMException).name === 'NotFoundError') return candidate;
        throw err;
      }
    }
    return `${this.names.state}.corrupt-${Date.now()}`;
  }

  loadLastPulled(): Promise<Uint8Array | null> {
    return loadBinaryFile(this.names.lastPulled);
  }

  saveLastPulled(bytes: Uint8Array): Promise<void> {
    return this.lastPulledQueue(() =>
      atomicWriteBinary(this.names.lastPulled, this.names.lastPulledTmp, bytes),
    );
  }

  deleteLastPulled(): Promise<void> {
    return this.lastPulledQueue(async () => {
      const root = await getRoot();
      await removeIfExists(root, this.names.lastPulled);
      await removeTmpFiles(root, this.names.lastPulledTmp);
    });
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

  // Each file's deletion is enqueued on that file's own serial write
  // queue, so a save already in flight (or queued — e.g. the 750ms
  // debounced persist that fired while the user sat in the confirm
  // dialog) fully lands BEFORE the wipe removes the file, instead of
  // interleaving with it and resurrecting old data post-reset.
  async reset(): Promise<void> {
    await Promise.all([
      this.stateQueue(async () => {
        const root = await getRoot();
        await removeIfExists(root, this.names.state);
        await removeTmpFiles(root, this.names.stateTmp);
      }),
      this.lastPulledQueue(async () => {
        const root = await getRoot();
        await removeIfExists(root, this.names.lastPulled);
        await removeTmpFiles(root, this.names.lastPulledTmp);
      }),
      this.syncMetaQueue(async () => {
        const root = await getRoot();
        await removeIfExists(root, this.names.syncMeta);
        await removeTmpFiles(root, this.names.syncMetaTmp);
      }),
    ]);
  }
}
