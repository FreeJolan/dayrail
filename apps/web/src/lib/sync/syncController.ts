// Sync controller — orchestrates push (debounced after writes,
// pagehide best-effort, manual button) and the boot-gate pull. Keeps
// identity cursors + syncStore in sync.
//
// Push path:
//   1. caller (subscription / manual button / pagehide) calls
//      requestPush().
//   2. controller debounces 60s; first event after a quiet window
//      goes through immediately, follow-ups within the window are
//      collapsed.
//   3. uploads with a fresh snapshotId; parentSnapshotId =
//      lastPulledSnapshotId at upload time. Pre-flight: read remote
//      meta, ensure it still matches our parent — if not, abort and
//      transition to "diverged" (next boot will surface the conflict
//      card; mid-session we just stop pushing until the user pulls).
//
// Pull path:
//   1. boot gate calls runBootProbe() which returns a decision the
//      gate UI then acts on (apply remote / show conflict / skip).
//   2. If user accepts, applyRemote() stashes the bundle in the
//      same sessionStorage key importLocalData uses, then resets
//      OPFS — boot.ts on reload picks it up via popPendingImport.

import { useStore, type DayRailState } from '@dayrail/core';
import {
  buildExportBundle,
  type ExportBundle,
  downloadBundleAs,
} from '../exportData';
import { stashPendingImportAndReload } from '../importData';
import {
  bumpDirtyCount,
  clearDirtyCount,
  getDeviceId,
  getDeviceLabel,
  getDirtyCount,
  getLastPulledSnapshotId,
  setLastPulledSnapshotId,
  setLastSyncInfo,
} from './identity';
import {
  downloadBundleById,
  getRemoteMeta,
  uploadSnapshot,
  type RemoteMeta,
} from './driveBackend';
import { isDriveConnected } from './driveAuth';
import { syncStore } from './syncStore';

const PUSH_DEBOUNCE_MS = 60 * 1000;
const PROBE_SOFT_TIMEOUT_MS = 1500;
const PROBE_HARD_TIMEOUT_MS = 3500;
const RECOVERY_KICK_DELAY_MS = 1500;
const RETRY_BACKOFF_MS = 5 * 60 * 1000;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let unsubStore: (() => void) | null = null;
let inFlightPush: Promise<void> | null = null;

/** Wire dirty-count tracking to the core store. Called once from
 *  main.tsx after boot. Subscribes to maps that represent user-
 *  authored state; map-identity changes (immer produces new
 *  references on writes) bump the dirty counter and schedule a
 *  push. */
export function startSyncBackgroundLoop(): void {
  if (unsubStore) return;
  unsubStore = useStore.subscribe((curr, prev) => {
    if (didUserStateChange(curr, prev)) {
      const next = bumpDirtyCount();
      syncStore.setDirtyCount(next);
      schedulePush();
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
  }

  // v0.6.3 recovery kick: schedulePush's timer dies on page reload,
  // but dirtyCount lives in localStorage and survives. Without this
  // kick, dirty work that was scheduled but not yet pushed at reload
  // time would sit indefinitely (until the next user write or tab
  // hide). Fire one push shortly after boot if there's anything
  // pending. Small delay so boot-time auto-task materialization etc.
  // settle into the same push.
  if (isDriveConnected() && getDirtyCount() > 0) {
    setTimeout(() => {
      if (!isDriveConnected() || getDirtyCount() === 0) return;
      void runPush({ trigger: 'recovery' }).catch((err) => {
        console.warn('[sync] recovery push failed:', err);
      });
    }, RECOVERY_KICK_DELAY_MS);
  }
}

function didUserStateChange(curr: DayRailState, prev: DayRailState): boolean {
  return (
    curr.templates !== prev.templates ||
    curr.rails !== prev.rails ||
    curr.lines !== prev.lines ||
    curr.tasks !== prev.tasks ||
    curr.signals !== prev.signals ||
    curr.shifts !== prev.shifts ||
    curr.adhocEvents !== prev.adhocEvents ||
    curr.calendarRules !== prev.calendarRules ||
    curr.cycles !== prev.cycles ||
    curr.habitPhases !== prev.habitPhases ||
    curr.habitBindings !== prev.habitBindings ||
    curr.railRevisions !== prev.railRevisions ||
    curr.templateRevisions !== prev.templateRevisions ||
    curr.calendarRuleRevisions !== prev.calendarRuleRevisions ||
    curr.habitBindingRevisions !== prev.habitBindingRevisions ||
    curr.railTombstones !== prev.railTombstones ||
    curr.templateTombstones !== prev.templateTombstones ||
    curr.calendarRuleTombstones !== prev.calendarRuleTombstones ||
    curr.habitBindingTombstones !== prev.habitBindingTombstones
  );
}

function schedulePush(): void {
  if (!isDriveConnected()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void runPush({ trigger: 'debounced' }).catch((err) => {
      console.warn('[sync] debounced push failed:', err);
    });
  }, PUSH_DEBOUNCE_MS);
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    if (getDirtyCount() > 0 && isDriveConnected()) {
      void runPush({ trigger: 'visibilitychange' }).catch((err) => {
        console.warn('[sync] visibilitychange push failed:', err);
      });
    }
  }
}

