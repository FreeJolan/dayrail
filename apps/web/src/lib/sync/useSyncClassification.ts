// Hook · classify the current sync state into the §7.10.5 ladder
// (healthy / long-failure / pending-pile). React-friendly wrapper
// around the pure `classifySyncStatus` in @dayrail/core.
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
import {
  getDismissPendingPileUntil,
  getLastSuccessAt,
} from './identity';

const TICK_MS = 60 * 1000;

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
    // Local-only mode · classification isn't meaningful.
    return { kind: 'healthy' };
  }

  return classifySyncStatus({
    nowMs: Date.now(),
    lastSuccessPushIso: getLastSuccessAt('push'),
    pendingCount: status.dirtyCount,
    dismissPendingPileUntilIso: getDismissPendingPileUntil(),
  });
}
