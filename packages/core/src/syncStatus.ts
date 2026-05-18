// Duration-aware sync status helpers (ERD §7.10.5 · v0.12 P2).
//
// Pure functions only — no IO, no time, no global state. Inputs come
// in via parameters; the IO layer (apps/web/.../syncController.ts +
// identity.ts) wires the wall-clock time, the SyncMeta cursors, and
// the user's pending count into these functions.
//
// Two kinds of output:
//   1. `formatDurationAgo` / `formatDurationLong` — human-language
//      duration strings used by the SideNav tooltip and the top
//      banner. Chinese, since UI locale is zh-CN.
//   2. `classifySyncStatus` — the decision: do we show a banner,
//      and which one? Captures the §7.10.5 escalation ladder + the
//      pending-pile threshold in one place.

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** Threshold above which "pending pile" alert fires (ERD §7.10.5).
 *  Calibrated post-dogfood; exported so the banner can show the
 *  same number it uses for the decision. */
export const PENDING_PILE_THRESHOLD = 20;

// ============ duration formatting ============

/** "刚刚" / "5 分钟前" / "3 小时前" / "2 天前" — the side of the
 *  duration shown to the user when sync is healthy. */
export function formatDurationAgo(fromIso: string, nowMs: number): string {
  const fromMs = Date.parse(fromIso);
  if (Number.isNaN(fromMs)) return '未知时间';
  const diffMs = Math.max(0, nowMs - fromMs);
  if (diffMs < MIN_MS) return '刚刚';
  if (diffMs < HOUR_MS) {
    const m = Math.floor(diffMs / MIN_MS);
    return `${m} 分钟前`;
  }
  if (diffMs < DAY_MS) {
    const h = Math.floor(diffMs / HOUR_MS);
    return `${h} 小时前`;
  }
  const d = Math.floor(diffMs / DAY_MS);
  return `${d} 天前`;
}

/** "传不上去 N 小时了" / "已经 N 天没传上去" — the warn-state copy.
 *  Distinct from `formatDurationAgo` so the wording can carry the
 *  problem framing (e.g. "传不上去" vs "刚刚同步过"). */
export function formatDurationLong(durationMs: number): string {
  const clamped = Math.max(0, durationMs);
  if (clamped >= DAY_MS) {
    const d = Math.floor(clamped / DAY_MS);
    return `已经 ${d} 天多没传上去`;
  }
  if (clamped >= HOUR_MS) {
    const h = Math.floor(clamped / HOUR_MS);
    return `传不上去 ${h} 小时了`;
  }
  const m = Math.floor(clamped / MIN_MS);
  return `传不上去 ${m} 分钟了`;
}

// ============ classification ============

export interface SyncStatusInputs {
  /** Wall clock at the moment of classification, epoch ms. */
  nowMs: number;
  /** ISO timestamp of the most recent successful push. null when
   *  this device has never had a successful push (fresh install /
   *  first connect not yet attempted). */
  lastSuccessPushIso: string | null;
  /** How many local writes since the last successful push. */
  pendingCount: number;
  /** ISO timestamp until which pending-pile alert is suppressed
   *  (user pressed "先关掉"). null = no suppression. */
  dismissPendingPileUntilIso: string | null;
}

export type SyncStatusClassification =
  | { kind: 'healthy' }
  | {
      kind: 'long-failure';
      /** Mild = 1-24h · distinct = 1-3 days · heavy = > 3 days. */
      severity: 'mild' | 'distinct' | 'heavy';
      durationMs: number;
    }
  | {
      kind: 'pending-pile';
      count: number;
      durationMs: number;
    };

/** Walk the §7.10.5 escalation ladder + pending-pile threshold.
 *  Pure function — no IO, no time, no state. */
export function classifySyncStatus(
  inp: SyncStatusInputs,
): SyncStatusClassification {
  // Never successfully pushed on this device.
  if (inp.lastSuccessPushIso === null) {
    if (inp.pendingCount > PENDING_PILE_THRESHOLD) {
      // Local writes exist but no push has ever confirmed. Worst
      // case for the "I thought I was syncing but wasn't" framing
      // — flag as heavy long-failure with infinite duration so the
      // banner shows.
      return {
        kind: 'long-failure',
        severity: 'heavy',
        durationMs: Number.POSITIVE_INFINITY,
      };
    }
    return { kind: 'healthy' };
  }

  const lastMs = Date.parse(inp.lastSuccessPushIso);
  if (Number.isNaN(lastMs)) return { kind: 'healthy' };
  const durationMs = Math.max(0, inp.nowMs - lastMs);

  if (durationMs >= 3 * DAY_MS) {
    return { kind: 'long-failure', severity: 'heavy', durationMs };
  }
  if (durationMs >= DAY_MS) {
    return { kind: 'long-failure', severity: 'distinct', durationMs };
  }
  if (durationMs < HOUR_MS) {
    return { kind: 'healthy' };
  }

  // 1-24h zone — pending-pile vs mild long-failure.
  const pileSuppressed =
    inp.dismissPendingPileUntilIso !== null &&
    Date.parse(inp.dismissPendingPileUntilIso) > inp.nowMs;
  if (inp.pendingCount > PENDING_PILE_THRESHOLD && !pileSuppressed) {
    return {
      kind: 'pending-pile',
      count: inp.pendingCount,
      durationMs,
    };
  }
  return { kind: 'long-failure', severity: 'mild', durationMs };
}
