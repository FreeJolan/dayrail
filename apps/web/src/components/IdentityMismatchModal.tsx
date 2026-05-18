// Identity mismatch modal (ERD §7.10.2 · v0.12 P1).
//
// Mounts when `syncStore.pendingIdentityMismatch !== null`, i.e. when
// the identity-pin check detected that the currently-authenticated
// Drive account differs from the pinned one (story 1 / worst case C
// in ERD §7.10).
//
// Three branches, ordered by likely user intent:
//
//   1. "让我重选账号" (most common): user mis-clicked the account
//      picker · disconnect + reconnect with consent prompt so the
//      picker shows again.
//
//   2. "确实要换到这个账号": user intentionally switching · clears
//      the pin, resets sync cursors (lastPulled, samplesOnly) so the
//      next push/pull walks the first-connect path, writes a fresh
//      pin for the new account.
//
//   3. "稍后再说": user wants to think · clears modal state and
//      suppresses sync probes for this session (no push / pull until
//      next launch).
//
// Detail is folded behind "不确定？看看会发生什么 ⌄" — keeps the
// main surface in plain language per the ERD §7.10 copy principles.

import { useState } from 'react';
import { syncStore, useSyncStatus } from '@/lib/sync/syncStore';
import {
  connectDrive,
  disconnectDrive,
} from '@/lib/sync/driveAuth';
import {
  clearDirtyCount,
  clearLastPulledSnapshotId,
  clearLocalIsSamplesOnly,
  setSyncProbeSuppressed,
} from '@/lib/sync/identity';
import { pinNewAccount } from '@/lib/sync/identityPin';
import { verifyIdentityAfterConnect } from '@/lib/sync/syncController';

export function IdentityMismatchModal() {
  const { pendingIdentityMismatch } = useSyncStatus();
  if (!pendingIdentityMismatch) return null;
  return <Panel key={pendingIdentityMismatch.detectedAt} />;
}

function Panel() {
  const { pendingIdentityMismatch } = useSyncStatus();
  const [busy, setBusy] = useState<'repick' | 'switch' | 'defer' | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  if (!pendingIdentityMismatch) return null;
  const { stored, current } = pendingIdentityMismatch;

  const onRepick = async () => {
    setBusy('repick');
    setErrMsg(null);
    try {
      await disconnectDrive();
      syncStore.setPendingIdentityMismatch(null);
      syncStore.setConnected(false);
      await connectDrive();
      syncStore.setConnected(true);
      // After the new consent, run the verify again — if user picked
      // the original account it'll be 'match' · if a different one
      // it'll loop here.
      void verifyIdentityAfterConnect();
    } catch (e) {
      setErrMsg((e as Error).message ?? String(e));
      setBusy(null);
    }
  };

  const onSwitch = () => {
    setBusy('switch');
    setErrMsg(null);
    try {
      // Reset sync cursors so the new account walks the first-connect
      // path (no lastPulled lineage to compare against the new
      // account's Drive). The Y.Doc itself isn't touched here — the
      // user's local data carries over and will be pushed up to the
      // new account on the next push.
      clearLastPulledSnapshotId();
      clearDirtyCount();
      clearLocalIsSamplesOnly();
      // Overwrite the pin with the new account.
      pinNewAccount(current);
      syncStore.setPendingIdentityMismatch(null);
    } catch (e) {
      setErrMsg((e as Error).message ?? String(e));
      setBusy(null);
    }
  };

  const onDefer = () => {
    setBusy('defer');
    setErrMsg(null);
    try {
      // Suspend sync for this session. Modal closes; nothing more
      // happens until next launch (which will re-fire the check).
      setSyncProbeSuppressed();
      syncStore.setPendingIdentityMismatch(null);
    } catch (e) {
      setErrMsg((e as Error).message ?? String(e));
      setBusy(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[220] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-md bg-surface-0 shadow-xl">
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              登录的账号
            </span>
            <p className="text-base text-ink-primary">
              登录的账号不太对吗？
            </p>
            <div className="flex flex-col gap-1 rounded-md bg-surface-1 px-3 py-2 text-xs text-ink-secondary">
              <span>
                之前用的是{' '}
                <strong className="font-mono text-ink-primary">
                  {stored}
                </strong>
              </span>
              <span>
                现在登录的是{' '}
                <strong className="font-mono text-ink-primary">
                  {current}
                </strong>
              </span>
            </div>
          </div>

          {errMsg ? (
            <p className="text-xs text-warn">{errMsg}</p>
          ) : null}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onRepick}
              disabled={busy !== null}
              className="rounded-md bg-cta px-3 py-2 text-sm font-medium text-cta-ink transition hover:bg-cta-hover disabled:opacity-50"
            >
              {busy === 'repick' ? '正在打开账号选择…' : '让我重选账号'}
            </button>
            <button
              type="button"
              onClick={onSwitch}
              disabled={busy !== null}
              className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-primary transition hover:bg-surface-3 disabled:opacity-50"
            >
              {busy === 'switch' ? '正在切换…' : '确实要换到这个账号'}
            </button>
            <button
              type="button"
              onClick={onDefer}
              disabled={busy !== null}
              className="rounded-md px-3 py-2 text-sm text-ink-secondary transition hover:text-ink-primary disabled:opacity-50"
            >
              稍后再说 · 这次先用着
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
                : '不确定？看看会发生什么 ⌄'}
            </button>
            {showDetail ? (
              <p className="text-2xs leading-relaxed text-ink-tertiary">
                之前的备份会留在原账号里 ·
                这台设备从此连到新账号 ·
                两边账号的数据不会自动合并。
                如果只是刚才点错了，「让我重选账号」
                会再让你挑一次。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
