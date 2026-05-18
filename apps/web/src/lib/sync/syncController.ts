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
//   1. caller (subscription / manual button / pagehide / Tauri
//      window blur) calls requestPush().
//   2. controller debounces PUSH_DEBOUNCE_MS (8s · ERD §7.8 P4 ·
//      down from v0.7's 60s); first event after a quiet window
//      goes through immediately, follow-ups within the window are
//      collapsed.
//   3. encodes Y.Doc → .dryj → uploads as application/octet-stream.
//
// Pull path:
//   1. boot gate calls runBootProbe(); on linear-lead it downloads the
//      remote `.dryj` and applyRemoteUpdate'd in-memory. The Y.Doc
//      observer re-derives flat state and zustand setState fires —
//      no page reload needed.

import * as Y from 'yjs';
import {
  useStore,
  exportYDocAsUpdate,
  applyRemoteUpdate,
  replaceFromRemote,
  getYDoc,
  classify,
  REMOTE_ORIGIN,
  OPFS_ORIGIN,
} from '@dayrail/core';
import { decodeDryj, encodeDryj, type DryjMeta } from '@dayrail/db/dryj';
import {
  appendSyncAttempt,
  bumpDirtyCount,
  clearDirtyCount,
  clearLocalIsSamplesOnly,
  getDeviceId,
  getDeviceLabel,
  getDirtyCount,
  getLastPulledSnapshotId,
  getLastPushedCounts,
  isLocalSamplesOnly,
  isSyncProbeSuppressed,
  setDismissPendingPileUntil,
  setLastPulledSnapshotId,
  setLastPushedCounts,
  setLastSuccessAt,
  setLastSyncInfo,
} from './identity';
import { checkAccountIdentity, recordFirstConnect } from './identityPin';
import {
  downloadDryjById,
  getRemoteMeta,
  uploadDryj,
  type RemoteMeta,
} from './driveBackend';
import { isDriveConnected } from './driveAuth';
import { syncStore } from './syncStore';
import {
  loadLastPulledDocBytes,
  saveLastPulledDocBytes,
} from './lastPulledDoc';
import { isTauriRuntime } from '../versionUpdateContext';

// 8s · ERD §7.8 P4 trigger tightening (was 60s in v0.7). Short
// enough to feel responsive cross-device, long enough to coalesce
// typing bursts. Desktop OAuth makes Drive API calls cheap; free-
// tier quota is well within reach at this cadence.
const PUSH_DEBOUNCE_MS = 8 * 1000;

/** Map an error to a coarse code for the failure-history log
 *  (ERD §7.10.5 · v0.12 P2). The full message is preserved in
 *  `errorBody`; this code drives the SideNav tooltip's one-line
 *  summary ("最后一次错误: 401 / network / ..."). */
function classifySyncError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/NEEDS_RECONNECT/i.test(msg)) return 'auth';
  if (/\b401\b|unauthor/i.test(msg)) return '401';
  if (/\b403\b|forbidden/i.test(msg)) return '403';
  if (/\b5\d\d\b|server error/i.test(msg)) return '5xx';
  if (/network|fetch|offline|Failed to fetch/i.test(msg)) return 'network';
  if (/timeout/i.test(msg)) return 'timeout';
  return 'unknown';
}

/** Decode dryj-wrapped bytes into a fresh Y.Doc (no aliasing with
 *  the live local Y.Doc). Used by smart-diff classify to compare
 *  base / remote against the live local doc. */
function bytesToYDoc(dryjBytes: Uint8Array): Y.Doc {
  const decoded = decodeDryj(dryjBytes);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decoded.update);
  return doc;
}

// Sanity-check thresholds for the pre-push data-loss gate (added
// 2026-05-08 after v0.9.0→v0.9.1 incident). Triggered when the
// current local state is suspiciously emptier than what we last
// pushed — Tauri's auto-update wiped WKWebView OPFS, the empty seed
// looked normal to runPush, and Drive got overwritten with samples.
//
// "Suspicious" is conservative — would rather false-positive once
// (user clicks confirm to proceed) than miss a real data-loss path.
function computeLocalCounts(): {
  templates: number;
  tasks: number;
  lines: number;
  reflections: number;
} {
  const s = useStore.getState();
  return {
    templates: Object.keys(s.templates).length,
    tasks: Object.keys(s.tasks).length,
    lines: Object.keys(s.lines).length,
    reflections: Object.keys(s.reflections).length,
  };
}

