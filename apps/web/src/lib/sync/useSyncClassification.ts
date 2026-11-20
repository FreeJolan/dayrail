// Hook · classify the current sync state via the §7.10.5 two-axis
// model (synced / checking / queued / push-failure / pull-failure).
// React-friendly wrapper around the pure `classifySyncStatus` in
// @dayrail/core — derives the push/pull erroring + round-trip signals
// from the SyncMeta cache and the live syncStore.
//
// Re-renders triggered by:
//   1. syncStore updates (push/pull/error) — listener via useSyncStore
//   2. SyncMeta cursor writes — fire-and-forget into the cache (no
//      external subscription, but the syncStore changes alongside in
//      runPush so this is fine for the realistic use cases)
//   3. Periodic 60s tick so the duration ladder ticks forward even
//      when no events fire (the "I left the tab open for 2 hours"
//      case)

import { useEffect, useState } from 'react';
import {
  classifySyncStatus,
  type SyncStatusClassification,
} from '@dayrail/core';
import { useSyncStatus } from './syncStore';
import { getLastSuccessAt, getRecentAttempts } from './identity';

const TICK_MS = 60 * 1000;

/** Did the most recent attempt in `direction` fail? Walks the ring
 *  buffer back to the latest attempt of that direction. False when
 *  there is none (never attempted = not erroring). */
function lastAttemptErroring(direction: 'push' | 'pull'): boolean {
  const attempts = getRecentAttempts();
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i];
    if (a && a.direction === direction) return a.result === 'fail';
  }
  return false;
}

/** Start of the current push-failure streak: the EARLIEST failed push
 *  attempt with no successful push attempt after it. null when the
 *  latest push attempt succeeded (or none was recorded). This is the
 *  honest basis for "传不上去多久了" — time since the last success
 *  would silently include idle time (push only runs on changes).
 *  Lower-bound caveat: the ring buffer caps at 100 attempts, so a
 *  very long streak reports at least the span the buffer still sees. */
function pushFailingSince(): string | null {
  const attempts = getRecentAttempts();
  let since: string | null = null;
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i];
    if (!a || a.direction !== 'push') continue;
    if (a.result === 'ok') break;
    since = a.at;
  }
  return since;
}

export function useSyncClassification(): SyncStatusClassification {
  const status = useSyncStatus();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // `tick` participates in the dep so the memo re-runs every minute
  // even if status didn't change.
  void tick;

  if (!status.connected) {
    // Local-only mode · classification isn't meaningful (SideNav shows
    // "本地" before ever reading this).
    return { kind: 'checking' };
  }

  const pushFailSince = pushFailingSince();
  return classifySyncStatus({
    nowMs: Date.now(),
    pendingCount: status.dirtyCount,
    lastSuccessPushIso: getLastSuccessAt('push'),
    lastSuccessPullIso: getLastSuccessAt('pull'),
    // "Latest push attempt failed" ⇔ "a failure streak exists".
    pushErroring: pushFailSince !== null,
    pushFailingSinceIso: pushFailSince,
    pullErroring: lastAttemptErroring('pull'),
    sessionRoundTripDone: status.sessionRoundTripDone,
  });
}
