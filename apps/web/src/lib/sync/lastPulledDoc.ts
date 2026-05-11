// Last-pulled Y.Doc bytes persistence (ERD §7.8 P3).
//
// The smart-diff classifier needs a `baseDoc` — the Y.Doc state both
// sides agreed on at the last successful sync. v0.7 only kept the
// `lastPulledSnapshotId` string; that's enough for lineage tracking
// but not for computing the actual diff. P3 adds binary persistence
// for the bytes themselves.
//
// Storage: OPFS file `dayrail-last-pulled.dryj` (separate file from
// the live Y.Doc state at `dayrail-state.dryj`). Same atomic-write
// pattern (write to .tmp, move into place; fall back to copy+delete
// on browsers without FileSystemFileHandle.move).
//
// Updated by syncController after Drive acknowledges the operation:
//   - after a successful pull → the bytes we just pulled
//   - after a successful push → the bytes we just uploaded
// Stays in lockstep with `lastPulledSnapshotId` (kept in localStorage).
//
// First-run / missing-file → returns null. classify() callers fall
// back to "no base, treat as orthogonal via CRDT merge" (v0.7
// behavior). The first successful pull after this fallback writes
// the base file and subsequent syncs use real classify.

const FILE_NAME = 'dayrail-last-pulled.dryj';
const TMP_NAME = 'dayrail-last-pulled.dryj.tmp';

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (
    typeof navigator === 'undefined' ||
    !('storage' in navigator) ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    throw new Error('OPFS unavailable · lastPulledDoc persistence');
  }
  return navigator.storage.getDirectory();
}

export async function loadLastPulledDocBytes(): Promise<Uint8Array | null> {
  let root: FileSystemDirectoryHandle;
  try {
    root = await getRoot();
  } catch {
    return null;
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await root.getFileHandle(FILE_NAME, { create: false });
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') return null;
    throw err;
  }
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

// Serial write chain to avoid TMP_NAME races (same pattern as
// packages/db/src/yjsPersistence.ts saveYDocBytes). The `wrapped`
// reference threading is load-bearing: comparing the cleanup
// callback against `task` directly never matches (finally returns a
// fresh promise), which leaks the chain.
let inFlightSave: Promise<void> | null = null;
export async function saveLastPulledDocBytes(bytes: Uint8Array): Promise<void> {
  const prev = inFlightSave;
  const task: Promise<void> = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {
        /* prior write errored; we proceed */
      }
    }
    const root = await getRoot();
    const tmp = await root.getFileHandle(TMP_NAME, { create: true });
    const writable = await tmp.createWritable();
    await writable.write(bytes as unknown as BufferSource);
    await writable.close();
    // @ts-expect-error — `move` is Storage-spec but not in every
    //   lib.dom version. Same shim used in yjsPersistence.
    if (typeof tmp.move === 'function') {
      try {
        // @ts-expect-error — see above.
        await tmp.move(root, FILE_NAME);
        return;
      } catch {
        try {
          // @ts-expect-error — see above.
          await tmp.move(FILE_NAME);
          return;
        } catch {
          /* fall through to copy+delete */
        }
      }
    }
    const file = await tmp.getFile();
    const buf = new Uint8Array(await file.arrayBuffer());
    const finalHandle = await root.getFileHandle(FILE_NAME, { create: true });
    const w2 = await finalHandle.createWritable();
    await w2.write(buf as unknown as BufferSource);
    await w2.close();
    await root.removeEntry(TMP_NAME).catch(() => {
      /* best-effort cleanup */
    });
  })();
  const wrapped: Promise<void> = task.finally(() => {
    if (inFlightSave === wrapped) inFlightSave = null;
  });
  inFlightSave = wrapped;
  return task;
}

export async function deleteLastPulledDocBytes(): Promise<void> {
  const root = await getRoot();
  await root.removeEntry(FILE_NAME).catch((err) => {
    if ((err as DOMException).name === 'NotFoundError') return;
    throw err;
  });
}