/** "Local Y.Doc has nothing the user authored." Used by the boot
 *  probe sanity check (ERD §7.9) — the auto-created Inbox line is
 *  ignored so a fresh hydrate isn't mistaken for a wipe. */
function localLooksEmpty(): boolean {
  const c = computeLocalCounts();
  if (c.tasks > 0) return false;
  if (c.templates > 0) return false;
  if (c.reflections > 0) return false;
  // ensureInbox creates 1 default line at boot; >1 means the user
  // (or a prior pull) added something.
  if (c.lines > 1) return false;
  return true;
}

function buildSanityWarning(
  prev: ReturnType<typeof computeLocalCounts>,
  curr: ReturnType<typeof computeLocalCounts>,
  prevAt: string,
): string | null {
  // Build per-field "before → after" deltas for fields that lost
  // material content. Material = (previous > 0 AND current is < half
  // of previous AND drop is > 5 absolute) OR (previous > 0 AND
  // current is 0). The first rule catches "user deleted lots of
  // tasks intentionally" too — that's still worth a confirm given
  // it's about to overwrite Drive.
  const issues: string[] = [];
  const check = (label: string, before: number, after: number) => {
    if (before === 0) return;
    if (after === 0) {
      issues.push(`${label}: ${before} → 0`);
    } else if (after < before / 2 && before - after > 5) {
      issues.push(`${label}: ${before} → ${after}`);
    }
  };
  check('模板', prev.templates, curr.templates);
  check('任务', prev.tasks, curr.tasks);
  check('反思', prev.reflections, curr.reflections);
  // Lines: -1 from "Inbox is auto-created on every fresh boot" so
  // decreasing by exactly 1 isn't suspicious. Skip the strict check.
  if (prev.lines > 5 && curr.lines < prev.lines / 2 && prev.lines - curr.lines > 5) {
    issues.push(`列表 (Lines): ${prev.lines} → ${curr.lines}`);
  }
  if (issues.length === 0) return null;
  return [
    '⚠️ 本地比上次推送少了很多内容：',
    '',
    ...issues.map((s) => `  · ${s}`),
    '',
    `（上次推送：${new Date(prevAt).toLocaleString('zh-CN')}）`,
    '',
    '继续推送会用当前本地覆盖云端。如果是升级 / 重装 / 异常重启后看到这个，',
    '建议取消，先在 Settings → 同步 →「从快照导入」恢复一份 .dryj 备份再推。',
    '',
    '继续推送？取消会保留本地，不动云端。',
  ].join('\n');
}

const PROBE_SOFT_TIMEOUT_MS = 1500;
const PROBE_HARD_TIMEOUT_MS = 3500;
const RECOVERY_KICK_DELAY_MS = 1500;
const RETRY_BACKOFF_MS = 5 * 60 * 1000;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let unsubStore: (() => void) | null = null;
let tauriFocusUnlisten: (() => void) | null = null;
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
    // SAFETY GATE (added 2026-05-08 after v0.9.0 → v0.9.1 data-loss
    // incident): when local is the disposable seed (v0.7 first-run
    // samples, or in v0.9 a re-seed because Tauri's auto-update path
    // wiped WKWebView OPFS while replacing the .app), DO NOT push to
    // Drive. Pushing the seed overwrites the user's real cloud data.
    // The flag is cleared by authoritative paths only:
    //   - BootGate → replaceLocalFromRemote / applyRemoteDryj on a
    //     successful pull (local now mirrors remote)
    //   - BootGate → no-remote / equal branch (Drive has nothing to
    //     lose, or local already matches)
    //   - importLocalData (user brought in real data via .dryj)
    //   - runForcePush success (user explicitly asked to overwrite)
    //   - ConnectDrivePanel paths in Settings (explicit user action)
    // Sessions still tick so EditSessionIndicator stays accurate; we
    // only suppress the dirty bump + push schedule.
    const samplesOnly = isLocalSamplesOnly();
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
    if (samplesOnly) return;
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
    // ERD §7.8 P4 · Tauri window blur as a natural push trigger.
    // "User switched to another app = natural commit point" — and
    // the desktop runtime gives us a clean signal the PWA doesn't.
    void registerTauriBlurListener();
  }

  if (isDriveConnected() && !isSyncProbeSuppressed() && getDirtyCount() > 0) {
    setTimeout(() => {
      if (!isDriveConnected() || isSyncProbeSuppressed() || getDirtyCount() === 0) return;
      void runPush({ trigger: 'recovery' }).catch((err) => {
        console.warn('[sync] recovery push failed:', err);
      });
    }, RECOVERY_KICK_DELAY_MS);
  }
}

