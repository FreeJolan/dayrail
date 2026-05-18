// Boot-time reconcile banner (ERD §7.10.4 · v0.12 P4).
//
// Mounts when syncStore.bootReconcile carries a result that warrants
// a banner. Three states:
//
//   ✓ healthy     — all peers caught up · fades after 5s · informational
//   ⚠ peer-stale  — some peer was active but didn't push recently · persists
//                   until user dismisses · gives the user a heads-up that
//                   what they see here might not be the latest version
//   ✕ offline     — could not reach Drive at boot · persists until dismiss
//
// `no-peers` (single-device case · no other heartbeats in appdata)
// suppresses the banner entirely · no noise for backup-mode users.

import { useEffect, useState } from 'react';
import { formatDurationAgo, type PeerSummary } from '@dayrail/core';
import { syncStore, useSyncStatus } from '@/lib/sync/syncStore';
import { getLastSuccessAt } from '@/lib/sync/identity';

const HEALTHY_FADE_MS = 5 * 1000;

export function ReconcileBanner() {
  const { bootReconcile } = useSyncStatus();
  const [dismissed, setDismissed] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Auto-fade for healthy state after 5s. Reset whenever the
  // result instance changes (e.g. user retried reconcile).
  useEffect(() => {
    setDismissed(false);
    setHidden(false);
    if (bootReconcile?.kind === 'healthy') {
      const id = setTimeout(() => setHidden(true), HEALTHY_FADE_MS);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [bootReconcile]);

  if (!bootReconcile) return null;
  if (bootReconcile.kind === 'no-peers') return null;
  if (dismissed) return null;
  if (hidden) return null;

  const onDismiss = () => setDismissed(true);

  if (bootReconcile.kind === 'healthy') {
    const onlyPeer =
      bootReconcile.peers.length === 1 ? bootReconcile.peers[0] : null;
    return (
      <BannerShell tone="ok" onDismiss={onDismiss}>
        <span aria-hidden>✓</span>
        <span>
          一切就绪 ·{' '}
          {onlyPeer
            ? `${onlyPeer.deviceName} 也是 ${formatDurationAgo(
                onlyPeer.lastPushedAt,
                Date.now(),
              )}的版本`
            : `共 ${bootReconcile.peers.length} 台设备都对得上`}
        </span>
      </BannerShell>
    );
  }

  if (bootReconcile.kind === 'peer-stale') {
    const first = bootReconcile.stalePeers[0];
    // Defensive null check · `peer-stale` is only returned when
    // stalePeers.length > 0 (see classifyReconcile), so this is
    // logically unreachable but makes TS happy.
    if (!first) return null;
    return (
      <BannerShell tone="warn" onDismiss={onDismiss}>
        <span aria-hidden>⚠</span>
        <span>
          {peerStaleCopy(first, bootReconcile.stalePeers.length)}
        </span>
      </BannerShell>
    );
  }

  // offline
  const lastPush = getLastSuccessAt('push');
  return (
    <BannerShell tone="warn" onDismiss={onDismiss}>
      <span aria-hidden>✕</span>
      <span>
        现在连不上 Drive · 显示的是这台机器上保存的版本
        {lastPush
          ? `（最后同步 ${formatDurationAgo(lastPush, Date.now())}）`
          : ''}
      </span>
    </BannerShell>
  );
}

function peerStaleCopy(peer: PeerSummary, totalStale: number): string {
  const activityAgo = formatDurationAgo(peer.lastActivityAt, Date.now());
  const pushAgo = formatDurationAgo(peer.lastPushedAt, Date.now());
  if (totalStale === 1) {
    return `${peer.deviceName} 今天有用，但最新内容可能还没传过来（活动 ${activityAgo} · 最后传 ${pushAgo}）`;
  }
  return `有 ${totalStale} 台设备最近活动过但没传完最新内容 · 这里看到的可能不是最新`;
}

function BannerShell({
  tone,
  onDismiss,
  children,
}: {
  tone: 'ok' | 'warn';
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        'flex items-center gap-3 border-b border-surface-3 px-4 py-2 text-xs text-ink-primary ' +
        (tone === 'ok' ? 'bg-surface-1' : 'bg-surface-2')
      }
    >
      <span
        aria-hidden
        className={tone === 'ok' ? 'text-ink-secondary' : 'text-warn'}
      ></span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md px-2.5 py-1 text-2xs text-ink-tertiary transition hover:text-ink-secondary"
      >
        知道了
      </button>
    </div>
  );
}
