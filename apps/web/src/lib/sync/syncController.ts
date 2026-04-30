// Sync controller (v0.7) — orchestrates push (debounced after writes,
// pagehide best-effort, manual button) and the boot-gate pull. Keeps
// identity cursors + syncStore in sync.
//
// v0.7 wire format: `.dryj` Yjs binary container (see @dayrail/db/dryj).
// Yjs's internal LWW + Lamport clock handles convergence, so the
// "diverged" branch is gone — every pull is `Y.applyUpdate` and every
// push uploads the local Y.Doc state. There is no in-flight conflict
// surface; the user just sees field-level merges happen.
//
// Push path:
//   1. caller (subscription / manual button / pagehide) calls
//      requestPush().
//   2. controller debounces 60s; first event after a quiet window
//      goes through immediately, follow-ups within the window are
//      collapsed.
//   3. encodes Y.Doc → .dryj → uploads as application/octet-stream.
//
// Pull path:
//   1. boot gate calls runBootProbe(); on linear-lead it downloads the
//      remote `.dryj` and applyRemoteUpdate'd in-memory. The Y.Doc
//      observer re-derives flat state and zustand setState fires —
//      no page reload needed.

import {
  useStore,
  exportYDocAsUpdate,
  applyRemoteUpdate,
  replaceFromRemote,
  getYDoc,
  REMOTE_ORIGIN,
  OPFS_ORIGIN,
} from '@dayrail/core';
import { encodeDryj, type DryjMeta } from '@dayrail/db/dryj';
import {
  bumpDirtyCount,
  clearDirtyCount,
  clearLocalIsSamplesOnly,
  getDeviceId,
  getDeviceLabel,
  getDirtyCount,
  getLastPulledSnapshotId,
  isLocalSamplesOnly,
  setLastPulledSnapshotId,
  setLastSyncInfo,
} from './identity';
import {
  downloadDryjById,
  getRemoteMeta,
  uploadDryj,
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
let inFlightPull: Promise<void> | null = null;

/** True when a pull is currently in progress. RuntimeSyncDialog's
 *  tryProbe early-returns on this so it doesn't pop a "remote is
 *  ahead" prompt for a pull that's already happening (would compare
 *  against a stale lastPulled cursor mid-update). */
export function isPullInFlight(): boolean {
  return inFlightPull !== null;
}
/** Set when a runPush call arrives while another push is in-flight,
 *  asking the in-flight one to schedule one more push on completion.
 *  Coalesces multi-trigger windows (typing + visibility-change +
 *  debounce timer all firing) into a single follow-up push. */
let wantsPushFollowUp = false;

export function startSyncBackgroundLoop(): void {
  if (unsubStore) return;
  // Hook directly into the Y.Doc afterTransaction event (rather than
  // subscribing to zustand's setState chain). Two wins:
  //   1. transaction.origin is in the closure — no global
  //      `lastTransactOrigin` to clobber if a future subscriber
  //      re-enters Y.Doc.
  //   2. Every Y.Doc transaction is by definition a synced-state
  //      change (entities all live in Y.Doc); the v0.6
  //      didUserStateChange diff over 19 zustand maps is no longer
  //      needed.
  // pendingShiftPrompt is UI-ephemeral (zustand-only, not in Y.Doc),
  // so it correctly never triggers a dirty bump.
  const doc = getYDoc();
  const onTransaction = (transaction: { origin?: unknown }) => {
    const origin = transaction?.origin;
    if (origin === REMOTE_ORIGIN || origin === OPFS_ORIGIN) return;
    // First non-remote write since boot means the user has authored
    // something on top of (or instead of) the v0.7 sample seed.
    // Clear the samples-only flag so ConnectDrivePanel / BootGate
    // stop treating local as disposable. Cheap localStorage write;
    // safe to call repeatedly.
    if (isLocalSamplesOnly()) {
      clearLocalIsSamplesOnly();
    }
    // Session activity tracking: when origin is the id of an open
    // session (set by openEditSession + threaded through every
    // session-aware action's `doc.transact(..., sessionId ?? label)`),
    // bump that session's changeCount + lastActivityAt. Drives
    // EditSessionIndicator's "N changes since open" counter and the
    // future idle-close timer. Lookup is O(1) on the zustand
    // sessions map. Dropped event-log → touchSession in v0.7 cutover
    // left this hole; the indicator was reading a counter that
    // nothing incremented.
    if (typeof origin === 'string') {
      const sessions = useStore.getState().sessions;
      const session = sessions[origin];
      if (session) {
        useStore.setState((prev) => ({
          ...prev,
          sessions: {
            ...prev.sessions,
            [origin]: {
              ...session,
              changeCount: session.changeCount + 1,
              lastActivityAt: Date.now(),
            },
          },
        }));
      }
    }
    const next = bumpDirtyCount();
    syncStore.setDirtyCount(next);
    schedulePush();
  };
  doc.on('afterTransaction', onTransaction);
  unsubStore = () => doc.off('afterTransaction', onTransaction);

  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
  }

  if (isDriveConnected() && getDirtyCount() > 0) {
    setTimeout(() => {
      if (!isDriveConnected() || getDirtyCount() === 0) return;
      void runPush({ trigger: 'recovery' }).catch((err) => {
        console.warn('[sync] recovery push failed:', err);
      });
    }, RECOVERY_KICK_DELAY_MS);
  }
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
      /* leaving anyway */
    });
  }
}

