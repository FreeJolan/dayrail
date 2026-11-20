// Per-file serial write chain, shared by both YDocStore backends
// (OPFS + Tauri FS). Guarantees that tasks enqueued on the same queue
// run strictly one-at-a-time in FIFO order, so concurrent callers
// can't interleave multi-step writes (write tmp → rename) on the same
// target file.
//
// Rejection contract (the subtle part): the promise RETURNED to the
// caller rejects when the task fails — callers own that error. The
// internal chain pointer, however, must NEVER reject: it has no
// consumer unless another task happens to be enqueued later, so
// deriving it directly from the task promise turns every
// tail-of-queue failure into a global `unhandledrejection` even when
// the caller dutifully catches the returned promise. The chain holds
// a settled-swallowing copy instead.

export type SerialQueue = <T>(taskFn: () => Promise<T>) => Promise<T>;

export function makeSerialQueue(): SerialQueue {
  // Never-rejecting tail of the chain (see module header).
  let inFlight: Promise<void> | null = null;
  return <T,>(taskFn: () => Promise<T>): Promise<T> => {
    const prev = inFlight;
    const task = (async () => {
      // `prev` never rejects by construction, so a failed predecessor
      // doesn't poison the chain — we simply proceed after it settles.
      if (prev) await prev;
      return taskFn();
    })();
    const wrapped: Promise<void> = task
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (inFlight === wrapped) inFlight = null;
      });
    inFlight = wrapped;
    return task;
  };
}
