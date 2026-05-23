// Tests for the sync status helpers (packages/core/src/syncStatus.ts ·
// ERD §7.10.5 · two-axis model since v0.12.7).

import { describe, expect, it } from 'vitest';
import {
  classifySyncStatus,
  formatDurationAgo,
  formatDurationLong,
  PENDING_PILE_THRESHOLD,
  type SyncStatusInputs,
} from '../syncStatus';

const NOW = Date.parse('2026-05-18T12:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

// Default = healthy/synced baseline: nothing pending, recent push +
// pull, no errors, round-trip confirmed this session.
function inputs(over: Partial<SyncStatusInputs> = {}): SyncStatusInputs {
  return {
    nowMs: NOW,
    pendingCount: 0,
    lastSuccessPushIso: iso(-5 * 60 * 1000),
    lastSuccessPullIso: iso(-2 * 60 * 1000),
    pushErroring: false,
    pullErroring: false,
    sessionRoundTripDone: true,
    ...over,
  };
}

describe('formatDurationAgo', () => {
  it('returns "刚刚" for sub-minute deltas', () => {
    expect(formatDurationAgo(iso(-30 * 1000), NOW)).toBe('刚刚');
    expect(formatDurationAgo(iso(0), NOW)).toBe('刚刚');
  });

  it('returns "N 分钟前" for sub-hour deltas', () => {
    expect(formatDurationAgo(iso(-3 * 60 * 1000), NOW)).toBe('3 分钟前');
    expect(formatDurationAgo(iso(-59 * 60 * 1000), NOW)).toBe('59 分钟前');
  });

  it('returns "N 小时前" for sub-day deltas', () => {
    expect(formatDurationAgo(iso(-2 * 60 * 60 * 1000), NOW)).toBe('2 小时前');
    expect(formatDurationAgo(iso(-23 * 60 * 60 * 1000), NOW)).toBe('23 小时前');
  });

  it('returns "N 天前" for multi-day deltas', () => {
    expect(formatDurationAgo(iso(-2 * 24 * 60 * 60 * 1000), NOW)).toBe('2 天前');
    expect(formatDurationAgo(iso(-30 * 24 * 60 * 60 * 1000), NOW)).toBe('30 天前');
  });

  it('handles future timestamps as "刚刚" (clamped to 0)', () => {
    expect(formatDurationAgo(iso(60 * 1000), NOW)).toBe('刚刚');
  });

  it('returns "未知时间" for unparseable input', () => {
    expect(formatDurationAgo('not-an-iso', NOW)).toBe('未知时间');
  });
});

describe('formatDurationLong (warn state copy)', () => {
  it('"传不上去 N 小时了" for sub-day', () => {
    expect(formatDurationLong(3 * 60 * 60 * 1000)).toBe('传不上去 3 小时了');
  });

  it('"已经 N 天多没传上去" for multi-day', () => {
    expect(formatDurationLong(3 * 24 * 60 * 60 * 1000 + 17 * 60 * 60 * 1000)).toBe(
      '已经 3 天多没传上去',
    );
  });

  it('falls back to minute precision below the hour boundary', () => {
    expect(formatDurationLong(45 * 60 * 1000)).toBe('传不上去 45 分钟了');
  });

  it('clamps negative durations', () => {
    expect(formatDurationLong(-5000)).toBe('传不上去 0 分钟了');
  });
});

describe('classifySyncStatus · #7 synced', () => {
  it('synced when nothing pending + round-trip done + pull not erroring', () => {
    expect(classifySyncStatus(inputs())).toEqual({
      kind: 'synced',
      lastSuccessPullIso: iso(-2 * 60 * 1000),
    });
  });

  // The core regression: an idle-but-consistent device whose last PUSH
  // is ancient (no changes → nothing to push) must NOT false-alarm. The
  // old model returned long-failure ("同步断开") here.
  it('synced even when last push is 5 days ago (idle, nothing to push)', () => {
    const res = classifySyncStatus(
      inputs({ lastSuccessPushIso: iso(-5 * 24 * 60 * 60 * 1000) }),
    );
    expect(res.kind).toBe('synced');
  });

  it('synced even when this device never pushed (pull-only, 0 pending)', () => {
    const res = classifySyncStatus(
      inputs({ lastSuccessPushIso: null, pendingCount: 0 }),
    );
    expect(res.kind).toBe('synced');
  });
});

describe('classifySyncStatus · #8 checking', () => {
  it('checking when round-trip not yet confirmed this session', () => {
    expect(classifySyncStatus(inputs({ sessionRoundTripDone: false }))).toEqual({
      kind: 'checking',
    });
  });

  it('checking on a recent pull blip (erroring but within freshness window)', () => {
    // pull erroring, but last successful pull was 2 min ago (< 10 min) →
    // not yet "can't reach cloud"; with 0 pending → checking, not synced.
    const res = classifySyncStatus(
      inputs({ pullErroring: true, lastSuccessPullIso: iso(-2 * 60 * 1000) }),
    );
    expect(res.kind).toBe('checking');
  });
});

describe('classifySyncStatus · #6 queued', () => {
  it('queued when pending > 0 and push not erroring', () => {
    expect(classifySyncStatus(inputs({ pendingCount: 3 }))).toEqual({
      kind: 'queued',
      count: 3,
    });
  });
});

describe('classifySyncStatus · #4 push-failure (data at risk)', () => {
  it('fires when pending > 0 AND push erroring · severity by push age', () => {
    const res = classifySyncStatus(
      inputs({
        pendingCount: 4,
        pushErroring: true,
        lastSuccessPushIso: iso(-3 * 60 * 60 * 1000),
      }),
    );
    expect(res).toEqual({
      kind: 'push-failure',
      severity: 'mild',
      count: 4,
      durationMs: 3 * 60 * 60 * 1000,
    });
  });

  it('distinct / heavy ladder by push age', () => {
    const distinct = classifySyncStatus(
      inputs({
        pendingCount: 1,
        pushErroring: true,
        lastSuccessPushIso: iso(-2 * 24 * 60 * 60 * 1000),
      }),
    );
    expect(distinct.kind === 'push-failure' && distinct.severity).toBe(
      'distinct',
    );
    const heavy = classifySyncStatus(
      inputs({
        pendingCount: 1,
        pushErroring: true,
        lastSuccessPushIso: iso(-5 * 24 * 60 * 60 * 1000),
      }),
    );
    expect(heavy.kind === 'push-failure' && heavy.severity).toBe('heavy');
  });

  it('does NOT fire when pending > 0 but push not erroring (→ queued)', () => {
    const res = classifySyncStatus(
      inputs({ pendingCount: 4, pushErroring: false }),
    );
    expect(res.kind).toBe('queued');
  });

  it('heavy when never-pushed + a pile of pending writes', () => {
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: null,
        pendingCount: PENDING_PILE_THRESHOLD + 30,
      }),
    );
    expect(res).toEqual({
      kind: 'push-failure',
      severity: 'heavy',
      count: PENDING_PILE_THRESHOLD + 30,
      durationMs: Number.POSITIVE_INFINITY,
    });
  });
});

describe("classifySyncStatus · #5 pull-failure (can't reach cloud)", () => {
  it('fires when pull erroring AND stale past the freshness window', () => {
    const res = classifySyncStatus(
      inputs({
        pullErroring: true,
        lastSuccessPullIso: iso(-2 * 60 * 60 * 1000), // 2h ago > 10min window
      }),
    );
    expect(res.kind).toBe('pull-failure');
    if (res.kind === 'pull-failure') expect(res.severity).toBe('mild');
  });

  it('does NOT fire within the freshness window (transient blip)', () => {
    const res = classifySyncStatus(
      inputs({ pullErroring: true, lastSuccessPullIso: iso(-3 * 60 * 1000) }),
    );
    expect(res.kind).not.toBe('pull-failure');
  });

  it('push-failure takes priority over pull-failure (data at risk first)', () => {
    const res = classifySyncStatus(
      inputs({
        pendingCount: 2,
        pushErroring: true,
        pullErroring: true,
        lastSuccessPullIso: iso(-2 * 60 * 60 * 1000),
      }),
    );
    expect(res.kind).toBe('push-failure');
  });
});
