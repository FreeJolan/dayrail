// Boot gate UI — renders BEFORE the main app routes mount, on every
// cold start. Implements the four-branch decision table from ERD
// §7.6:
//
//   equal          → mount immediately
//   no-remote      → first device on the account; mount immediately,
//                    let the next user write trigger an upload
//   linear-lead    → silent pull (default) OR show confirm card
//                    (when user picked "ask each time")
//   diverged       → forced conflict card, ignores remembered choice
//   offline        → splash with "重试 / 继续使用本地"; continuing
//                    mounts the app and the top-bar indicator shows
//                    `⚠ 未同步` until a successful round-trip
//
// The gate lives outside the React-Router tree because it runs before
// the app shell exists. It renders splash + dialogs in a self-
// contained <div> shell with the same surface tokens as the main app.

import { useEffect, useState } from 'react';
import {
  getBootSyncChoice,
  setBootSyncChoice,
  type BootSyncChoice,
} from './identity';
import { connectDrive, isDriveConnected } from './driveAuth';
import { syncStore } from './syncStore';
import {
  applyRemoteBundle,
  downloadLocalAsBackup,
  downloadRemoteAsBackup,
  fetchRemoteBundle,
  forcePushOverridingRemote,
  PROBE_TIMEOUTS,
  runBootProbe,
  type BootProbeOutcome,
} from './syncController';
import type { RemoteMeta } from './driveBackend';

type Phase =
  | { kind: 'probing'; slow: boolean }
  | { kind: 'linear-confirm'; remote: RemoteMeta }
  | { kind: 'diverged'; remote: RemoteMeta }
  | { kind: 'offline'; reason: string }
  | { kind: 'applying' } // pull-and-replace running, reload imminent
  | { kind: 'pushing' } // overwrite-remote running
  | { kind: 'done' };

interface Props {
  children: React.ReactNode;
}

export function BootGate({ children }: Props) {
  const [phase, setPhase] = useState<Phase>(() =>
    isDriveConnected() ? { kind: 'probing', slow: false } : { kind: 'done' },
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
      void applyAndReload(outcome.remote, setPhase);
      return;
    }
    setPhase({ kind: 'linear-confirm', remote: outcome.remote });
    return;
  }
  if (outcome.kind === 'diverged') {
    setPhase({ kind: 'diverged', remote: outcome.remote });
    return;
  }
  // offline
  setPhase({ kind: 'offline', reason: outcome.reason });
}

async function applyAndReload(
  remote: RemoteMeta,
  setPhase: (p: Phase) => void,
): Promise<void> {
  try {
    const bundle = await fetchRemoteBundle(remote);
    await applyRemoteBundle(bundle); // never returns; page reloads
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
        {phase.kind === 'diverged' && (
          <DivergedPanel remote={phase.remote} setPhase={setPhase} />
        )}
        {phase.kind === 'offline' && (
          <OfflinePanel reason={phase.reason} setPhase={setPhase} />
        )}
        {phase.kind === 'applying' && (
          <StatusPanel
            title="正在拉取最新数据…"
            note="完成后页面会自动刷新一次。"
          />
        )}
        {phase.kind === 'pushing' && (
          <StatusPanel title="正在覆盖远端…" note="完成后会回到主界面。" />
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
    void applyAndReload(remote, setPhase);
  };
  const onUseLocalOnce = () => {
    // Non-memoizable on purpose. See ERD §7.6.
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
          本地没有未同步的改动，可以安全地拉取并覆盖本地。
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
          优先用本地（仅本次）
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

function DivergedPanel({
  remote,
  setPhase,
}: {
  remote: RemoteMeta;
  setPhase: (p: Phase) => void;
}) {
  const [busy, setBusy] = useState<null | 'keep-remote' | 'overwrite' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(null);

  const onKeepRemote = async () => {
    setBusy('keep-remote');
    setError(null);
    try {
      downloadLocalAsBackup();
      // small pause so the download dialog actually fires before the
      // page reloads — Safari aborts otherwise.
      await new Promise((r) => setTimeout(r, 400));
      setPhase({ kind: 'applying' });
      const bundle = await fetchRemoteBundle(remote);
      await applyRemoteBundle(bundle); // reloads
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const onOverwriteRemote = async () => {
    setBusy('overwrite');
    setError(null);
    try {
      await downloadRemoteAsBackup(remote);
      await new Promise((r) => setTimeout(r, 400));
      setPhase({ kind: 'pushing' });
      await forcePushOverridingRemote();
      setPhase({ kind: 'done' });
    } catch (err) {
      setError((err as Error).message);
      setPhase({ kind: 'diverged', remote });
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-md bg-surface-1 px-4 py-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-warn">
          本地与云端有冲突
        </span>
        <p className="text-sm text-ink-primary">
          本地有未同步的改动，但云端也有另一台设备的新改动。请选择如何处理。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Side title="本地" hint="此设备" />
        <Side
          title="云端"
          hint={`${remote.deviceLabel ?? '另一台设备'} · ${fmtRelative(remote.modifiedTime)}`}
        />
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onKeepRemote}
          disabled={busy !== null}
          className="rounded-md bg-ink-primary px-3 py-2 text-xs font-medium text-surface-0 transition hover:brightness-95 disabled:opacity-50"
        >
          {busy === 'keep-remote' ? '正在保留远端…' : '保留远端、把本地导出留底'}
        </button>
        <button
          type="button"
          onClick={onOverwriteRemote}
          disabled={busy !== null}
          className="rounded-md bg-surface-2 px-3 py-2 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
        >
          {busy === 'overwrite' ? '正在覆盖远端…' : '覆盖远端（先把远端下载留底）'}
        </button>
      </div>
      {error && (
        <p className="rounded-sm bg-surface-0 px-3 py-2 text-2xs text-warn">{error}</p>
      )}
    </section>
  );
}

function Side({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-surface-0 px-3 py-2">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {title}
      </span>
      <span className="text-xs text-ink-secondary">{hint}</span>
    </div>
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
  const onContinue = () => setPhase({ kind: 'done' });
  const onReconnect = async () => {
    setReconnecting(true);
    setReconnectErr(null);
    try {
      // Runs from a button click → user gesture → consent popup is
      // permitted. Once it lands a fresh token in memory, re-probe
      // exactly like a normal cold start.
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
    // Strip the prefix marker; what's left is the human-readable
    // explanation we wrote in driveAuth's error_callback.
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
