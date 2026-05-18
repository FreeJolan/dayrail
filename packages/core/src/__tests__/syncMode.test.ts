// Tests for the pure mode inferencer (packages/core/src/syncMode.ts
// · ERD §7.10.1).

import { describe, expect, it } from 'vitest';
import { inferModeFromHeartbeats } from '../syncMode';

describe('inferModeFromHeartbeats', () => {
  it('local when not connected (regardless of peer count)', () => {
    expect(
      inferModeFromHeartbeats({ isConnected: false, livePeerCount: 0 }),
    ).toBe('local');
    expect(
      inferModeFromHeartbeats({ isConnected: false, livePeerCount: 5 }),
    ).toBe('local');
  });

  it('backup when connected + zero live peers', () => {
    expect(
      inferModeFromHeartbeats({ isConnected: true, livePeerCount: 0 }),
    ).toBe('backup');
  });

  it('sync when connected + one live peer', () => {
    expect(
      inferModeFromHeartbeats({ isConnected: true, livePeerCount: 1 }),
    ).toBe('sync');
  });

  it('sync when connected + multiple live peers', () => {
    expect(
      inferModeFromHeartbeats({ isConnected: true, livePeerCount: 3 }),
    ).toBe('sync');
  });

  it('treats negative livePeerCount as backup (defensive)', () => {
    expect(
      inferModeFromHeartbeats({ isConnected: true, livePeerCount: -1 }),
    ).toBe('backup');
  });
});
