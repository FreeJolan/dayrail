// Mode regression modal (ERD §7.10.6 · v0.12 P3).
//
// Mounts when `syncStore.pendingModeRegression !== null`. The pin
// remembers we were syncing/backup-ing to a specific Drive account;
// runtime now reads as Local-only. That mismatch is exactly the
// shape of the Q2a class of incidents — software bug clears
// driveConnected, UI silently drops to local, user keeps editing
// without knowing.
//
// Three branches:
//
//   1. "重新连一下 Drive" — standard reconnect (§7.6). On success
//      the pin stays · runtime mode bounces back to where it was.
//
//   2. "先不连了，本地用就好" — explicit downgrade. Clears the pin
//      + resets sync cursors so the next connection walks the
//      first-connect path. UI switches to Local-only mode and stays.
//
//   3. "稍后再说" — defer. Clear the modal · main UI proceeds normally
//      · no write / no sync this session · next launch re-detects.
//
// Per ERD §7.10 UX principles: never claims the situation is the
// user's fault, gives them a clean "I'm not deciding right now"
// escape hatch, and folds technical detail behind a disclosure.

import { useState } from 'react';
import { syncStore, useSyncStatus } from '@/lib/sync/syncStore';
import { connectDrive } from '@/lib/sync/driveAuth';
import {
  clearDirtyCount,
  clearIdentityPin,
  clearLastPulledSnapshotId,
  clearLocalIsSamplesOnly,
} from '@/lib/sync/identity';
import { verifyIdentityAfterConnect } from '@/lib/sync/syncController';

export function ModeRegressionModal() {
  const { pendingModeRegression } = useSyncStatus();
  if (!pendingModeRegression) return null;
  return <Panel key={pendingModeRegression.detectedAt} />;
}

function Panel() {
  const { pendingModeRegression } = useSyncStatus();
  const [busy, setBusy] = useState<'reconnect' | 'downgrade' | 'defer' | null>(
    null,
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  if (!pendingModeRegression) return null;
  const { pinnedAccountEmail, pinnedMode } = pendingModeRegression;

  const onReconnect = async () => {
    setBusy('reconnect');
    setErrMsg(null);
    try {
      await connectDrive();
      syncStore.setConnected(true);
      syncStore.setPendingModeRegression(null);
      // Re-verify identity in case the reconnect picked a different
      // account · IdentityMismatchModal will surface if so.
      void verifyIdentityAfterConnect();
    } catch (e) {
      setErrMsg((e as Error).message ?? String(e));
      setBusy(null);
    }
  };

  const onDowngrade = () => {
    setBusy('downgrade');
    setErrMsg(null);
    try {
      // Explicit downgrade · clear sync cursors so the next time the
      // user reconnects (if ever) walks the first-connect path. The
      // Y.Doc itself is untouched — the local data carries forward.
      clearIdentityPin();
      clearLastPulledSnapshotId();
      clearDirtyCount();
      clearLocalIsSamplesOnly();
      syncStore.setPendingModeRegression(null);
    } catch (e) {
      setErrMsg((e as Error).message ?? String(e));
      setBusy(null);
    }
  };

  const onDefer = () => {
    setBusy('defer');
    setErrMsg(null);
    try {
      // Session-scoped dismiss · doesn't persist · next launch will
      // re-evaluate and re-surface if the regression is still there.
      syncStore.setPendingModeRegression(null);
    } catch (e) {
      setErrMsg((e as Error).message ?? String(e));
      setBusy(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[225] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-md bg-surface-0 shadow-xl">
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {pinnedMode === 'sync' ? '设备同步' : '云端备份'}
            </span>
            <p className="text-base text-ink-primary">
              跟 Drive 的连接好像断了
            </p>
            <p className="text-xs leading-relaxed text-ink-secondary">
              这台设备之前在和{' '}
              <strong className="font-mono text-ink-primary">
                {pinnedAccountEmail}
              </strong>{' '}
              {pinnedMode === 'sync' ? '同步' : '备份'}，现在看起来连接掉了。
              你的本地数据完好，可以随时继续用。
            </p>
          </div>

          {errMsg ? <p className="text-xs text-warn">{errMsg}</p> : null}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onReconnect}
              disabled={busy !== null}
              className="rounded-md bg-cta px-3 py-2 text-sm font-medium text-cta-ink transition hover:bg-cta-hover disabled:opacity-50"
            >
              {busy === 'reconnect' ? '正在重新连接…' : '重新连一下 Drive'}
            </button>
            <button
              type="button"
              onClick={onDowngrade}
              disabled={busy !== null}
              className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-primary transition hover:bg-surface-3 disabled:opacity-50"
            >
              {busy === 'downgrade' ? '正在切换…' : '先不连了，本地用就好'}
            </button>
            <button
              type="button"
              onClick={onDefer}
              disabled={busy !== null}
              className="rounded-md px-3 py-2 text-sm text-ink-secondary transition hover:text-ink-primary disabled:opacity-50"
            >
              稍后再说 · 下次启动再问
            </button>
          </div>

          <div className="flex flex-col gap-1 border-t border-surface-2 pt-3">
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="self-start text-2xs text-ink-tertiary transition hover:text-ink-secondary"
            >
              {showDetail
                ? '收起说明 ⌃'
                : '为什么会这样？看看 ⌄'}
            </button>
            {showDetail ? (
              <p className="text-2xs leading-relaxed text-ink-tertiary">
                常见原因是 OS 缓存被清 / 软件升级重置了一些设置 / OAuth 凭证过期。
                数据本身没问题。「重新连一下 Drive」最常解。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
