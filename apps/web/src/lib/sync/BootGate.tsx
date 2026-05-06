// Boot gate UI (v0.7) — renders BEFORE the main app routes mount, on
// every cold start. Implements a simplified branch table (ERD §7.7):
//
//   equal          → mount immediately
//   no-remote      → first device on the account; mount immediately,
//                    next user write triggers an upload
//   linear-lead    → CRDT pull (in-memory; merges with any local
//                    changes) → mount. Default behavior is silent;
//                    "ask each time" pops a confirm card.
//   offline        → splash with "重试 / 继续使用本地"; continuing
//                    mounts the app and the top-bar indicator shows
//                    `⚠ 未同步` until a successful round-trip.
//
// v0.7 dropped the diverged conflict card: Yjs's CRDT merge handles
// concurrent edits silently. Linear-lead pulls now apply via
// `Y.applyUpdate` in memory — no page reload, no overwrite of local
// pending writes.

import { useEffect, useState } from 'react';
import {
  clearLocalIsSamplesOnly,
  getBootSyncChoice,
  isLocalSamplesOnly,
  setBootSyncChoice,
  type BootSyncChoice,
} from './identity';
import { connectDrive, isDriveConnected } from './driveAuth';
import {
  isSyncProbeSuppressed,
  setSyncProbeSuppressed,
} from './identity';
import { syncStore } from './syncStore';
import {
  applyRemoteDryj,
  PROBE_TIMEOUTS,
  replaceLocalFromRemote,
  runBootProbe,
  type BootProbeOutcome,
} from './syncController';
import type { RemoteMeta } from './driveBackend';

type Phase =
  | { kind: 'probing'; slow: boolean }
  | { kind: 'linear-confirm'; remote: RemoteMeta }
  | { kind: 'offline'; reason: string }
  | { kind: 'applying' } // pull running
  | { kind: 'done' };

interface Props {
  children: React.ReactNode;
}

export function BootGate({ children }: Props) {
  const [phase, setPhase] = useState<Phase>(() =>
    // Skip auto-probe if (a) Drive isn't connected on this device, or
    // (b) the user dismissed an auto-sync prompt earlier this session.
    // The session suppression is set by OfflinePanel.onContinue below
    // — without it, refreshing or returning to the tab would re-probe
    // and pop the same Google popup again.
    isDriveConnected() && !isSyncProbeSuppressed()
      ? { kind: 'probing', slow: false }
      : { kind: 'done' },
  );

  useEffect(() => {
    if (phase.kind !== 'probing') return;
    let cancelled = false;
    let slowTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (!cancelled)
        setPhase((p) => (p.kind === 'probing' ? { kind: 'probing', slow: true } : p));
    }, PROBE_TIMEOUTS.soft);

    void runBootProbe().then((outcome) => {
      if (cancelled) return;
      if (slowTimer) clearTimeout(slowTimer);
      slowTimer = null;
      handleProbeOutcome(outcome, setPhase);
    });

    return () => {
      cancelled = true;
      if (slowTimer) clearTimeout(slowTimer);
    };
  }, [phase.kind]);

  if (phase.kind === 'done') {
    return <>{children}</>;
  }
  return <BootGateShell phase={phase} setPhase={setPhase} />;
}

function handleProbeOutcome(
  outcome: BootProbeOutcome,
  setPhase: (p: Phase) => void,
): void {
  if (outcome.kind === 'no-remote' || outcome.kind === 'equal') {
    setPhase({ kind: 'done' });
    return;
  }
  if (outcome.kind === 'linear-lead') {
    const choice = getBootSyncChoice();
    if (choice === 'auto-pull') {
      setPhase({ kind: 'applying' });
      void pullAndMount(outcome.remote, setPhase);
      return;
    }
    setPhase({ kind: 'linear-confirm', remote: outcome.remote });
    return;
  }
  // offline
  setPhase({ kind: 'offline', reason: outcome.reason });
}

async function pullAndMount(
  remote: RemoteMeta,
  setPhase: (p: Phase) => void,
): Promise<void> {
  try {
    // Same gate as ConnectDrivePanel: when local is sample-seeded
    // (boot.ts ran seedFromSamples on this cold start because the
    // boot-time peek timed out OR Drive returned null OR Drive
    // wasn't yet connected at boot), replacing wholesale beats
    // CRDT-merging samples into the user's actual cloud data.
    // Once the user authors anything, the flag is cleared and
    // future pulls take the merge path.
    if (isLocalSamplesOnly()) {
      await replaceLocalFromRemote(remote);
    } else {
      await applyRemoteDryj(remote);
    }
    // Belt-and-suspenders: every successful pull (replace OR merge)
    // commits this device to the canonical lineage; "samples-only"
    // is no longer accurate. The inner functions clear too, but
    // pinning the contract at the outer call site protects against
    // any inner-path bug or stale-read race in isLocalSamplesOnly().
    clearLocalIsSamplesOnly();
    setPhase({ kind: 'done' });
  } catch (err) {
    setPhase({ kind: 'offline', reason: (err as Error).message });
  }
}

// ============ UI ============

