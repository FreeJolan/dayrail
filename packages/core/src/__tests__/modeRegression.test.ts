// Tests for the pure mode-regression detector
// (packages/core/src/modeRegression.ts · ERD §7.10.6).

import { describe, expect, it } from 'vitest';
import type { IdentityPin } from '@dayrail/db/yDocStore';
import {
  detectModeRegression,
  runtimeModeFromConnection,
} from '../modeRegression';

function makePin(overrides: Partial<IdentityPin> = {}): IdentityPin {
  return {
    accountEmail: 'meowjolan@gmail.com',
    appdataFileId: null,
    lastKnownMode: 'backup',
    pinnedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('detectModeRegression', () => {
  it('returns none when no pin exists (fresh install / never connected)', () => {
    expect(detectModeRegression(null, 'local')).toEqual({ kind: 'none' });
    expect(detectModeRegression(null, 'backup')).toEqual({ kind: 'none' });
    expect(detectModeRegression(null, 'sync')).toEqual({ kind: 'none' });
  });

  it('returns none when pin exists AND runtime is still backup', () => {
    expect(detectModeRegression(makePin(), 'backup')).toEqual({
      kind: 'none',
    });
  });

  it('returns none when pin exists AND runtime is still sync', () => {
    expect(
      detectModeRegression(makePin({ lastKnownMode: 'sync' }), 'sync'),
    ).toEqual({ kind: 'none' });
  });

  it('returns regression when pinned backup but runtime is local', () => {
    const pin = makePin({
      lastKnownMode: 'backup',
      accountEmail: 'user@example.com',
    });
    const result = detectModeRegression(pin, 'local');
    expect(result).toEqual({
      kind: 'regression',
      pinnedMode: 'backup',
      pinnedAccountEmail: 'user@example.com',
    });
  });

  it('returns regression when pinned sync but runtime is local', () => {
    const pin = makePin({
      lastKnownMode: 'sync',
      accountEmail: 'multi@example.com',
    });
    const result = detectModeRegression(pin, 'local');
    expect(result).toEqual({
      kind: 'regression',
      pinnedMode: 'sync',
      pinnedAccountEmail: 'multi@example.com',
    });
  });

  it('surfaces the pinned account email regardless of mode tier', () => {
    const result = detectModeRegression(
      makePin({ accountEmail: 'specific@here.com' }),
      'local',
    );
    expect(result.kind).toBe('regression');
    if (result.kind === 'regression') {
      expect(result.pinnedAccountEmail).toBe('specific@here.com');
    }
  });
});

describe('runtimeModeFromConnection', () => {
  it('maps connected=true to backup (P3 placeholder · P5 widens to sync)', () => {
    expect(runtimeModeFromConnection(true)).toBe('backup');
  });

  it('maps connected=false to local', () => {
    expect(runtimeModeFromConnection(false)).toBe('local');
  });
});