function onBeforeUnload(): void {
  if (getDirtyCount() === 0 || !isDriveConnected()) return;
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

/** Manual sync outcome.
 *
 *  - `pushed` — local pushed.
 *  - `noop` — already in sync, nothing dirty.
 *  - `pulled` — remote was ahead; merged in-memory (no reload).
 *  - `offline` — Drive unreachable / not connected. */
export type ManualSyncOutcome =
  | { kind: 'pushed' }
  | { kind: 'noop' }
  | { kind: 'pulled' }
  | { kind: 'offline'; reason: string };

/** Manual entry — wired to Settings → 同步 → 立即同步. */
export async function runManualSync(): Promise<ManualSyncOutcome> {
  if (!isDriveConnected()) {
    return { kind: 'offline', reason: 'NOT_CONNECTED' };
  }
  const probe = await runBootProbe();
  if (probe.kind === 'offline') {
    return { kind: 'offline', reason: probe.reason };
  }
  if (probe.kind === 'no-remote') {
    await runPush({ trigger: 'manual' });
    return { kind: 'pushed' };
  }
  if (probe.kind === 'equal') {
    if (getDirtyCount() > 0) {
      await runPush({ trigger: 'manual' });
      return { kind: 'pushed' };
    }
    return { kind: 'noop' };
  }
  // linear-lead: pull (CRDT-merge in-memory; no reload). If the user
  // had uncommitted local writes pre-pull, those survive the merge
  // but Drive doesn't have them yet — explicitly push as part of the
  // same manual action so the user can close the tab right after
  // clicking 立即同步 without stranding their edits. (Without the
  // inline push, runPullFromRemote merely schedules a 60s debounce
  // that may not fire before tab close.) Return 'pushed' in that
  // path so UI surfaces tell the user "everything's on Drive now"
  // instead of the merge-only "已合并云端改动" hint.
  await runPullFromRemote(probe.remote);
  if (getDirtyCount() > 0 && isDriveConnected()) {
    await runPush({ trigger: 'manual' });
    return { kind: 'pushed' };
  }
  return { kind: 'pulled' };
}

/** Force-push: upload the current local Y.Doc to Drive WITHOUT the
 *  runPush preflight pull-merge. Drive's canonical becomes whatever
 *  this device has; remote devices' subsequent pulls will CRDT-merge
 *  with their LOCAL ops (those survive). Use case: user just imported
 *  a `.dryj` they want Drive to mirror exactly, or wants to "rollback"
 *  Drive after Yjs surprised them. Distinct from `runPush({ trigger:
 *  'manual' })` which would pull-merge first and re-upload the union. */
export async function runForcePush(): Promise<void> {
  if (!isDriveConnected()) throw new Error('NOT_CONNECTED');
  // Cancel anything that would re-merge AFTER this force push.
  // Specifically:
  //   - pushTimer: a debounced runPush 60s later would do a
  //     preflight pull-merge against the new force-pushed canonical
  //     plus any third-device push that landed in the gap, then
  //     upload the merge — undoing the force-push intent.
  //   - retryTimer: same shape after a recent push failure.
  //   - wantsPushFollowUp: similar — force-push replaces the in-
  //     flight push semantics; we don't want a follow-up debounced
  //     push to fire.
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  wantsPushFollowUp = false;
  // Serialize behind any in-flight push/pull to avoid racing on the
  // lastPulled cursor.
  if (inFlightPull) {
    try {
      await inFlightPull;
    } catch {
      /* continue */
    }
  }
  if (inFlightPush) {
    try {
      await inFlightPush;
    } catch {
      /* continue */
    }
  }
  syncStore.setPhase({ kind: 'syncing', reason: 'push' });
  inFlightPush = (async () => {
    try {
      const update = exportYDocAsUpdate();
      const snapshotId = cryptoUUID();
      const meta: DryjMeta = {
        snapshotId,
        // No parentSnapshotId — force-push is intentionally
        // detached from prior lineage.
        deviceId: getDeviceId(),
        deviceLabel: getDeviceLabel(),
        createdAt: new Date().toISOString(),
        schemaVersion: 2,
      };
      const bytes = encodeDryj(meta, update);
      await uploadDryj(bytes, {
        snapshotId,
        deviceId: getDeviceId(),
        deviceLabel: getDeviceLabel(),
      });
      setLastPulledSnapshotId(snapshotId);
      clearDirtyCount();
      syncStore.setDirtyCount(0);
      clearLocalIsSamplesOnly();
      const info = { at: Date.now(), label: getDeviceLabel() };
      setLastSyncInfo(info);
      syncStore.setLastSync(info);
      syncStore.setPhase({ kind: 'idle' });
    } catch (err) {
      console.warn('[sync] force-push failed:', err);
      syncStore.setPhase({
        kind: 'error',
        message: (err as Error).message ?? '强制推送失败',
      });
      throw err;
    } finally {
      inFlightPush = null;
    }
  })();
  return inFlightPush;
}

async function runPullFromRemote(remote: RemoteMeta): Promise<void> {
  // Serialize against an in-flight push so the lineage cursor
  // (lastPulledSnapshotId) doesn't get clobbered by an upload's
  // post-success setLastPulledSnapshotId after we've already
  // written the pulled remote's snapshotId. If a push is mid-air,
  // wait for it to settle, then start the pull.
  if (inFlightPush) {
    try {
      await inFlightPush;
    } catch {
      /* push errored; we still want to attempt the pull */
    }
  }
  if (inFlightPull) return inFlightPull;
  inFlightPull = (async () => {
    syncStore.setPhase({ kind: 'syncing', reason: 'pull' });
    // Echo prevention: the inline doc.on('afterTransaction', ...)
    // listener registered in startSyncBackgroundLoop reads
    // transaction.origin from its closure and skips the dirty bump
    // when origin === REMOTE_ORIGIN / OPFS_ORIGIN. So the applyUpdate
    // below does NOT schedule a follow-up push.
    try {
      const bytes = await downloadDryjById(remote.fileId);
      applyRemoteUpdate(bytes);
      setLastPulledSnapshotId(remote.snapshotId);
      // Do NOT clearDirtyCount here. After Y.applyUpdate, the merged
      // Y.Doc holds the union of remote + local ops, but the *local*
      // ops are still unsynced — Drive's canonical only carries the
      // remote half (the bytes we just pulled). Zeroing the dirty
      // cursor would mean no push trigger fires until the user makes
      // another edit, stranding their pre-pull writes on this device.
      // Leave the count alone; if there were dirty ops before the
      // pull, they're still dirty after, and the next debounced /
      // visibility / manual push naturally sweeps them up. (runPush
      // clears dirty on success because the upload covers everything.)
      //
      // DO clear the samples-only flag though. After this merge path
      // completes, local holds (samples ∪ remote real data) — the
      // "samples-only" assertion is false; future pull surfaces should
      // not treat local as disposable. Defensive against the bug where
      // ConnectDrivePanel/BootGate/RuntimeSyncDialog took the merge
      // branch instead of replace (e.g., isLocalSamplesOnly() returned
      // a stale false), leaving the flag stuck at '1'.
      clearLocalIsSamplesOnly();
      const info = { at: Date.now(), label: getDeviceLabel() };
      setLastSyncInfo(info);
      syncStore.setLastSync(info);
      syncStore.setPhase({ kind: 'idle' });
      // If there's local-only work the pull just merged with, nudge
      // a push so it propagates to Drive without waiting for the next
      // user write. schedulePush respects the 60s debounce.
      if (getDirtyCount() > 0 && isDriveConnected()) {
        schedulePush();
      }
    } catch (err) {
      console.warn('[sync] pull failed:', err);
      syncStore.setPhase({
        kind: 'error',
        message: (err as Error).message ?? '拉取失败',
      });
      throw err;
    } finally {
      inFlightPull = null;
    }
  })();
  return inFlightPull;
}

async function runPush(opts: RunPushOpts): Promise<void> {
  // Early-return when dirty=0: nothing to upload. Specifically guards
  // against stale pushTimer / retryTimer firings AFTER runForcePush
  // (or replaceLocalFromRemote) zeroed the dirty cursor — without
  // this we'd waste a Drive history slot uploading the same state
  // under a fresh snapshotId. Skip the guard for 'manual' triggers
  // which want the noop semantics surfaced via runManualSync's
  // 'noop' return.
  if (opts.trigger !== 'manual' && getDirtyCount() === 0) return;
  // Coalesce reentrant pushes: if a push is already in-flight (e.g.
  // the user typed in 5 places, debounce fired, and a
  // visibility-change is now firing too), don't queue N follow-ups.
  // Mark "we want one more after this finishes"; the in-flight push
  // re-fires once if dirty-count is still > 0 when it lands.
  if (inFlightPush) {
    wantsPushFollowUp = true;
    return inFlightPush;
  }
  if (!isDriveConnected()) return;
  // Wait for any in-flight pull to settle so the upload encodes
  // post-merge state, not a snapshot taken during the merge window.
  if (inFlightPull) {
    try {
      await inFlightPull;
    } catch {
      /* pull errored; continue with whatever we have locally */
    }
  }

  const phaseBefore = syncStore.getSnapshot().phase;
  syncStore.setPhase({ kind: 'syncing', reason: 'push' });

  inFlightPush = (async () => {
    try {
      // Pre-flight: if remote has moved past our last pull, pull-and-
      // merge BEFORE encoding the upload. Drive isn't a Yjs server,
      // so it stores whatever bytes the last pusher uploaded — without
      // this step, A's push would overwrite a canonical that already
      // contained B's edits.
      //
      // This SHRINKS the wipe window from "anywhere between A's last
      // pull and A's upload" to "between A's preflight getRemoteMeta
      // and A's uploadDryj" — it does NOT close it. Drive REST has
      // no etag/precondition on the upload here, so a B-push that
      // lands inside the gap still overwrites. Local Y.Docs converge
      // eventually (next pull on either device merges everything),
      // but a freshly-provisioned device pulling Drive in the gap
      // sees a snapshot missing one side's ops until either device
      // pushes again. Acceptable for the single-user / occasional-
      // multi-device workload v0.7 targets; tighten with Drive
      // headRevisionId precondition if/when this ever bites.
      //
      // Skip the preflight for keepalive (pagehide budget) — the
      // next active push from this device will repair lineage.
      if (!opts.keepalive) {
        try {
          const remoteBefore = await getRemoteMeta();
          const lastPulled = getLastPulledSnapshotId();
          if (
            remoteBefore &&
            remoteBefore.snapshotId &&
            remoteBefore.snapshotId !== lastPulled
          ) {
            const remoteBytes = await downloadDryjById(remoteBefore.fileId);
            applyRemoteUpdate(remoteBytes);
            setLastPulledSnapshotId(remoteBefore.snapshotId);
            // Don't clearDirtyCount here — local still has unpushed
            // ops the upload below will carry. The merge added
            // remote ops on top; the union is what we encode.
          }
        } catch (preflightErr) {
          // If the preflight fails, fall through to a plain push —
          // worst case we re-introduce the v0.6 wipe-window for one
          // upload cycle, which is the prior behavior anyway.
          console.warn('[sync] pull-before-push preflight failed:', preflightErr);
        }
      }

      const update = exportYDocAsUpdate();
      const snapshotId = cryptoUUID();
      const parent = getLastPulledSnapshotId();
      const meta: DryjMeta = {
        snapshotId,
        ...(parent && { parentSnapshotId: parent }),
        deviceId: getDeviceId(),
        deviceLabel: getDeviceLabel(),
        createdAt: new Date().toISOString(),
        schemaVersion: 2,
      };
      const bytes = encodeDryj(meta, update);
      await uploadDryj(bytes, {
        snapshotId,
        ...(parent && { parentSnapshotId: parent }),
        deviceId: getDeviceId(),
        deviceLabel: getDeviceLabel(),
      });

      setLastPulledSnapshotId(snapshotId);
      clearDirtyCount();
      syncStore.setDirtyCount(0);
      // After a successful push, local has been committed to Drive.
      // The samples-only flag's whole job is to gate the destructive
      // "replace local with remote" branch on first-connect devices;
      // once we've pushed (whether the upload was samples or real
      // data), local IS now part of the canonical lineage, and a
      // future pull must merge — not replace. Clearing the flag here
      // covers the "fresh device → connect Drive (no canonical) →
      // ConnectDrivePanel pushes seeds up via runManualSync" path,
      // which previously left samplesOnly=1 forever.
      clearLocalIsSamplesOnly();
      const info = { at: Date.now(), label: getDeviceLabel() };
      setLastSyncInfo(info);
      syncStore.setLastSync(info);
      syncStore.setPhase({ kind: 'idle' });
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.warn('[sync] push failed:', err);
      syncStore.setPhase({ kind: 'error', message: msg });
      if (opts.trigger !== 'manual' && phaseBefore.kind === 'idle') {
        setTimeout(() => {
          if (syncStore.getSnapshot().phase.kind === 'error') {
            syncStore.setPhase({ kind: 'idle' });
          }
        }, 2000);
      }
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
            /* logged inside */
          });
        }, RETRY_BACKOFF_MS);
      }
      throw err;
    } finally {
      inFlightPush = null;
      // Replay-once if reentrant runPush calls landed during this
      // upload AND there's still real work to push. The flag is the
      // contract: "exactly one more push after I finish, regardless
      // of how many reentrant calls arrived." Without the dirty-
      // count check we'd echo a no-op upload.
      if (wantsPushFollowUp) {
        wantsPushFollowUp = false;
        if (getDirtyCount() > 0 && isDriveConnected()) {
          // Re-trigger as a debounced trigger so the new debounce
          // window collapses subsequent reentrants again.
          schedulePush();
        }
      }
    }
  })();

  return inFlightPush;
}