function schedulePush(): void {
  if (!isDriveConnected()) return;
  // Honor the user's "continue local" decision from BootGate's
  // OfflinePanel for the duration of this session — pushes would
  // otherwise re-trigger silent token refresh and surface another
  // Google popup. (See identity.ts isSyncProbeSuppressed.)
  if (isSyncProbeSuppressed()) return;
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
    if (getDirtyCount() > 0 && isDriveConnected() && !isSyncProbeSuppressed()) {
      void runPush({ trigger: 'visibilitychange' }).catch((err) => {
        console.warn('[sync] visibilitychange push failed:', err);
      });
    }
  }
}

function onPageHide(): void {
  if (getDirtyCount() > 0 && isDriveConnected() && !isSyncProbeSuppressed()) {
    void runPush({ trigger: 'pagehide' }).catch(() => {
      /* leaving anyway */
    });
  }
}

function onBeforeUnload(): void {
  if (getDirtyCount() === 0 || !isDriveConnected()) return;
  if (isSyncProbeSuppressed()) return;
  void runPush({ trigger: 'beforeunload', keepalive: true }).catch(() => {
    /* ignore */
  });
}

// Tauri-only: register a window focus listener so the desktop app
// fires a push when the user switches away (the equivalent of
// pagehide for the desktop runtime). Registration is async because
// Tauri's `onFocusChanged` returns an unlisten Promise. PWA users
// already have `visibilitychange` as their analog; Tauri windows
// don't fire `visibilitychange` on focus-out (the WKWebView stays
// "visible") so we need this separate hook.
async function registerTauriBlurListener(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const unlisten = await getCurrentWindow().onFocusChanged((event) => {
      const focused = Boolean(event.payload);
      if (focused) return;
      if (
        getDirtyCount() > 0 &&
        isDriveConnected() &&
        !isSyncProbeSuppressed()
      ) {
        void runPush({ trigger: 'tauri-blur' }).catch((err) => {
          console.warn('[sync] tauri-blur push failed:', err);
        });
      }
    });
    tauriFocusUnlisten = unlisten;
  } catch (err) {
    console.warn('[sync] failed to register tauri focus listener:', err);
  }
}

