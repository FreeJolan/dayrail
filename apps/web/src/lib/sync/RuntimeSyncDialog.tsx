// Runtime sync dialog — covers the cases the boot gate alone misses
// (ERD §7.6 "Pull triggers"):
//   1. tab returns to foreground / device wakes from screen lock,
//      and meanwhile another device pushed to Drive
//   2. (handled inline by SettingsSections) first connect on a new
//      device that already has data on Drive
//
// Mounts at the App level (alongside <App />), runs probes after the
// boot gate has resolved. Renders nothing in the idle state — the
// modal overlay only appears when the probe lands on a branch that
// needs user input (or a brief "正在拉取" frame for the auto-pull
// path before the OPFS reset + reload kicks in).

import { useEffect, useRef, useState } from 'react';
import { isDriveConnected } from './driveAuth';
import { getBootSyncChoice } from './identity';
import {
  applyRemoteBundle,
  downloadLocalAsBackup,
  downloadRemoteAsBackup,
  fetchRemoteBundle,
  forcePushOverridingRemote,
  runBootProbe,
} from './syncController';
import type { RemoteMeta } from './driveBackend';

const VISIBILITY_THROTTLE_MS = 5000;

type State =
  | { kind: 'idle' }
  | { kind: 'auto-pulling' }
  | { kind: 'linear-confirm'; remote: RemoteMeta }
  | { kind: 'diverged'; remote: RemoteMeta }
  | { kind: 'pushing' };

export function RuntimeSyncDialog() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const lastProbeAt = useRef(0);
  const probing = useRef(false);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (!isDriveConnected()) return;
      if (probing.current) return;
      // Don't re-probe if we're already showing a dialog from a
      // previous trigger.
      if (state.kind !== 'idle') return;
      const now = Date.now();
      if (now - lastProbeAt.current < VISIBILITY_THROTTLE_MS) return;
      lastProbeAt.current = now;
      probing.current = true;

      void runBootProbe()
        .then((outcome) => {
          if (outcome.kind === 'equal' || outcome.kind === 'no-remote') {
            // Nothing to do — already in sync.
            return;
          }
          if (outcome.kind === 'offline') {
            // Top-bar already reflects this via syncStore; no modal
            // overlay needed for a transient probe failure.
            return;
          }
          if (outcome.kind === 'linear-lead') {
            if (getBootSyncChoice() === 'auto-pull') {
              setState({ kind: 'auto-pulling' });
              void doApply(outcome.remote, setState);
            } else {
              setState({ kind: 'linear-confirm', remote: outcome.remote });
            }
            return;
          }
          if (outcome.kind === 'diverged') {
            setState({ kind: 'diverged', remote: outcome.remote });
          }
        })
        .finally(() => {
          probing.current = false;
        });
    };

    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [state.kind]);

  if (state.kind === 'idle') return null;
  return <Overlay state={state} setState={setState} />;
}

async function doApply(remote: RemoteMeta, setState: (s: State) => void) {
  try {
    const bundle = await fetchRemoteBundle(remote);
    await applyRemoteBundle(bundle); // reloads page; never returns
  } catch (err) {
    console.warn('[sync] runtime auto-pull failed:', err);
    setState({ kind: 'idle' });
  }
}

function Overlay({
  state,
  setState,
}: {
  state: Exclude<State, { kind: 'idle' }>;
  setState: (s: State) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-md bg-surface-0 shadow-xl">
        <div className="px-5 py-5">
          {state.kind === 'auto-pulling' && <AutoPullingPanel />}
          {state.kind === 'pushing' && <PushingPanel />}
          {state.kind === 'linear-confirm' && (
            <LinearConfirmPanel remote={state.remote} setState={setState} />
          )}
          {state.kind === 'diverged' && (
            <DivergedPanel remote={state.remote} setState={setState} />
          )}
        </div>
      </div>
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

function AutoPullingPanel() {
  return (
    <div className="flex items-center gap-3">
      <Spinner />
      <span className="text-sm text-ink-secondary">正在拉取最新数据…</span>
    </div>
  );
}

function PushingPanel() {
  return (
    <div className="flex items-center gap-3">
      <Spinner />
      <span className="text-sm text-ink-secondary">正在覆盖远端…</span>
    </div>
  );
}

function LinearConfirmPanel({
  remote,
  setState,
}: {
  remote: RemoteMeta;
  setState: (s: State) => void;
}) {
  const onPull = () => {
    setState({ kind: 'auto-pulling' });
    void doApply(remote, setState);
  };
  const onUseLocalOnce = () => {
    // Non-memoizable on purpose. ERD §7.6.
    setState({ kind: 'idle' });
  };
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          云端有新改动
        </span>
        <p className="text-sm text-ink-primary">
          检测到云端在你离开期间被另一台设备更新过：
          <span className="text-ink-secondary">
            {' '}
            {fmtRelative(remote.modifiedTime)} · {remote.deviceLabel ?? '另一台设备'}
          </span>
        </p>
        <p className="text-2xs text-ink-tertiary">
          本地没有未同步的改动，可以安全地拉取。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPull}
          autoFocus
          className="rounded-md bg-ink-primary px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:brightness-95"
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
    </section>
  );
}

function DivergedPanel({
  remote,
  setState,
}: {
  remote: RemoteMeta;
  setState: (s: State) => void;
}) {
  const [busy, setBusy] = useState<null | 'keep-remote' | 'overwrite'>(null);
  const [error, setError] = useState<string | null>(null);

  const onKeepRemote = async () => {
    setBusy('keep-remote');
    setError(null);
    try {
      downloadLocalAsBackup();
      await new Promise((r) => setTimeout(r, 400));
      setState({ kind: 'auto-pulling' });
      const bundle = await fetchRemoteBundle(remote);
      await applyRemoteBundle(bundle); // reloads
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const onOverwrite = async () => {
    setBusy('overwrite');
    setError(null);
    try {
      await downloadRemoteAsBackup(remote);
      await new Promise((r) => setTimeout(r, 400));
      setState({ kind: 'pushing' });
      await forcePushOverridingRemote();
      setState({ kind: 'idle' });
    } catch (err) {
      setError((err as Error).message);
      setState({ kind: 'diverged', remote });
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-warn">
          本地与云端有冲突
        </span>
        <p className="text-sm text-ink-primary">
          本地有未推送改动，云端也有
          <span className="text-ink-secondary">
            {' '}
            {remote.deviceLabel ?? '另一台设备'} · {fmtRelative(remote.modifiedTime)}
          </span>
          {' '}的新改动。
        </p>
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
          onClick={onOverwrite}
          disabled={busy !== null}
          className="rounded-md bg-surface-2 px-3 py-2 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
        >
          {busy === 'overwrite' ? '正在覆盖远端…' : '覆盖远端（先把远端下载留底）'}
        </button>
      </div>
      {error && (
        <p className="rounded-sm bg-surface-1 px-3 py-2 text-2xs text-warn">{error}</p>
      )}
    </section>
  );
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
