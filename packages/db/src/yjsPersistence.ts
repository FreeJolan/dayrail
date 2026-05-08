// OPFS persistence for the v0.7 Y.Doc state (ERD §7.7).
//
// Stores the encoded Y.Doc as a single binary file in the origin's
// private file system root. Storage path:
//   <opfs-root>/dayrail-state.dryj
//
// We use the main-thread async OPFS API (FileSystemDirectoryHandle
// + FileSystemFileHandle.createWritable) instead of a dedicated
// worker. The previous SQL layer needed `FileSystemSyncAccessHandle`
// (which is worker-only) because sql.js needed synchronous I/O on
// every query. Y.Doc persistence is fundamentally different: we
// serialize the whole doc on a debounce, so the async API is fine
// and avoids spinning up another worker.
//
// File contents = the .dryj container produced by encodeDryj() — same
// format as the Drive uploads. This lets the Settings → "Import from
// snapshot" UI directly write user-supplied .dryj bytes to OPFS
// without any container re-wrap.
//
// Atomic write: writes go to dayrail-state.dryj.tmp first, then we
// rename. If a power loss interrupts the write, the .tmp is orphaned
// and the previous .dryj remains intact. (FileSystemFileHandle.move
// does the rename in OPFS; falls back to copy+delete on browsers
// that haven't shipped move yet — see the catch.)

const FILE_NAME = 'dayrail-state.dryj';
const TMP_NAME = 'dayrail-state.dryj.tmp';

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (
    typeof navigator === 'undefined' ||
    !('storage' in navigator) ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    throw new Error('OPFS 不可用 —— navigator.storage.getDirectory 未实现');
  }
  return navigator.storage.getDirectory();
}

/** Read the persisted Y.Doc bytes. Returns `null` when no state has
 *  been written yet (fresh install, or after resetLocalData). */
export async function loadYDocBytes(): Promise<Uint8Array | null> {
  const root = await getRoot();
  let handle: FileSystemFileHandle;
  try {
    handle = await root.getFileHandle(FILE_NAME, { create: false });
  } catch (err) {
    // NotFoundError → no state yet, normal on first launch.
    if ((err as DOMException).name === 'NotFoundError') return null;
    throw err;
  }
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/** Write Y.Doc bytes atomically. Writes to a `.tmp` first, then
 *  swaps it into place via move (or copy+delete on browsers without
 *  FileSystemFileHandle.move). The bytes are typically the .dryj
 *  container — the same format used on Drive — so an "Import from
 *  snapshot" can hand its file content straight through.
 *
 *  Concurrency: each caller chains its task AFTER the most-recent
 *  prior in-flight task. Critical: `prev = inFlightSave` is captured
 *  BEFORE the new task is created, and the await is INSIDE the task
 *  body. If two callers (B and C) both arrive while task A is in
 *  flight, B captures prev=taskA + creates taskB awaiting taskA;
 *  then C captures prev=taskB (B already updated inFlightSave) +
 *  creates taskC awaiting taskB. Result: A → B → C strict serial
 *  order. The naïve pattern (`if (inFlightSave) await it; create new
 *  task`) breaks this because B and C both resume in the same
 *  microtask round and both reset inFlightSave — they end up running
 *  concurrently, racing on TMP_NAME. */
let inFlightSave: Promise<void> | null = null;
export async function saveYDocBytes(bytes: Uint8Array): Promise<void> {
  const prev = inFlightSave;
  const task = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {
        /* a prior write failed; we proceed with our own */
      }
    }
    const root = await getRoot();
    // 1. Write to .tmp.
    const tmp = await root.getFileHandle(TMP_NAME, { create: true });
    const writable = await tmp.createWritable();
    // Cast: lib.dom's FileSystemWritableFileStream.write accepts
    // BufferSource (which Uint8Array satisfies), but TS ships an
    // older overload set on some configs.
    await writable.write(bytes as unknown as BufferSource);
    await writable.close();

    // 2. Rename .tmp → final. Prefer FileSystemFileHandle.move
    //    (Chrome 110+, Safari 17+). Chrome accepts the 1-arg form
    //    `move(newName)`; WKWebView / Safari 17 throws "Not enough
    //    arguments" on that and requires the 2-arg
    //    `move(parentDirHandle, newName)` form. Try 2-arg first; fall
    //    back to 1-arg; final fallback is read-and-rewrite.
    // @ts-expect-error — `move` is in the Storage spec but not in
    //   lib.dom yet on every TS configuration.
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
          // Both move forms rejected (older browser / WKWebView with
          // partial impl). Fall through to read+write+delete below.
        }
      }
    }
    // Fallback: read .tmp, write to final, delete .tmp.
    const file = await tmp.getFile();
    const buf = new Uint8Array(await file.arrayBuffer());
    const finalHandle = await root.getFileHandle(FILE_NAME, { create: true });
    const w2 = await finalHandle.createWritable();
    await w2.write(buf as unknown as BufferSource);
    await w2.close();
    await root.removeEntry(TMP_NAME).catch(() => {
      /* best-effort cleanup of stale .tmp */
    });
  })();
  // `task.finally(...)` returns a NEW promise; for the cleanup
  // comparison to work, we have to hold the wrapped promise (the
  // one we publish into inFlightSave) and compare against IT in
  // the cleanup. Comparing against `task` would never match — that
  // bug existed in the round-3 version of this code.
  const wrapped: Promise<void> = task.finally(() => {
    if (inFlightSave === wrapped) inFlightSave = null;
  });
  inFlightSave = wrapped;
  return task;
}

/** Remove the persisted Y.Doc file (if any). Used by the import flow
 *  before stashing a fresh `.dryj` from outside, and by
 *  resetLocalData (which iterates root entries — covered without
 *  this helper, but kept for direct callers). */
export async function deleteYDocBytes(): Promise<void> {
  const root = await getRoot();
  await root.removeEntry(FILE_NAME).catch((err) => {
    if ((err as DOMException).name === 'NotFoundError') return;
    throw err;
  });
  await root.removeEntry(TMP_NAME).catch((err) => {
    if ((err as DOMException).name === 'NotFoundError') return;
    throw err;
  });
}
