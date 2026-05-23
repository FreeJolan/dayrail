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

/** Pull-freshness window (ERD §7.10.5 · v0.12.7). A pull failure
 *  within this window of the last successful pull is a transient blip,
 *  not yet "can't reach cloud". 10 min = 2× the periodic-probe interval
 *  so a single missed probe doesn't alarm. Tunable. */
export const PULL_FRESHNESS_MS = 10 * MIN_MS;

export interface SyncStatusInputs {
  /** Wall clock at the moment of classification, epoch ms. */
  nowMs: number;
  /** How many local writes since the last successful push. */
  pendingCount: number;
  /** ISO of the most recent successful push · null = never pushed. */
  lastSuccessPushIso: string | null;
  /** ISO of the most recent successful pull/probe · null = never pulled. */
  lastSuccessPullIso: string | null;
  /** The most recent PUSH attempt failed (we're in a push-failing state). */
  pushErroring: boolean;
  /** The most recent PULL/probe attempt failed. */
  pullErroring: boolean;
  /** This session has had ≥1 successful sync round-trip (push OR pull).
   *  §7.9 false-OK guard: never claim "已同步" before we've actually
   *  reached remote once this session (guards the wipe / empty-DB case). */
  sessionRoundTripDone: boolean;
}

/** ERD §7.10.5 · v0.12.7 two-axis model. The old single "time since
 *  push" axis is gone — it false-alarmed on idle-but-consistent devices
 *  (no changes → no push → stale timestamp → fake "同步断开") and missed
 *  the real pull-stale risk. Alarm states now require an actual failed
 *  attempt, never mere idleness. */
export type SyncStatusClassification =
  /** #7 — local matches remote: nothing pending, a round-trip confirmed
   *  this session, pull not erroring. The honest "已同步". */
  | { kind: 'synced'; lastSuccessPullIso: string | null }
  /** #8 — nothing pending and nothing failing, but no round-trip is
   *  confirmed yet this session (just relaunched / first sync pending,
   *  or a recent pull blip within the freshness window). "检查中". */
  | { kind: 'checking' }
  /** #6 — local changes queued, push not (yet) failing. Transient. */
  | { kind: 'queued'; count: number }
  /** #4 — pending changes the push can't deliver (data at risk).
   *  durationMs = time since last successful push. */
  | {
      kind: 'push-failure';
      /** Mild < 1 day · distinct 1-3 days · heavy > 3 days. */
      severity: 'mild' | 'distinct' | 'heavy';
      count: number;
      durationMs: number;
    }
  /** #5 — can't reach the cloud (pull/probe failing past the freshness
   *  window). durationMs = time since last successful pull. */
  | {
      kind: 'pull-failure';
      severity: 'mild' | 'distinct' | 'heavy';
      durationMs: number;
    };

function severityFor(durationMs: number): 'mild' | 'distinct' | 'heavy' {
  if (durationMs >= 3 * DAY_MS) return 'heavy';
  if (durationMs >= DAY_MS) return 'distinct';
  return 'mild';
}

/** Age of an ISO timestamp in ms, or +Infinity when null/unparseable
 *  (treated as "forever ago" so the ladder shows its heaviest copy). */
function ageMsOrInfinity(iso: string | null, nowMs: number): number {
  if (iso === null) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - ms);
}

/** Two-axis sync health (ERD §7.10.5 · v0.12.7). Pure function — no IO,
 *  no time, no state. Priority order: data-at-risk → can't-reach-cloud
 *  → queued → synced → checking. */
export function classifySyncStatus(
  inp: SyncStatusInputs,
): SyncStatusClassification {
  // #4 — changes at risk: pending writes the push can't deliver.
  //   (a) push actively erroring while changes are pending, or
  //   (b) never confirmed a push on this device + a pile of writes
  //       (worst case for the "thought I was syncing but wasn't" framing).
  if (inp.pendingCount > 0 && inp.pushErroring) {
    const durationMs = ageMsOrInfinity(inp.lastSuccessPushIso, inp.nowMs);
    return {
      kind: 'push-failure',
      severity: severityFor(durationMs),
      count: inp.pendingCount,
      durationMs,
    };
  }
  if (
    inp.lastSuccessPushIso === null &&
    inp.pendingCount > PENDING_PILE_THRESHOLD
  ) {
    return {
      kind: 'push-failure',
      severity: 'heavy',
      count: inp.pendingCount,
      durationMs: Number.POSITIVE_INFINITY,
    };
  }

  // #5 — can't reach cloud: pull/probe failing AND stale past the
  //   freshness window (a single recent blip isn't alarmed).
  if (inp.pullErroring) {
    const durationMs = ageMsOrInfinity(inp.lastSuccessPullIso, inp.nowMs);
    if (durationMs >= PULL_FRESHNESS_MS) {
      return {
        kind: 'pull-failure',
        severity: severityFor(durationMs),
        durationMs,
      };
    }
  }

  // #6 — queued: pending changes, no active push failure (debounce /
  //   in-between). Transient, non-alarming.
  if (inp.pendingCount > 0) {
    return { kind: 'queued', count: inp.pendingCount };
  }

  // pending == 0 below.
  // #7 — synced: a round-trip is confirmed this session AND pull isn't
  //   erroring. Idle time since last push is IRRELEVANT (nothing to
  //   push ≠ broken). This is the fix for the false "同步断开".
  if (inp.sessionRoundTripDone && !inp.pullErroring) {
    return { kind: 'synced', lastSuccessPullIso: inp.lastSuccessPullIso };
  }

  // #8 — checking: nothing pending, nothing failing, but currency not
  //   yet confirmed this session. Non-alarming (NOT "断开").
  return { kind: 'checking' };
}