interface RunPushOpts {
  trigger:
    | 'manual'
    | 'debounced'
    | 'visibilitychange'
    | 'pagehide'
    | 'beforeunload'
    | 'recovery'
    | 'retry'
    | 'tauri-blur';
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

/** Verify the connected account's identity against the stored pin
 *  (ERD §7.10.2 · v0.12 P1). Called by BootGate + Settings → 同步 →
 *  连接 Drive after a successful `connectDrive()`.
 *
 *  Outcomes:
 *    - 'first-connect' / 'match': pin written or already aligned ·
 *      no UI · sync proceeds normally.
 *    - 'mismatch': sets `pendingIdentityMismatch` on syncStore so the
 *      IdentityMismatchModal mounts · caller can return / suppress
 *      follow-up sync triggers.
 *    - 'failed': /about call errored · transient · caller continues ·
 *      next push will retry via the inline check inside runPush.
 *
 *  This function does not throw; failure modes are reflected in
 *  syncStore state. */
export async function verifyIdentityAfterConnect(): Promise<void> {
  const result = await checkAccountIdentity();
  if (result.kind === 'mismatch') {
    syncStore.setPendingIdentityMismatch({
      stored: result.stored,
      current: result.current,
      detectedAt: Date.now(),
      source: 'connect',
    });
    return;
  }
  if (result.kind === 'first-connect') {
    recordFirstConnect(result.currentEmail, null);
    return;
  }
  // 'match' → nothing to do.
  // 'failed' → fail-open · next push's inline check will retry.
}

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
  // Pre-force-push auto-backup. The user is about to overwrite the
  // Drive canonical with whatever this device has — best-effort
  // capture the current local state to a backup file first so they
  // can roll back if the force-push outcome is surprising. Outside
  // the inFlightPush IIFE so a backup failure doesn't taint the
  // promise, but awaited so the timing is "backup THEN upload" not
  // a race.
  try {
    const { autoBackup } = await import('./backupController');
    await autoBackup('pre-force-push');
  } catch {
    /* swallow */
  }
  inFlightPush = (async () => {
    try {
      // runForcePush intentionally bypasses the runPush sanity gate —
      // the user explicitly asked to overwrite Drive (e.g. after
      // importing a .dryj that they verified). Track the new counts
      // as the baseline going forward so the next regular runPush has
      // an accurate compare.
      const currCounts = computeLocalCounts();
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
      setLastPushedCounts(currCounts);
      // ERD §7.8 P3 · force-push makes local the new canonical; the
      // next classify must use these bytes as the base.
      await saveLastPulledDocBytes(bytes).catch((e) =>
        console.warn('[sync] saveLastPulledDocBytes failed:', e),
      );
      clearDirtyCount();
      syncStore.setDirtyCount(0);
      clearLocalIsSamplesOnly();
      const info = { at: Date.now(), label: getDeviceLabel() };
      setLastSyncInfo(info);
      syncStore.setLastSync(info);
      // ERD §7.10.5 · v0.12 P2 · record force-push success same as
      // regular push (it's still a successful upload).
      const nowIso = new Date().toISOString();
      setLastSuccessAt('push', nowIso);
      appendSyncAttempt({
        at: nowIso,
        direction: 'push',
        result: 'ok',
      });
      setDismissPendingPileUntil(null);
      syncStore.setPhase({ kind: 'idle' });
    } catch (err) {
      console.warn('[sync] force-push failed:', err);
      // ERD §7.10.5 · v0.12 P2 · record fail.
      appendSyncAttempt({
        at: new Date().toISOString(),
        direction: 'push',
        result: 'fail',
        errorCode: classifySyncError(err),
        errorBody: ((err as Error).message ?? String(err)).slice(0, 500),
      });
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
      // ERD §7.8 P3 · the bytes we just merged in become the new
      // base for the next classify. Best-effort: persistence error
      // doesn't block the pull (next push falls back to v0.7 CRDT
      // merge until base is re-seeded).
      await saveLastPulledDocBytes(bytes).catch((e) =>
        console.warn('[sync] saveLastPulledDocBytes failed:', e),
      );
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
      // ERD §7.10.5 · v0.12 P2 · record successful pull.
      const nowIso = new Date().toISOString();
      setLastSuccessAt('pull', nowIso);
      appendSyncAttempt({
        at: nowIso,
        direction: 'pull',
        result: 'ok',
      });
      syncStore.setPhase({ kind: 'idle' });
      // If there's local-only work the pull just merged with, nudge
      // a push so it propagates to Drive without waiting for the next
      // user write. schedulePush respects the 60s debounce.
      if (getDirtyCount() > 0 && isDriveConnected()) {
        schedulePush();
      }
    } catch (err) {
      console.warn('[sync] pull failed:', err);
      // ERD §7.10.5 · v0.12 P2 · record fail attempt for the
      // duration-aware surface.
      appendSyncAttempt({
        at: new Date().toISOString(),
        direction: 'pull',
        result: 'fail',
        errorCode: classifySyncError(err),
        errorBody: ((err as Error).message ?? String(err)).slice(0, 500),
      });
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
      // PUSH FIREWALL (ERD §7.8 P1 · 2026-05-11).
      //
      // Before encoding any upload, confirm the remote state via a
      // HEAD-style metadata read. The firewall is FAIL-CLOSED: if we
      // cannot read remote, we do not upload — that's exactly the
      // v0.9.0→v0.9.1 incident pattern (push uploads local state
      // without knowing what's already on Drive, overwrites canonical).
      //
      // Three guards run before the upload, in order:
      //   (1) getRemoteMeta() must succeed. Throwing → block + retry.
      //   (2) If `isLocalSamplesOnly()` AND remote has canonical
      //       diverging from our lastPulled → block. This covers
      //       paths that bypass schedulePush's samples-only gate
      //       (recovery / retry / manual paths called directly).
      //   (3) If remote moved past lastPulled → pull-and-merge into
      //       local (CRDT merge for now · ERD §7.8 P3 replaces with
      //       smart diff). If the merge download fails → block.
      //
      // The HEAD-check + merge does NOT close the race between the
      // metadata read and the actual upload — Drive REST has no
      // ifMatch precondition on multipart upload. A B-push landing
      // in that ~100ms window still overwrites. ERD §7.8 P3 adds
      // post-upload verification + smart-diff recovery; P1's job is
      // to plug the much larger "we never read remote at all" hole.
      //
      // Skip the firewall for keepalive (pagehide budget) — pagehide
      // can't await metadata, and the next active push from this
      // device will repair lineage via the firewall path.
      if (!opts.keepalive) {
        // IDENTITY PIN CHECK (ERD §7.10.2 · v0.12 P1).
        //
        // Block push if a mismatch is already pending — the modal is
        // surfaced, user hasn't resolved yet, don't paper over by
        // pushing on top of unresolved identity state.
        if (syncStore.getSnapshot().pendingIdentityMismatch !== null) {
          syncStore.setPhase(phaseBefore);
          return;
        }
        // Defense-in-depth re-verify before each push. The primary
        // hook fires at connect / reconnect time; this catches paths
        // where a long-lived session sees its OAuth identity change
        // underneath (rare but real — e.g. user revoked DayRail on
        // another tab, re-authed, picked a different account). Soft
        // 'failed' (network / /about flake) is fail-open: a flaky
        // diagnostics call shouldn't block push availability.
        const identityResult = await checkAccountIdentity();
        if (identityResult.kind === 'mismatch') {
          syncStore.setPendingIdentityMismatch({
            stored: identityResult.stored,
            current: identityResult.current,
            detectedAt: Date.now(),
            source: 'push',
          });
          syncStore.setPhase(phaseBefore);
          return;
        }
        if (identityResult.kind === 'first-connect') {
          // Race: push fired before connect's pin-write hook landed.
          // Capture the pin now so the next push has the match path.
          recordFirstConnect(identityResult.currentEmail, null);
        }

        let remoteBefore: RemoteMeta | null;
        try {
          remoteBefore = await getRemoteMeta();
        } catch (headErr) {
          console.warn(
            '[sync] push firewall · HEAD check failed · blocking push:',
            headErr,
          );
          syncStore.setPhase(phaseBefore);
          // Schedule a retry like other transient errors do below.
          // Dirty count is left untouched so the retry can re-attempt
          // the same set of ops.
          if (
            opts.trigger !== 'manual' &&
            opts.trigger !== 'retry' &&
            isDriveConnected()
          ) {
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              retryTimer = null;
              if (!isDriveConnected() || getDirtyCount() === 0) return;
              void runPush({ trigger: 'retry' }).catch(() => {});
            }, RETRY_BACKOFF_MS);
          }
          return;
        }

        const lastPulled = getLastPulledSnapshotId();
        if (
          isLocalSamplesOnly() &&
          remoteBefore &&
          remoteBefore.snapshotId &&
          remoteBefore.snapshotId !== lastPulled
        ) {
          // Defense-in-depth: samples-only state + remote canonical
          // already exists is exactly the v0.9.0→v0.9.1 shape. Refuse
          // to push regardless of trigger source. BootGate / the
          // ConnectDrivePanel pull path is responsible for resolving
          // this state (replace local from remote, which clears the
          // flag).
          console.warn(
            '[sync] push firewall · samples-only state + remote canonical exists · blocking push (v0.9.0→v0.9.1 guard)',
          );
          syncStore.setPhase(phaseBefore);
          return;
        }

        if (
          remoteBefore &&
          remoteBefore.snapshotId &&
          remoteBefore.snapshotId !== lastPulled
        ) {
          // Download the remote bytes; on failure we fail-closed.
          let remoteBytes: Uint8Array;
          try {
            remoteBytes = await downloadDryjById(remoteBefore.fileId);
          } catch (downloadErr) {
            console.warn(
              '[sync] push firewall · remote download failed · blocking push:',
              downloadErr,
            );
            syncStore.setPhase(phaseBefore);
            return;
          }

          // SMART DIFF DISPATCH (ERD §7.8 P3 · 2026-05-11).
          //
          // Replace v0.7's blanket `applyRemoteUpdate(remoteBytes)`
          // with classify-based routing. classify needs a baseDoc
          // (the state both sides agreed on at last sync) — that
          // comes from `lastPulledDoc` OPFS file (P3 storage). When
          // base is missing (first run after upgrade, or after a
          // resetLocalData), fall back to v0.7 CRDT merge and seed
          // the base for next time.
          const baseBytes = await loadLastPulledDocBytes().catch(() => null);
          let routed = false;
          if (baseBytes !== null) {
            try {
              const baseDoc = bytesToYDoc(baseBytes);
              const remoteDoc = bytesToYDoc(remoteBytes);
              const cls = classify(baseDoc, getYDoc(), remoteDoc);
              if (cls.type === 'same-direction') {
                // Remote already contains everything local has.
                // Adopt remote wholesale — no push needed.
                replaceFromRemote(remoteBytes);
                setLastPulledSnapshotId(remoteBefore.snapshotId);
                await saveLastPulledDocBytes(remoteBytes).catch((e) =>
                  console.warn('[sync] saveLastPulledDocBytes failed:', e),
                );
                clearDirtyCount();
                syncStore.setDirtyCount(0);
                clearLocalIsSamplesOnly();
                const info = { at: Date.now(), label: getDeviceLabel() };
                setLastSyncInfo(info);
                syncStore.setLastSync(info);
                syncStore.setPhase({ kind: 'idle' });
                return;
              }
              if (cls.type === 'true-conflict') {
                // Hand off to SyncConflictPanel. Push is paused until
                // the user resolves; resolver calls runPush again
                // after applying the chosen values.
                syncStore.setPendingConflict({
                  conflicts: cls.conflicts,
                  remoteBytes,
                  remoteSnapshotId: remoteBefore.snapshotId,
                  detectedAt: Date.now(),
                });
                syncStore.setPhase(phaseBefore);
                return;
              }
              // 'orthogonal' · CRDT merge gives the correct result
              // (no conflicting fields to silently LWW-pick). Fall
              // through to the existing merge path.
              applyRemoteUpdate(remoteBytes);
              setLastPulledSnapshotId(remoteBefore.snapshotId);
              await saveLastPulledDocBytes(remoteBytes).catch((e) =>
                console.warn('[sync] saveLastPulledDocBytes failed:', e),
              );
              routed = true;
            } catch (classifyErr) {
              console.warn(
                '[sync] classify failed · falling back to CRDT merge:',
                classifyErr,
              );
            }
          }
          if (!routed) {
            // Fallback path: no base yet (first sync after P3
            // upgrade · or reset) OR classify threw. v0.7 behavior:
            // CRDT merge and seed the base file so next time uses
            // smart diff.
            try {
              applyRemoteUpdate(remoteBytes);
              setLastPulledSnapshotId(remoteBefore.snapshotId);
              await saveLastPulledDocBytes(remoteBytes).catch((e) =>
                console.warn('[sync] saveLastPulledDocBytes failed:', e),
              );
            } catch (mergeErr) {
              console.warn(
                '[sync] push firewall · CRDT merge of remote canonical failed · blocking push:',
                mergeErr,
              );
              syncStore.setPhase(phaseBefore);
              return;
            }
          }
        }
      }

      // Pre-push sanity gate (added 2026-05-08). Compare current
      // entity counts to what we last pushed; if the local state is
      // suspiciously emptier (templates went from N to 0, tasks
      // halved, etc.), prompt before overwriting Drive. Skip on
      // 'keepalive' (pagehide budget — no time to await user input)
      // and on 'manual' if needed; we let manual through too because
      // the user explicitly asked for the push.
      const currCounts = computeLocalCounts();
      const lastPushed = getLastPushedCounts();
      if (lastPushed && !opts.keepalive) {
        const warning = buildSanityWarning(
          {
            templates: lastPushed.templates,
            tasks: lastPushed.tasks,
            lines: lastPushed.lines,
            reflections: lastPushed.reflections,
          },
          currCounts,
          lastPushed.at,
        );
        if (warning && typeof window !== 'undefined') {
          const proceed = window.confirm(warning);
          if (!proceed) {
            syncStore.setPhase(phaseBefore);
            return;
          }
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
      setLastPushedCounts(currCounts);
      // ERD §7.8 P3 · save the bytes we just pushed as the new
      // base. Next sync's smart-diff classify compares against this.
      await saveLastPulledDocBytes(bytes).catch((e) =>
        console.warn('[sync] saveLastPulledDocBytes failed:', e),
      );
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
      // ERD §7.10.5 · v0.12 P2 · record successful push for the
      // duration-aware surface. Skip keepalive: it's fire-and-forget
      // (we don't actually know if Drive received it) so recording
      // it could lie about success.
      if (!opts.keepalive) {
        const nowIso = new Date().toISOString();
        setLastSuccessAt('push', nowIso);
        appendSyncAttempt({
          at: nowIso,
          direction: 'push',
          result: 'ok',
        });
        // A successful push by definition clears the pending pile;
        // drop the dismiss so the banner can fire again if the pile
        // grows back.
        setDismissPendingPileUntil(null);
      }
      syncStore.setPhase({ kind: 'idle' });
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.warn('[sync] push failed:', err);
      // ERD §7.10.5 · v0.12 P2 · record fail attempt for the
      // failure-history log + tooltip summary. Same keepalive skip
      // rationale as on success.
      if (!opts.keepalive) {
        appendSyncAttempt({
          at: new Date().toISOString(),
          direction: 'push',
          result: 'fail',
          errorCode: classifySyncError(err),
          errorBody: msg.slice(0, 500),
        });
      }
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
        // ERD §7.9 sanity check (defense net): the lineage cursor
        // says we're in sync, but if local has nothing while
        // lastPulled is non-null, something wiped local out from
        // under us (legacy localStorage drift before the §7.9
        // migration ran, OS-level OPFS eviction, manual wipe via
        // DevTools). Force a pull instead of trusting the cursor.
        // After the §7.9 architectural fix this branch is rarely
        // hit because lastPulled lives in the same store as the
        // Y.Doc — both vanish together — but it stays as
        // belt-and-suspenders.
        if (lastPulled !== null && localLooksEmpty()) {
          console.warn(
            '[sync] boot probe: lastPulled matches remote but local is empty — forcing pull (ERD §7.9 sanity)',
          );
          return { kind: 'linear-lead', remote };
        }
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
      // ERD §7.8 P3 · seed lastPulledDoc so future syncs use smart
      // diff. After replace-from-remote, local is byte-identical to
      // remote, making remote bytes the correct base.
      await saveLastPulledDocBytes(bytes).catch((e) =>
        console.warn('[sync] saveLastPulledDocBytes failed:', e),
      );
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
