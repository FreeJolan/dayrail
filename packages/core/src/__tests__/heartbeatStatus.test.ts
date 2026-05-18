// Tests for the pure heartbeat reconcile classifier
// (packages/core/src/heartbeatStatus.ts · ERD §7.10.4).

import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_THRESHOLD_MS,
  classifyReconcile,
  STALE_THRESHOLD_MS,
  type ReconcileHeartbeat,
} from '../heartbeatStatus';

const NOW = Date.parse('2026-05-18T12:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function hb(over: Partial<ReconcileHeartbeat> = {}): ReconcileHeartbeat {
  return {
    deviceId: 'peer-A',
    deviceName: 'Work Mac',
    lastActivityAt: iso(-5 * 60 * 1000),
    lastPushedAt: iso(-5 * 60 * 1000),
    ...over,
  };
}

describe('classifyReconcile · offline', () => {
  it('returns offline when Drive is unreachable, regardless of peers', () => {
    expect(
      classifyReconcile({
        nowMs: NOW,
        peerHeartbeats: [hb()],
        driveReachable: false,
      }),
    ).toEqual({ kind: 'offline' });
  });
});

describe('classifyReconcile · no peers', () => {
  it('returns no-peers when peer list is empty (single-device case)', () => {
    expect(
      classifyReconcile({
        nowMs: NOW,
        peerHeartbeats: [],
        driveReachable: true,
      }),
    ).toEqual({ kind: 'no-peers' });
  });

  it('treats all-archived peer list as no-peers', () => {
    const stale = hb({
      lastActivityAt: iso(-(ARCHIVE_THRESHOLD_MS + 60 * 1000)),
      lastPushedAt: iso(-(ARCHIVE_THRESHOLD_MS + 60 * 1000)),
    });
    expect(
      classifyReconcile({
        nowMs: NOW,
        peerHeartbeats: [stale],
        driveReachable: true,
      }),
    ).toEqual({ kind: 'no-peers' });
  });
});

describe('classifyReconcile · healthy', () => {
  it('returns healthy when peer pushed within STALE_THRESHOLD of activity', () => {
    const result = classifyReconcile({
      nowMs: NOW,
      peerHeartbeats: [
        hb({
          deviceName: 'Personal Mac',
          lastActivityAt: iso(-10 * 60 * 1000),
          lastPushedAt: iso(-9 * 60 * 1000),
        }),
      ],
      driveReachable: true,
    });
    expect(result.kind).toBe('healthy');
    if (result.kind === 'healthy') {
      expect(result.peers).toHaveLength(1);
      expect(result.peers[0]?.deviceName).toBe('Personal Mac');
    }
  });

  it('multiple healthy peers all surface in the summary', () => {
    const result = classifyReconcile({
      nowMs: NOW,
      peerHeartbeats: [
        hb({ deviceName: 'A' }),
        hb({ deviceName: 'B', deviceId: 'peer-B' }),
      ],
      driveReachable: true,
    });
    expect(result.kind).toBe('healthy');
    if (result.kind === 'healthy') {
      expect(result.peers.map((p) => p.deviceName).sort()).toEqual(['A', 'B']);
    }
  });
});

describe('classifyReconcile · peer-stale', () => {
  it('fires when peer activity > push + STALE_THRESHOLD', () => {
    const result = classifyReconcile({
      nowMs: NOW,
      peerHeartbeats: [
        hb({
          deviceName: 'Work Mac',
          // activity 5 min ago, but last push was 1h 10min ago →
          // gap > STALE_THRESHOLD (1h) → stale
          lastActivityAt: iso(-5 * 60 * 1000),
          lastPushedAt: iso(-(STALE_THRESHOLD_MS + 10 * 60 * 1000)),
        }),
      ],
      driveReachable: true,
    });
    expect(result.kind).toBe('peer-stale');
    if (result.kind === 'peer-stale') {
      expect(result.stalePeers).toHaveLength(1);
      expect(result.stalePeers[0]?.deviceName).toBe('Work Mac');
    }
  });

  it('does NOT fire when gap is exactly STALE_THRESHOLD (strict >)', () => {
    const result = classifyReconcile({
      nowMs: NOW,
      peerHeartbeats: [
        hb({
          deviceName: 'Boundary',
          lastActivityAt: iso(-30 * 60 * 1000),
          lastPushedAt: iso(-(STALE_THRESHOLD_MS + 30 * 60 * 1000)),
        }),
      ],
      driveReachable: true,
    });
    // exactly at the threshold → healthy (we want strict > for stale)
    expect(result.kind).toBe('healthy');
  });

  it('mixed peers split into stale + healthy buckets', () => {
    const result = classifyReconcile({
      nowMs: NOW,
      peerHeartbeats: [
        hb({
          deviceName: 'StaleOne',
          lastActivityAt: iso(-5 * 60 * 1000),
          lastPushedAt: iso(-(STALE_THRESHOLD_MS + 10 * 60 * 1000)),
        }),
        hb({
          deviceName: 'HealthyOne',
          deviceId: 'peer-B',
          lastActivityAt: iso(-15 * 60 * 1000),
          lastPushedAt: iso(-15 * 60 * 1000),
        }),
      ],
      driveReachable: true,
    });
    expect(result.kind).toBe('peer-stale');
    if (result.kind === 'peer-stale') {
      expect(result.stalePeers.map((p) => p.deviceName)).toEqual(['StaleOne']);
      expect(result.healthyPeers.map((p) => p.deviceName)).toEqual(['HealthyOne']);
    }
  });
});

describe('classifyReconcile · archive filter', () => {
  it('excludes peers idle > 30 days from judgment', () => {
    const result = classifyReconcile({
      nowMs: NOW,
      peerHeartbeats: [
        hb({
          deviceName: 'Old Mac',
          lastActivityAt: iso(-(ARCHIVE_THRESHOLD_MS + DAY)),
          lastPushedAt: iso(-(ARCHIVE_THRESHOLD_MS + 60 * 60 * 1000)),
        }),
        hb({
          deviceName: 'Active Mac',
          deviceId: 'peer-B',
          lastActivityAt: iso(-5 * 60 * 1000),
          lastPushedAt: iso(-5 * 60 * 1000),
        }),
      ],
      driveReachable: true,
    });
    expect(result.kind).toBe('healthy');
    if (result.kind === 'healthy') {
      // Old Mac is gone from the list; only Active Mac surfaces.
      expect(result.peers.map((p) => p.deviceName)).toEqual(['Active Mac']);
    }
  });
});

describe('classifyReconcile · robustness', () => {
  it('treats corrupted heartbeats as healthy (no noise)', () => {
    const result = classifyReconcile({
      nowMs: NOW,
      peerHeartbeats: [
        hb({
          deviceName: 'Corrupt',
          lastActivityAt: 'not-an-iso',
          lastPushedAt: iso(-5 * 60 * 1000),
        }),
      ],
      driveReachable: true,
    });
    // corrupt lastActivityAt → archive filter drops the peer entirely
    expect(result.kind).toBe('no-peers');
  });
});

const DAY = 24 * 60 * 60 * 1000;
