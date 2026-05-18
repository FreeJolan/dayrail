// Pending-departure surface (ERD §7.10.3 · v0.12 P6).
//
// Mounts at the top of main when the previous session was left with
// unsynced edits AND the user opted to "leave anyway" through the
// DepartureGateModal. Reads the marker from SyncMeta written by
// `setPendingDeparture` · cleared automatically by any successful
// push (see syncController.runPush).
//
// Sits ABOVE the ReconcileBanner: the message is about THIS device's
// last session, not peer state, so it takes visual priority. Both
// can be visible simultaneously when applicable.

import { useState } from 'react';
import { useSyncStatus } from '@/lib/sync/syncStore';
import {
  getPendingDeparture,
  setPendingDeparture,
} from '@/lib/sync/identity';
import { runManualSync } from '@/lib/sync/syncController';

export function PendingDepartureBanner() {
  // syncStatus subscription so push success (which clears the marker)
  // triggers re-render.
  const status = useSyncStatus();
  void status;
  const [retrying, setRetrying] = useState(false);
  const [tick, setTick] = useState(0);
  void tick;

  const pending = getPendingDeparture();
  if (!pending) return null;

  const onRetry = async () => {
    setRetrying(true);
    try {
      await runManualSync();
      // Success clears the marker via runPush · re-render via state
      // changes the syncStore subscription picks up.
    } catch {
      /* failure surfaces via syncStore.phase / SyncStatusBanner */
    }
    setRetrying(false);
    setTick((n) => n + 1);
  };

  const onIgnore = () => {
    setPendingDeparture(null);
    setTick((n) => n + 1);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-surface-3 bg-surface-2 px-4 py-2 text-xs text-ink-primary"
    >
      <span aria-hidden className="text-warn">
        ⏪
      </span>
      <span className="flex-1">
        上次离开时有 <strong>{pending.count}</strong>{' '}
        个改动还没传上去 · 现在试一下吗？
      </span>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={retrying}
        className="rounded-md bg-surface-1 px-2.5 py-1 text-2xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
      >
        {retrying ? '正在传…' : '现在传一下'}
      </button>
      <button
        type="button"
        onClick={onIgnore}
        className="rounded-md px-2.5 py-1 text-2xs text-ink-tertiary transition hover:text-ink-secondary"
      >
        先放着
      </button>
    </div>
  );
}
