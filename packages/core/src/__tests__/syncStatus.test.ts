// Tests for the duration-aware sync status helpers
// (packages/core/src/syncStatus.ts · ERD §7.10.5).

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

function inputs(over: Partial<SyncStatusInputs> = {}): SyncStatusInputs {
  return {
    nowMs: NOW,
    lastSuccessPushIso: iso(-5 * 60 * 1000),
    pendingCount: 0,
    dismissPendingPileUntilIso: null,
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

describe('classifySyncStatus · healthy branch', () => {
  it('returns healthy when last push is recent (< 1h)', () => {
    expect(classifySyncStatus(inputs())).toEqual({ kind: 'healthy' });
  });

  it('returns healthy when never pushed AND no pending writes', () => {
    expect(
      classifySyncStatus(inputs({ lastSuccessPushIso: null, pendingCount: 0 })),
    ).toEqual({ kind: 'healthy' });
  });

  it('returns healthy when lastSuccessPushIso is garbage', () => {
    expect(
      classifySyncStatus(
        inputs({ lastSuccessPushIso: 'corrupted-not-an-iso' }),
      ),
    ).toEqual({ kind: 'healthy' });
  });
});

describe('classifySyncStatus · long-failure ladder', () => {
  it('mild for 1-24h since success', () => {
    const res = classifySyncStatus(
      inputs({ lastSuccessPushIso: iso(-3 * 60 * 60 * 1000) }),
    );
    expect(res).toEqual({
      kind: 'long-failure',
      severity: 'mild',
      durationMs: 3 * 60 * 60 * 1000,
    });
  });

  it('distinct for 1-3 days since success', () => {
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: iso(-(2 * 24 + 5) * 60 * 60 * 1000),
      }),
    );
    expect(res.kind).toBe('long-failure');
    if (res.kind === 'long-failure') {
      expect(res.severity).toBe('distinct');
    }
  });

  it('heavy for > 3 days since success', () => {
    const res = classifySyncStatus(
      inputs({ lastSuccessPushIso: iso(-5 * 24 * 60 * 60 * 1000) }),
    );
    expect(res.kind).toBe('long-failure');
    if (res.kind === 'long-failure') {
      expect(res.severity).toBe('heavy');
    }
  });

  it('heavy when never-pushed + many pending', () => {
    const res = classifySyncStatus(
      inputs({ lastSuccessPushIso: null, pendingCount: 50 }),
    );
    expect(res).toEqual({
      kind: 'long-failure',
      severity: 'heavy',
      durationMs: Number.POSITIVE_INFINITY,
    });
  });
});

describe('classifySyncStatus · pending-pile', () => {
  it('fires when pending > threshold + 1-24h since push', () => {
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: iso(-90 * 60 * 1000),
        pendingCount: PENDING_PILE_THRESHOLD + 1,
      }),
    );
    expect(res.kind).toBe('pending-pile');
    if (res.kind === 'pending-pile') {
      expect(res.count).toBe(PENDING_PILE_THRESHOLD + 1);
    }
  });

  it('does NOT fire when pending == threshold (strictly greater)', () => {
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: iso(-90 * 60 * 1000),
        pendingCount: PENDING_PILE_THRESHOLD,
      }),
    );
    expect(res.kind).toBe('long-failure');
  });

  it('does NOT fire when suppressed via dismissPendingPileUntil', () => {
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: iso(-90 * 60 * 1000),
        pendingCount: PENDING_PILE_THRESHOLD + 5,
        dismissPendingPileUntilIso: iso(12 * 60 * 60 * 1000),
      }),
    );
    expect(res.kind).toBe('long-failure');
  });

  it('fires when dismiss has expired', () => {
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: iso(-90 * 60 * 1000),
        pendingCount: PENDING_PILE_THRESHOLD + 5,
        dismissPendingPileUntilIso: iso(-1 * 60 * 1000),
      }),
    );
    expect(res.kind).toBe('pending-pile');
  });

  it('long-failure heavy trumps pending-pile suppression', () => {
    // > 3 days since push · suppression in effect · still heavy
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: iso(-5 * 24 * 60 * 60 * 1000),
        pendingCount: PENDING_PILE_THRESHOLD + 5,
        dismissPendingPileUntilIso: iso(12 * 60 * 60 * 1000),
      }),
    );
    expect(res.kind).toBe('long-failure');
    if (res.kind === 'long-failure') {
      expect(res.severity).toBe('heavy');
    }
  });

  it('long-failure distinct trumps pending-pile (1-3 day range wins)', () => {
    const res = classifySyncStatus(
      inputs({
        lastSuccessPushIso: iso(-2 * 24 * 60 * 60 * 1000),
        pendingCount: PENDING_PILE_THRESHOLD + 5,
        dismissPendingPileUntilIso: null,
      }),
    );
    expect(res.kind).toBe('long-failure');
  });
});
