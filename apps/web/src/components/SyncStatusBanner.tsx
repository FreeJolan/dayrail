// Duration-aware sync status banner (ERD §7.10.5 · v0.12 P2).
//
// Mounts at the top of the main layout, shows when the classification
// is not 'healthy'. Two flavours:
//
//   - long-failure: "传不上去 N 小时了" or "已经 N 天没传上去"
//     with [再试一次] + [先关掉] buttons. The dismiss is session-
//     scoped — survives page navigation but not page reload, and
//     auto-clears if the failure escalates to a higher severity tier.
//
//   - pending-pile: "你最近改的内容有 N 个还在本机 · 大约 X 小时
//     没传上去". Dismiss is persistent (24h via SyncMeta) so the
//     user isn't nagged again until they explicitly want to revisit.
//
// Per ERD §7.10 UX principle: never blocks the main UI, always one-
// click dismissable, technical detail folded behind links.

import { useState } from 'react';
import {
  formatDurationLong,
  PENDING_PILE_THRESHOLD,
  type SyncStatusClassification,
} from '@dayrail/core';
import { setDismissPendingPileUntil } from '@/lib/sync/identity';
import { runManualSync } from '@/lib/sync/syncController';
import { useSyncClassification } from '@/lib/sync/useSyncClassification';

const DISMISS_24H_MS = 24 * 60 * 60 * 1000;

export function SyncStatusBanner() {
  const classification = useSyncClassification();
  // Session-scoped long-failure dismiss. Keyed by severity so a
  // mild → distinct escalation re-surfaces the banner.
  const [dismissedSeverity, setDismissedSeverity] = useState<
    'mild' | 'distinct' | 'heavy' | null
  >(null);
  const [retrying, setRetrying] = useState(false);

  if (!shouldShow(classification, dismissedSeverity)) return null;

  const onRetry = async () => {
    setRetrying(true);
    try {
      await runManualSync();
    } catch {
      // runManualSync's outcome surfaces via syncStore phase; the
      // classification will re-evaluate on next tick. Swallow here.
    }
    setRetrying(false);
  };

  const onDismiss = () => {
    if (classification.kind === 'pending-pile') {
      setDismissPendingPileUntil(
        new Date(Date.now() + DISMISS_24H_MS).toISOString(),
      );
      return;
    }
    if (classification.kind === 'long-failure') {
      setDismissedSeverity(classification.severity);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-surface-3 bg-surface-1 px-4 py-2 text-xs text-ink-primary"
    >
      <span aria-hidden className="text-warn">
        {classification.kind === 'long-failure'
          ? classification.severity === 'mild'
            ? '⚠'
            : '⚠⚠'
          : '📦'}
      </span>
      <span className="flex-1">{bannerCopy(classification)}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="rounded-md bg-surface-2 px-2.5 py-1 text-2xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
      >
        {retrying ? '正在重试…' : '再试一次'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md px-2.5 py-1 text-2xs text-ink-tertiary transition hover:text-ink-secondary"
      >
        先关掉
      </button>
    </div>
  );
}

function shouldShow(
  classification: SyncStatusClassification,
  dismissedSeverity: 'mild' | 'distinct' | 'heavy' | null,
): boolean {
  if (classification.kind === 'healthy') return false;
  if (classification.kind === 'pending-pile') {
    // Pending-pile dismiss lives in SyncMeta (24h); classify already
    // returns 'long-failure' or 'healthy' once suppressed, so reaching
    // here means the alert is supposed to show.
    return true;
  }
  // long-failure
  return dismissedSeverity !== classification.severity;
}

function bannerCopy(c: SyncStatusClassification): string {
  if (c.kind === 'pending-pile') {
    return `你最近改的内容有 ${c.count} 个还在本机 · ${formatDurationLong(
      c.durationMs,
    )}`;
  }
  if (c.kind === 'long-failure') {
    if (c.severity === 'heavy') {
      return `${formatDurationLong(c.durationMs)} · 这台机器看到的可能不是最新版本`;
    }
    if (c.severity === 'distinct') {
      return `${formatDurationLong(c.durationMs)} · 这台机器看到的可能不是最新版本`;
    }
    return formatDurationLong(c.durationMs);
  }
  return '';
}

// Re-export for tests / future Settings detail-view linkage.
export { PENDING_PILE_THRESHOLD };