function onPageHide(): void {
  if (getDirtyCount() > 0 && isDriveConnected()) {
    void runPush({ trigger: 'pagehide' }).catch(() => {
      /* swallow — we're leaving the page anyway */
    });
  }
}

function onBeforeUnload(): void {
  // Best-effort keepalive push. If the user has already triggered a
  // recent push (no dirty items), skip — we'd just churn Drive.
  if (getDirtyCount() === 0 || !isDriveConnected()) return;
  // We can't await here without blocking the unload. Fire and forget;
  // the keepalive flag inside runPush's fetch chain is what makes it
  // survive teardown for short uploads.
  void runPush({ trigger: 'beforeunload', keepalive: true }).catch(() => {
    /* ignore */
  });
}

interface RunPushOpts {
  trigger:
    | 'manual'
    | 'debounced'
    | 'visibilitychange'
    | 'pagehide'
    | 'beforeunload'
    | 'recovery'
    | 'retry';
  keepalive?: boolean;
}

/** Manual entry-point — wired to Settings → 同步 → 立即同步. */
export async function runManualPush(): Promise<void> {
  await runPush({ trigger: 'manual' });
}

async function runPush(opts: RunPushOpts): Promise<void> {
  if (inFlightPush) {
    // Another push is in flight; reschedule on its tail.
    return inFlightPush.then(() => runPush(opts));
  }
  if (!isDriveConnected()) return;

  const phaseBefore = syncStore.getSnapshot().phase;
  syncStore.setPhase({ kind: 'syncing', reason: 'push' });

  inFlightPush = (async () => {
    try {
      // Pre-flight: ensure remote hasn't moved past our parent. If it
      // has, we're diverged and can't safely push — surface offline-
      // ish state and let the next boot's gate run the conflict card.
      const remote = await getRemoteMeta().catch(() => null);
      const parent = getLastPulledSnapshotId();
      if (remote && parent && remote.snapshotId !== parent) {
        // Diverged mid-session. Don't auto-overwrite remote.
        syncStore.setPhase({
          kind: 'error',
          message: '云端有另一台设备的新改动，请在 Settings 同步页处理',
        });
        return;
      }

      const snapshotId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const bundle = buildExportBundle({
        snapshotId,
        ...(parent && { parentSnapshotId: parent }),
        deviceId: getDeviceId(),
        deviceLabel: getDeviceLabel(),
      });

      await uploadSnapshot(bundle);

      setLastPulledSnapshotId(snapshotId);
      clearDirtyCount();
      syncStore.setDirtyCount(0);
      const info = { at: Date.now(), label: getDeviceLabel() };
      setLastSyncInfo(info);
      syncStore.setLastSync(info);
      syncStore.setPhase({ kind: 'idle' });
      // Successful push — drop any pending retry.
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.warn('[sync] push failed:', err);
      syncStore.setPhase({ kind: 'error', message: msg });
      // Restore the previous phase if it was idle — but keep error
      // visible if user explicitly triggered manual.
      if (opts.trigger !== 'manual' && phaseBefore.kind === 'idle') {
        // For background pushes we want to fall back to idle quickly
        // so the indicator doesn't get stuck — but keep the dirty
        // banner because dirtyCount is still > 0.
        setTimeout(() => {
          if (syncStore.getSnapshot().phase.kind === 'error') {
            syncStore.setPhase({ kind: 'idle' });
          }
        }, 2000);
      }
      // v0.6.3 retry: if there's still dirty work and we're still
      // connected, schedule a single retry after a backoff window.
      // Skipped for manual triggers (the user is right there and
      // can re-click) and for the retry trigger itself (no infinite
      // ladder; next user write or visibility-change will pick it up).
      if (
        opts.trigger !== 'manual' &&
        opts.trigger !== 'retry' &&
        getDirtyCount() > 0 &&
        isDriveConnected()
      ) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!isDriveConnected() || getDirtyCount() === 0) return;
          void runPush({ trigger: 'retry' }).catch(() => {
            // Already logged inside; swallow here so the retry
            // chain doesn't fan out into uncaught rejections.
          });
        }, RETRY_BACKOFF_MS);
      }
      throw err;
    } finally {
      inFlightPush = null;
    }
  })();

  return inFlightPush;
}

