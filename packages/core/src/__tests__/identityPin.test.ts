// Tests for the pure identity-pin comparison logic
// (packages/core/src/identityPin.ts · ERD §7.10.2).
//
// The IO wrapper (`checkAccountIdentity`) and the pin write helpers
// live in apps/web — those are tested manually via dogfood. This
// file only covers what's deterministic: pin shape, comparison
// branches, defaults.

import { describe, expect, it } from 'vitest';
import { compareIdentity } from '../identityPin';
import {
  DEFAULT_SYNC_META,
  type IdentityPin,
} from '@dayrail/db/yDocStore';

function makePin(overrides: Partial<IdentityPin> = {}): IdentityPin {
  return {
    accountEmail: 'meowjolan@gmail.com',
    appdataFileId: null,
    lastKnownMode: 'backup',
    pinnedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('compareIdentity', () => {
  it('returns first-connect when pin is null', () => {
    const result = compareIdentity('user@example.com', null);
    expect(result).toEqual({
      kind: 'first-connect',
      currentEmail: 'user@example.com',
    });
  });

  it('returns match when current email equals pinned email', () => {
    const pin = makePin({ accountEmail: 'same@example.com' });
    const result = compareIdentity('same@example.com', pin);
    expect(result).toEqual({ kind: 'match' });
  });

  it('returns mismatch when current email differs from pin', () => {
    const pin = makePin({ accountEmail: 'meowjolan@gmail.com' });
    const result = compareIdentity('guojunnan@bytedance.com', pin);
    expect(result).toEqual({
      kind: 'mismatch',
      stored: 'meowjolan@gmail.com',
      current: 'guojunnan@bytedance.com',
    });
  });

  it('is case-sensitive on email comparison', () => {
    // Google preserves email canonicalization upstream; we don't
    // normalize. If a user genuinely sees mixed case in their pin
    // vs a fresh /about response, surfacing the mismatch is the
    // safer default than silently auto-matching.
    const pin = makePin({ accountEmail: 'User@example.com' });
    const result = compareIdentity('user@example.com', pin);
    expect(result.kind).toBe('mismatch');
  });

  it('treats empty string as a distinct value (mismatch with non-empty pin)', () => {
    const pin = makePin({ accountEmail: 'real@example.com' });
    const result = compareIdentity('', pin);
    expect(result).toEqual({
      kind: 'mismatch',
      stored: 'real@example.com',
      current: '',
    });
  });
});

describe('SyncMeta schema · identityPin default', () => {
  it('defaults identityPin to null on fresh install', () => {
    expect(DEFAULT_SYNC_META.identityPin).toBeNull();
  });

  it('back-compat merge: old stored SyncMeta without identityPin gets null after spread', () => {
    // Simulates the loader's defensive merge `{ ...DEFAULT_SYNC_META, ...parsed }`
    // with a v0.11.x-era persisted object that pre-dates the
    // identityPin field. Should default cleanly to null.
    const legacyParsed = {
      lastPulledSnapshotId: 'snap-123',
      lastSyncAt: 1700000000000,
      lastSyncLabel: 'My Mac',
      samplesOnly: false,
      dirtyCount: 0,
      lastPushedCounts: null,
      bootSyncChoice: 'auto-pull' as const,
      // No identityPin — old schema
    };
    const merged = { ...DEFAULT_SYNC_META, ...legacyParsed };
    expect(merged.identityPin).toBeNull();
    expect(merged.lastPulledSnapshotId).toBe('snap-123');
  });
});

describe('IdentityPin shape', () => {
  it('lastKnownMode accepts backup', () => {
    const pin = makePin({ lastKnownMode: 'backup' });
    expect(pin.lastKnownMode).toBe('backup');
  });

  it('lastKnownMode accepts sync', () => {
    const pin = makePin({ lastKnownMode: 'sync' });
    expect(pin.lastKnownMode).toBe('sync');
  });

  it('appdataFileId is nullable for first-connect-without-remote', () => {
    const pin = makePin({ appdataFileId: null });
    expect(pin.appdataFileId).toBeNull();
  });

  it('appdataFileId carries Drive file id when remote was found', () => {
    const pin = makePin({ appdataFileId: 'driveId-xyz' });
    expect(pin.appdataFileId).toBe('driveId-xyz');
  });
});
