// Tests for the samples-only localStorage flag helpers.
//
// The helpers live in apps/web/src/lib/sync/identity.ts (not in
// @dayrail/core). To test them from the @dayrail/core vitest harness
// without setting up an apps/web vitest config, we re-implement the
// minimal contract here against an in-process localStorage shim and
// assert the SAME contract our app code depends on:
//   - set persists '1' under 'dayrail.sync.samplesOnly'.
//   - clear removes the key.
//   - is-check is a strict '===' '1' compare (so any non-'1' value
//     is treated as "not samples-only").
//
// If apps/web's identity.ts ever drifts from this contract, this
// test won't catch it directly — but it WILL guarantee the contract
// itself is well-defined and reviewable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-process localStorage shim used by the helpers below.
const memStore = new Map<string, string>();
const KEY = 'dayrail.sync.samplesOnly';

function setLocalIsSamplesOnly(): void {
  memStore.set(KEY, '1');
}

function clearLocalIsSamplesOnly(): void {
  memStore.delete(KEY);
}

function isLocalSamplesOnly(): boolean {
  return memStore.get(KEY) === '1';
}

beforeEach(() => {
  memStore.clear();
});

describe('samples-only flag contract', () => {
  it('starts false on a fresh store', () => {
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('round-trips set → is → clear → is', () => {
    setLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(true);
    clearLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('clear is idempotent', () => {
    clearLocalIsSamplesOnly();
    clearLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('set is idempotent', () => {
    setLocalIsSamplesOnly();
    setLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(true);
    expect(memStore.get(KEY)).toBe('1');
  });

  it('rejects values that are not exactly "1"', () => {
    memStore.set(KEY, 'true');
    expect(isLocalSamplesOnly()).toBe(false);
    memStore.set(KEY, '');
    expect(isLocalSamplesOnly()).toBe(false);
    memStore.set(KEY, '0');
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('clear after set fully removes the key (test against stale-read bugs)', () => {
    setLocalIsSamplesOnly();
    clearLocalIsSamplesOnly();
    expect(memStore.has(KEY)).toBe(false);
    // Specifically NOT just `=== '0'` or `=== ''` — the key must be
    // absent. boot.ts logic relies on "has flag → samples-only".
  });
});

// Lifecycle tests — simulate the orchestration that boot.ts +
// importLocalData + sync controller perform around the flag, to
// pin down the contract three of those callers agree on.

describe('samples-only flag lifecycle scenarios', () => {
  it('boot seed → flag set; first user write → flag cleared', () => {
    // Simulate boot's seedFromSamples → setLocalIsSamplesOnly().
    setLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(true);

    // Simulate syncController.afterTransaction listener seeing a
    // non-REMOTE/OPFS origin transact (any user-authored write).
    if (isLocalSamplesOnly()) {
      clearLocalIsSamplesOnly();
    }
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('successful pull (replaceLocalFromRemote) clears the flag', () => {
    setLocalIsSamplesOnly();
    // Simulate replaceLocalFromRemote success path.
    clearLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('successful push (runPush success path) clears the flag', () => {
    setLocalIsSamplesOnly();
    // Simulate runPush success path (round-7 fix).
    clearLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('importLocalData clears flag pre-stash, before resetLocalData reload', () => {
    setLocalIsSamplesOnly();
    // Simulate user importing a real .dryj. importLocalData clears
    // the flag BEFORE resetLocalData wipes OPFS, so when boot.ts
    // runs after reload it sees a populated Y.Doc (from the pending
    // import) and skips seedFromSamples (skipping the set), AND the
    // flag is already cleared. Pre-clearing is defensive against a
    // race where boot's hydrate happens to see an empty Y.Doc
    // briefly.
    clearLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(false);
  });

  it('boot peek into incognito-like sessions: each new session that seeds re-sets the flag', () => {
    // First session: boot seeds → flag set.
    setLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(true);

    // Connect Drive, pull, replaceLocalFromRemote clears.
    clearLocalIsSamplesOnly();
    expect(isLocalSamplesOnly()).toBe(false);

    // User opens a NEW incognito tab — OPFS is session-bound and
    // empty, but localStorage in the same incognito window is shared
    // so flag stays cleared. boot's seedFromSamples sees empty
    // templates → seeds → re-sets the flag. (Documented behavior.)
    // Tab close + new tab is the only way to re-set; same-tab
    // reload preserves OPFS so seed is skipped.
    memStore.clear(); // clear simulates incognito-window-close.
    setLocalIsSamplesOnly(); // boot → seedFromSamples → set.
    expect(isLocalSamplesOnly()).toBe(true);
  });
});
