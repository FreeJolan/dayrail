// Runtime sync dialog (v0.7) — covers the cases the boot gate alone
// misses (ERD §7.6 + §7.7 "Pull triggers"). Three triggers feed it:
//   1. visibility probe — tab returns to foreground / device wakes
//      from screen lock (§7.6).
//   2. periodic probe — every 5 minutes while visible + online (§7.7),
//      silent (no topbar flash on equal/no-remote).
//   3. online-restoration probe — `online` event fires the moment the
//      device regains network (§7.7), so a 4-minute offline gap
//      doesn't have to wait for the next periodic tick.
//
// v0.7 removed the `diverged` conflict card: Yjs's CRDT merge handles
// concurrent edits silently, so any "remote ahead" state is just a
// linear-lead pull. The pull itself is in-memory (no reload) — the
// Y.Doc observer re-derives flat zustand state and the UI updates
// without losing scroll position or open dialogs.
//
// Mounts at the App level (alongside <App />), runs probes after the
// boot gate has resolved. Renders nothing in the idle state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isDriveConnected } from './driveAuth';
import { isSyncProbeSuppressed } from './identity';
import { getBootSyncChoice } from './identity';
import {
  applyRemoteDryj,
  isPullInFlight,
  replaceLocalFromRemote,
  runBootProbe,
} from './syncController';
import { clearLocalIsSamplesOnly, isLocalSamplesOnly } from './identity';
import type { RemoteMeta } from './driveBackend';

const PROBE_THROTTLE_MS = 5000;
const PERIODIC_PROBE_INTERVAL_MS = 5 * 60 * 1000;

type State =
  | { kind: 'idle' }
  | { kind: 'auto-pulling' }
  | { kind: 'linear-confirm'; remote: RemoteMeta };

export function RuntimeSyncDialog() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const stateKindRef = useRef<State['kind']>('idle');
  const lastProbeAt = useRef(0);
  const probing = useRef(false);

  useEffect(() => {
    stateKindRef.current = state.kind;
  }, [state.kind]);

  const tryProbe = useCallback((silent: boolean) => {
    if (!isDriveConnected()) return;
    // Honor the session-scoped "use local" decision from BootGate's
    // OfflinePanel — without this gate, the periodic 5-min tick + the
    // visibility/online listeners below would re-probe and surface
    // the same Google-popup loop the user just dismissed.
    if (isSyncProbeSuppressed()) return;
    if (probing.current) return;
    // A pull is already running through the sync controller (manual
    // 立即同步, BootGate apply, or a previous probe). Don't probe
    // against the stale lastPulled cursor — once the in-flight pull
    // finishes it advances the cursor; the next probe tick will see
    // an up-to-date state.
    if (isPullInFlight()) return;
    if (stateKindRef.current !== 'idle') return;
    const now = Date.now();
    if (now - lastProbeAt.current < PROBE_THROTTLE_MS) return;
    lastProbeAt.current = now;
    probing.current = true;

    void runBootProbe({ silent })
      .then((outcome) => {
        if (outcome.kind === 'equal' || outcome.kind === 'no-remote') return;
        if (outcome.kind === 'offline') return;
        // linear-lead: pull. Respect the persisted "boot sync choice"
        // — auto-pull defaults to silent merge, "ask each time" pops
        // a confirm card.
        if (getBootSyncChoice() === 'auto-pull') {
          setState({ kind: 'auto-pulling' });
          void doPull(outcome.remote, setState);
        } else {
          setState({ kind: 'linear-confirm', remote: outcome.remote });
        }
      })
      .finally(() => {
        probing.current = false;
      });
  }, []);

  // Trigger 1: visibility — tab returns to foreground.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      tryProbe(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [tryProbe]);

  // Trigger 2: periodic — every 5 minutes, gated on visible + online.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      tryProbe(true);
    };
    const id = window.setInterval(tick, PERIODIC_PROBE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [tryProbe]);

  // Trigger 3: online-restoration.
  useEffect(() => {
    const onOnline = () => {
      if (document.visibilityState !== 'visible') return;
      tryProbe(false);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [tryProbe]);

  if (state.kind === 'idle') return null;
  return <Overlay state={state} setState={setState} />;
}

async function doPull(remote: RemoteMeta, setState: (s: State) => void) {
  try {
    // Same samples-only gate as ConnectDrivePanel and BootGate. The
    // visibility/periodic/online probes can fire on a passive
    // session that hasn't yet authored anything beyond the v0.7
    // sample seed (e.g., boot canonical-peek timed out → seed
    // fired → BootGate hit hard-timeout → user clicked "use local"
    // → app mounts samples-only → network recovers → online event
    // wakes this dialog). Without this branch, doPull merges
    // samples into the user's cloud canonical and the next push
    // pollutes Drive for every other device. The flag is the
    // contract; all three pull surfaces have to honor it.
    if (isLocalSamplesOnly()) {
      await replaceLocalFromRemote(remote);
    } else {
      await applyRemoteDryj(remote);
    }
    // Belt-and-suspenders, mirroring BootGate.pullAndMount.
    clearLocalIsSamplesOnly();
    setState({ kind: 'idle' });
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
          {state.kind === 'linear-confirm' && (
            <LinearConfirmPanel remote={state.remote} setState={setState} />
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

function LinearConfirmPanel({
  remote,
  setState,
}: {
  remote: RemoteMeta;
  setState: (s: State) => void;
}) {
  const onPull = () => {
    setState({ kind: 'auto-pulling' });
    void doPull(remote, setState);
  };
  const onUseLocalOnce = () => {
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
          v0.7 用 Yjs CRDT 自动合并，本地未推送的改动也会保留。
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