// ============ Boot probe ============

export type BootProbeOutcome =
  | { kind: 'no-remote' }
  | { kind: 'equal'; remote: RemoteMeta }
  | { kind: 'linear-lead'; remote: RemoteMeta }
  | { kind: 'offline'; reason: string };

/** Read remote canonical metadata and classify state. v0.7 has no
 *  `diverged` branch — Yjs converges deterministically, so any remote
 *  that's ahead is just "linear-lead"; the local doc applies it and
 *  any local-only changes survive via CRDT merge.
 *
 *  `silent: true` skips the topbar phase mutation (used by passive
 *  periodic / online-restoration probes). */
export async function runBootProbe(
  options: { silent?: boolean } = {},
): Promise<BootProbeOutcome> {
  const silent = options.silent === true;
  if (!isDriveConnected()) {
    return { kind: 'offline', reason: 'NOT_CONNECTED' };
  }
  if (!silent) {
    syncStore.setPhase({ kind: 'syncing', reason: 'probe' });
  }

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
      if (!remote) return { kind: 'no-remote' };
      const lastPulled = getLastPulledSnapshotId();
      if (remote.snapshotId === lastPulled) {
        return { kind: 'equal', remote };
      }
      return { kind: 'linear-lead', remote };
    } catch (err) {
      const msg = (err as Error).message ?? 'PROBE_FAILED';
      return { kind: 'offline', reason: msg };
    }
  })();

  const outcome = await Promise.race([probe, hardTimer]);
  if (!silent) {
    if (timedOut) {
      syncStore.setPhase({ kind: 'offline', message: '同步探测超时' });
    } else {
      syncStore.setPhase({ kind: 'idle' });
    }
  }
  return outcome;
}

