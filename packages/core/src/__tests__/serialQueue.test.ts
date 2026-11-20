// Tests for the shared per-file serial write chain
// (packages/db/src/serialQueue.ts), used by both YDocStore backends.
//
// Audit #69: the previous implementation derived the chain pointer
// (`inFlight`) directly from the task promise via `.finally()` —
// a second, consumer-less promise. When the LAST task in the queue
// failed, that chain copy rejected with no handler attached and fired
// a global `unhandledrejection` even though the caller had dutifully
// caught the promise the queue returned.

import { describe, expect, it } from 'vitest';
import { makeSerialQueue } from '@dayrail/db/serialQueue';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('makeSerialQueue', () => {
  it('runs tasks strictly one-at-a-time in FIFO order', async () => {
    const queue = makeSerialQueue();
    const events: string[] = [];
    const gate = deferred();
    const first = queue(async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
    });
    const second = queue(async () => {
      events.push('second:start');
      events.push('second:end');
    });
    await tick();
    // Second must not start while first is parked on its gate.
    expect(events).toEqual(['first:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('propagates per-task results and failures to their own callers', async () => {
    const queue = makeSerialQueue();
    const ok = queue(async () => 'value');
    const boom = queue(async () => {
      throw new Error('disk full');
    });
    const after = queue(async () => 'still alive');
    await expect(ok).resolves.toBe('value');
    await expect(boom).rejects.toThrow('disk full');
    // A failed predecessor doesn't poison the chain.
    await expect(after).resolves.toBe('still alive');
  });

  it('a caught tail-of-queue failure fires no global unhandledrejection', async () => {
    // `process` typed structurally — the core tsconfig compiles with
    // `types: []`, so the Node ambient globals aren't available.
    const proc = (
      globalThis as unknown as {
        process: {
          on(event: 'unhandledRejection', cb: (reason: unknown) => void): void;
          off(event: 'unhandledRejection', cb: (reason: unknown) => void): void;
        };
      }
    ).process;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    proc.on('unhandledRejection', onUnhandled);
    try {
      const queue = makeSerialQueue();
      // The failing save is the LAST task in the queue — nothing is
      // enqueued after it, so nothing ever awaits the internal chain.
      await expect(
        queue(async () => {
          throw new Error('quota exceeded');
        }),
      ).rejects.toThrow('quota exceeded');
      // Give the runtime time to surface any orphaned rejection.
      await tick();
      await tick();
      expect(unhandled).toEqual([]);
    } finally {
      proc.off('unhandledRejection', onUnhandled);
    }
  });

  it('a deletion enqueued behind an in-flight save runs only after the save lands', async () => {
    // The reset()/deleteYDoc() shape (audit #48): deletion must queue
    // behind the write, not race it.
    const queue = makeSerialQueue();
    let fileContent: string | null = null;
    const slowWriteGate = deferred();
    const save = queue(async () => {
      await slowWriteGate.promise;
      fileContent = 'saved-doc';
    });
    const reset = queue(async () => {
      fileContent = null;
    });
    await tick();
    expect(fileContent).toBeNull(); // write still parked
    slowWriteGate.resolve();
    await Promise.all([save, reset]);
    // Save landed first, delete landed last — no resurrection.
    expect(fileContent).toBeNull();
  });
});
