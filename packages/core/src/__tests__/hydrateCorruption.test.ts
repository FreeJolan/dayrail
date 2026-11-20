// Audit #40 regression — hydrate must NEVER "start fresh" over a
// state file it failed to decode. The old behavior warned to the
// console, booted with an empty doc, and ~750ms later the debounced
// persist atomically overwrote the only copy of the user's data.
// The fixed behavior:
//   1. the persist loop is suspended (nothing may write the file),
//   2. the corrupt bytes are quarantined (renamed .corrupt-<n>),
//   3. hydrate rejects with a recognizable error (".dryj" in the
//      message, so main.tsx's BootError corruption hint matches)
//      and the store surfaces it via `error` with ready: false.
//
// This file is isolated on purpose: suspendPersistence is a one-way
// module-level switch (real flows end in location.reload()), so no
// other store test can share this module instance.

import { describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  bytes: null as Uint8Array | null,
  saved: [] as Uint8Array[],
  quarantineCalls: 0,
}));

vi.mock('@dayrail/db/yjsPersistence', () => ({
  loadYDocBytes: async () => disk.bytes,
  saveYDocBytes: async (bytes: Uint8Array) => {
    disk.saved.push(bytes);
  },
  quarantineYDocBytes: async () => {
    disk.quarantineCalls += 1;
    return 'dayrail-state.dryj.corrupt-1';
  },
}));

import { encodeDryj } from '@dayrail/db/dryj';
import { flushPersistence, getYDoc, useStore } from '../store';

describe('hydrate with an undecodable state file', () => {
  it('quarantines the file, rejects boot, and never persists over it', async () => {
    // A v2 container truncated inside the update payload — the exact
    // power-loss shape audit #9/#47 describe.
    const intact = encodeDryj(
      {
        snapshotId: 'snap-1',
        deviceId: 'dev-1',
        deviceLabel: 'Test',
        createdAt: '2026-11-20T00:00:00.000Z',
        schemaVersion: 2,
      },
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    );
    disk.bytes = intact.subarray(0, intact.length - 4);

    await expect(useStore.getState().hydrate()).rejects.toThrow(/\.dryj/);

    // The corrupt bytes were moved aside, not left for overwrite.
    expect(disk.quarantineCalls).toBe(1);

    // Recognizable error state instead of a silent empty boot.
    const state = useStore.getState();
    expect(state.ready).toBe(false);
    expect(state.error).toMatch(/无法解码/);
    expect(state.error).toMatch(/corrupt-1/);

    // The persist loop is dead: even an explicit flush (or any later
    // transaction-triggered debounce) must not write a fresh doc over
    // the state path.
    getYDoc().transact(() => {
      getYDoc().getMap('lines').set('line-x', { id: 'line-x' });
    });
    await flushPersistence();
    expect(disk.saved).toEqual([]);
  });
});