// ============ Boot probe + apply ============

export type BootProbeOutcome =
  | { kind: 'no-remote' } // remote has never been written
  | { kind: 'equal'; remote: RemoteMeta } // remote.snapshotId === lastPulled
  | { kind: 'linear-lead'; remote: RemoteMeta } // remote ahead, local clean
  | { kind: 'diverged'; remote: RemoteMeta } // remote ahead, local dirty
  | { kind: 'offline'; reason: string };

/** Boot gate calls this once on cold start to decide what to render
 *  (silent pull / confirm card / conflict card / offline banner).
 *  Soft and hard timeouts mirror ERD §7.6. */
export async function runBootProbe(): Promise<BootProbeOutcome> {
  if (!isDriveConnected()) {
    return { kind: 'offline', reason: 'NOT_CONNECTED' };
  }
  syncStore.setPhase({ kind: 'syncing', reason: 'probe' });

  let timedOut = false;
  const hardTimer = new Promise<BootProbeOutcome>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve({ kind: 'offline', reason: 'TIMEOUT' });
    }, PROBE_HARD_TIMEOUT_MS);
  });

  const probe = (async (): Promise<BootProbeOutcome> => {
    try {
      const remote = await getRemoteMeta();
      if (!remote) {
        return { kind: 'no-remote' };
      }
      const lastPulled = getLastPulledSnapshotId();
      if (remote.snapshotId === lastPulled) {
        return { kind: 'equal', remote };
      }
      const dirty = getDirtyCount() > 0;
      return dirty
        ? { kind: 'diverged', remote }
        : { kind: 'linear-lead', remote };
    } catch (err) {
      const msg = (err as Error).message ?? 'PROBE_FAILED';
      return { kind: 'offline', reason: msg };
    }
  })();

  const outcome = await Promise.race([probe, hardTimer]);
  if (timedOut) {
    syncStore.setPhase({ kind: 'offline', message: '同步探测超时' });
  } else {
    syncStore.setPhase({ kind: 'idle' });
  }
  return outcome;
}

export const PROBE_TIMEOUTS = {
  soft: PROBE_SOFT_TIMEOUT_MS,
  hard: PROBE_HARD_TIMEOUT_MS,
};

/** Apply a remote bundle to local: stash it, persist
 *  lastPulledSnapshotId, then OPFS reset + reload. The function
 *  never returns — the reload takes over. */
export async function applyRemoteBundle(bundle: ExportBundle): Promise<void> {
  if (bundle.snapshotId) {
    setLastPulledSnapshotId(bundle.snapshotId);
  }
  clearDirtyCount();
  syncStore.setDirtyCount(0);
  await stashPendingImportAndReload(bundle);
}

/** Pull the remote canonical bundle in full (body, not just meta).
 *  Used by the boot gate's "linear lead, accept pull" path and the
 *  conflict card's "keep remote" path. */
export async function fetchRemoteBundle(remote: RemoteMeta): Promise<ExportBundle> {
  return downloadBundleById(remote.fileId);
}

/** For the conflict card "overwrite remote" path: download a copy of
 *  the remote bundle to the user's Downloads first, so the action is
 *  reversible. ERD §7.6 mandates this gate. */
export async function downloadRemoteAsBackup(remote: RemoteMeta): Promise<void> {
  const bundle = await downloadBundleById(remote.fileId);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadBundleAs(bundle, `dayrail-remote-conflict-${ts}.json`);
}

/** For the conflict card "keep remote, export local first" path. */
export function downloadLocalAsBackup(): void {
  const bundle = buildExportBundle();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadBundleAs(bundle, `dayrail-local-conflict-${ts}.json`);
}

/** For the conflict card "overwrite remote" path: forces a push that
 *  bypasses the parent-snapshot check (we KNOW remote is ahead and
 *  the user authorized the overwrite). */
export async function forcePushOverridingRemote(): Promise<void> {
  syncStore.setPhase({ kind: 'syncing', reason: 'push' });
  const snapshotId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // We deliberately do NOT set parentSnapshotId — this push is a
  // "fork override". The next pull on any other device will treat
  // this as the new canonical and offer the diverged card.
  const bundle = buildExportBundle({
    snapshotId,
    deviceId: getDeviceId(),
    deviceLabel: getDeviceLabel(),
  });
  await uploadSnapshot(bundle);
  setLastPulledSnapshotId(snapshotId);
  clearDirtyCount();
  syncStore.setDirtyCount(0);
  const info = { at: Date.now(), label: getDeviceLabel() };
  setLastSyncInfo(info);
  syncStore.setLastSync(info);
  syncStore.setPhase({ kind: 'idle' });
}