function BootGateShell({
  phase,
  setPhase,
}: {
  phase: Phase;
  setPhase: (p: Phase) => void;
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-surface-0 px-6">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <Brand />
        {phase.kind === 'probing' && <ProbingPanel slow={phase.slow} />}
        {phase.kind === 'linear-confirm' && (
          <LinearConfirmPanel remote={phase.remote} setPhase={setPhase} />
        )}
        {phase.kind === 'offline' && (
          <OfflinePanel reason={phase.reason} setPhase={setPhase} />
        )}
        {phase.kind === 'applying' && (
          <StatusPanel
            title="正在拉取最新数据…"
            note="完成后会无刷新地回到主界面。"
          />
        )}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        DayRail
      </span>
      <h1 className="text-lg font-medium text-ink-primary">Stay on the Rail</h1>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-tertiary border-t-transparent"
    />
  );
}

function ProbingPanel({ slow }: { slow: boolean }) {
  return (
    <section className="flex items-center gap-3 rounded-md bg-surface-1 px-4 py-3">
      <Spinner />
      <span className="text-sm text-ink-secondary">
        {slow ? '正在拉取最新数据…' : '正在同步…'}
      </span>
    </section>
  );
}

function StatusPanel({ title, note }: { title: string; note: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-md bg-surface-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <Spinner />
        <span className="text-sm text-ink-secondary">{title}</span>
      </div>
      <span className="text-2xs text-ink-tertiary">{note}</span>
    </section>
  );
}

function LinearConfirmPanel({
  remote,
  setPhase,
}: {
  remote: RemoteMeta;
  setPhase: (p: Phase) => void;
}) {
  const [remember, setRemember] = useState(false);
  const onPull = () => {
    if (remember) setBootSyncChoice('auto-pull');
    setPhase({ kind: 'applying' });
    void pullAndMount(remote, setPhase);
  };
  const onUseLocalOnce = () => {
    setPhase({ kind: 'done' });
  };
  return (
    <section className="flex flex-col gap-4 rounded-md bg-surface-1 px-4 py-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          云端有更新
        </span>
        <p className="text-sm text-ink-primary">
          云端最近编辑：
          <span className="text-ink-secondary">
            {fmtRelative(remote.modifiedTime)} · {remote.deviceLabel ?? '另一台设备'}
          </span>
        </p>
        <p className="text-2xs text-ink-tertiary">
          v0.7 用 Yjs CRDT 自动合并，本地未推送的改动也会保留。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPull}
          className="rounded-md bg-ink-primary px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:brightness-95"
          autoFocus
        >
          拉取最新
        </button>
        <button
          type="button"
          onClick={onUseLocalOnce}
          className="rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
        >
          稍后处理（仅本次）
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-tertiary">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-3.5 w-3.5 rounded-sm"
        />
        记住我的选择（拉取最新 · 之后启动自动拉，不再询问）
      </label>
    </section>
  );
}

function OfflinePanel({
  reason,
  setPhase,
}: {
  reason: string;
  setPhase: (p: Phase) => void;
}) {
  const needsReconnect = reason.includes('NEEDS_RECONNECT');
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectErr, setReconnectErr] = useState<string | null>(null);

  const onRetry = () => setPhase({ kind: 'probing', slow: false });
  const onContinue = () => {
    // Persist the user's "use local" decision for this session so the
    // next periodic / visibility / online probe doesn't re-trigger
    // silent refresh (and potentially another Google popup). Permanent
    // disconnect remains explicit via Settings → 同步 → 断开连接.
    setSyncProbeSuppressed();
    setPhase({ kind: 'done' });
  };
  const onReconnect = async () => {
    setReconnecting(true);
    setReconnectErr(null);
    try {
      await connectDrive();
      syncStore.setConnected(true);
      setPhase({ kind: 'probing', slow: false });
    } catch (e) {
      setReconnectErr((e as Error).message);
      setReconnecting(false);
    }
  };

  const friendly = friendlyReason(reason);
  return (
    <section className="flex flex-col gap-3 rounded-md bg-surface-1 px-4 py-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-warn">
          {needsReconnect ? '需要重新授权' : '离线 · 使用本地数据'}
        </span>
        <p className="text-sm text-ink-primary">{friendly}</p>
      </div>
      <div className="flex items-center gap-2">
        {needsReconnect ? (
          <>
            <button
              type="button"
              onClick={onReconnect}
              disabled={reconnecting}
              autoFocus
              className="rounded-md bg-ink-primary px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:brightness-95 disabled:opacity-50"
            >
              {reconnecting ? '正在打开 Google 同意页…' : '重新连接 Google Drive'}
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
            >
              继续使用本地
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
            >
              重试
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="rounded-md bg-ink-primary px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:brightness-95"
            >
              继续使用本地
            </button>
          </>
        )}
      </div>
      {reconnectErr && (
        <p className="rounded-sm bg-surface-0 px-3 py-2 text-2xs text-warn">
          重新连接失败：{reconnectErr}
        </p>
      )}
    </section>
  );
}

function friendlyReason(reason: string): string {
  if (reason === 'NOT_CONNECTED') {
    return '尚未连接 Google Drive，按本地数据启动。';
  }
  if (reason === 'TIMEOUT') {
    return '同步探测超时（网络抖动或 Drive 慢响应）。可继续使用本地，顶栏会标记未同步。';
  }
  if (reason.includes('NEEDS_RECONNECT')) {
    return reason.replace(/^.*?NEEDS_RECONNECT\s*·\s*/, '');
  }
  return `同步探测失败：${reason}`;
}

function fmtRelative(iso: string): string {
  if (!iso) return '刚才';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return '刚才';
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  return `${day} 天前`;
}

export type { BootSyncChoice };