export const PROBE_TIMEOUTS = {
  soft: PROBE_SOFT_TIMEOUT_MS,
  hard: PROBE_HARD_TIMEOUT_MS,
};

/** Apply remote `.dryj` bytes to the local Y.Doc and update sync
 *  cursors. No reload — the Y.Doc observer rebuilds zustand state
 *  in place. Used by the boot gate's "linear lead, accept pull" path
 *  and by the runtime visibility/online probes' auto-pull. */
export async function applyRemoteDryj(remote: RemoteMeta): Promise<void> {
  await runPullFromRemote(remote);
}

/** "First device joining an existing Drive canonical" pull. Replaces
 *  local Y.Doc state with the remote bytes (clears top-level maps
 *  first) instead of CRDT-merging. Used by ConnectDrivePanel when
 *  lastPulledSnapshotId is null — the local state at that moment is
 *  almost certainly v0.7 sample seeds, NOT user data the user wants
 *  to preserve. CRDT-merging samples with cloud data and pushing the
 *  union pollutes Drive for every other device. */
export async function replaceLocalFromRemote(remote: RemoteMeta): Promise<void> {
  // Replace semantics: any pending debounced push referenced the
  // pre-replace state. Cancel it so we don't waste a Drive history
  // slot uploading the just-pulled state under a fresh snapshotId
  // 60s later.
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (inFlightPush) {
    try {
      await inFlightPush;
    } catch {
      /* push errored; we still want to replace */
    }
  }
  if (inFlightPull) return inFlightPull;
  inFlightPull = (async () => {
    syncStore.setPhase({ kind: 'syncing', reason: 'pull' });
    try {
      const bytes = await downloadDryjById(remote.fileId);
      replaceFromRemote(bytes);
      setLastPulledSnapshotId(remote.snapshotId);
      // Replace semantics: local is now exactly remote, nothing
      // unsynced. Clear the samples-only flag too — local now
      // mirrors a real Drive canonical, not a v0.7 sample seed.
      clearDirtyCount();
      syncStore.setDirtyCount(0);
      clearLocalIsSamplesOnly();
      const info = { at: Date.now(), label: getDeviceLabel() };
      setLastSyncInfo(info);
      syncStore.setLastSync(info);
      syncStore.setPhase({ kind: 'idle' });
    } catch (err) {
      console.warn('[sync] replace-from-remote failed:', err);
      syncStore.setPhase({
        kind: 'error',
        message: (err as Error).message ?? '替换本地失败',
      });
      throw err;
    } finally {
      inFlightPull = null;
    }
  })();
  return inFlightPull;
}

/** For the import flow: download remote `.dryj` bytes raw. */
export async function fetchRemoteDryj(remote: RemoteMeta): Promise<Uint8Array> {
  return downloadDryjById(remote.fileId);
}

function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
