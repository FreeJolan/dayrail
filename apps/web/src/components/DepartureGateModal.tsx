// Departure gate modal (ERD §7.10.3 · v0.12 P6).
//
// Mounts when `syncStore.showDepartureGate === true`. Opened by the
// "安全退出" affordance in Settings → 同步. The user-facing promise:
// before you close DayRail, this modal makes sure your recent edits
// are on Drive — or tells you exactly what didn't make it.
//
// Four states:
//
//   - 'checking'  : transient · pending == 0 means we're already
//                   caught up · jumps straight to 'done'
//   - 'syncing'   : push in flight · progress hint
//   - 'done'      : ✓ "你的改动都已经传上去 · 现在可以关了"
//   - 'failed'    : ⚠ "N 个改动没传上去 · 网络好像有点问题" with
//                   [再试一次] / [先这样，下次开机继续传]
//
// "先这样" writes a `pendingDeparture` marker to SyncMeta. The next
// launch's ReconcileBanner surfaces it before the user does any
// more editing.
//
// Note: this is a v0.12 P6 first version. The Tauri close-event
// interceptor (block CloseRequested → run gate → allow close) is
// deferred · the "安全退出" button gives users the explicit gate
// affordance without touching Rust. Browser tab-close / window-X
// still goes through the existing pagehide keepalive path. See PR
// description for the deferred follow-up.

import { useEffect, useState } from 'react';
import { syncStore, useSyncStatus } from '@/lib/sync/syncStore';
import {
  getDirtyCount,
  setPendingDeparture,
} from '@/lib/sync/identity';
import { runManualSync } from '@/lib/sync/syncController';

type GateState = 'checking' | 'syncing' | 'done' | 'failed';

export function DepartureGateModal() {
  const { showDepartureGate } = useSyncStatus();
  if (!showDepartureGate) return null;
  return <Panel />;
}

function Panel() {
  const [state, setState] = useState<GateState>('checking');
  const [pendingAtStart, setPendingAtStart] = useState(0);

  useEffect(() => {
    const initial = getDirtyCount();
    setPendingAtStart(initial);
    if (initial === 0) {
      setState('done');
      return;
    }
    setState('syncing');
    void (async () => {
      try {
        const outcome = await runManualSync();
        if (outcome.kind === 'offline') {
          setState('failed');
          return;
        }
        // 'pushed' / 'pulled' / 'noop' all mean we're caught up to
        // remote · safe to leave.
        setState('done');
      } catch {
        setState('failed');
      }
    })();
  }, []);

  const onClose = () => {
    syncStore.setShowDepartureGate(false);
  };

  const onRetry = async () => {
    setState('syncing');
    try {
      const outcome = await runManualSync();
      setState(outcome.kind === 'offline' ? 'failed' : 'done');
    } catch {
      setState('failed');
    }
  };

  const onLeaveAnyway = () => {
    setPendingDeparture({
      count: getDirtyCount(),
      at: new Date().toISOString(),
    });
    syncStore.setShowDepartureGate(false);
  };

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[230] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-md bg-surface-0 shadow-xl">
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              安全退出
            </span>
            <p className="text-base text-ink-primary">{copyHeadline(state)}</p>
            <p className="text-xs leading-relaxed text-ink-secondary">
              {copyBody(state, pendingAtStart, getDirtyCount())}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {state === 'failed' ? (
              <>
                <button
                  type="button"
                  onClick={() => void onRetry()}
                  className="rounded-md bg-cta px-3 py-2 text-sm font-medium text-cta-ink transition hover:bg-cta-hover"
                >
                  再试一次
                </button>
                <button
                  type="button"
                  onClick={onLeaveAnyway}
                  className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-primary transition hover:bg-surface-3"
                >
                  先这样，下次开机继续传
                </button>
              </>
            ) : null}
            {state === 'done' ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-cta px-3 py-2 text-sm font-medium text-cta-ink transition hover:bg-cta-hover"
              >
                好，可以关了
              </button>
            ) : null}
            {state === 'checking' || state === 'syncing' ? (
              <button
                type="button"
                disabled
                className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-tertiary"
              >
                {state === 'syncing' ? '正在上传…' : '正在检查…'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function copyHeadline(state: GateState): string {
  switch (state) {
    case 'checking':
      return '正在检查你最近的改动…';
    case 'syncing':
      return '正在把你最近的改动传上去…';
    case 'done':
      return '✓ 都好了';
    case 'failed':
      return '有改动没传上去';
  }
}

function copyBody(
  state: GateState,
  startCount: number,
  currentCount: number,
): string {
  switch (state) {
    case 'checking':
      return '一秒钟。';
    case 'syncing':
      return `${startCount} 个改动正在上传 · 别急着关窗口。`;
    case 'done':
      return startCount === 0
        ? '你最近没改东西 · 现在可以关掉了。'
        : '你的改动都已经传上去 · 现在可以关掉这个窗口了。';
    case 'failed':
      return `还有 ${currentCount} 个改动没传上去 · 网络好像有点问题。可以再试一次，或者先离开 · 下次打开 DayRail 时它会提醒你继续传。`;
  }
}
