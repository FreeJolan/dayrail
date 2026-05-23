// Top sync banner (ERD §7.10.5 · two-axis model since v0.12.7).
//
// Mounts at the top of the main layout. Shows ONLY for the two real
// failure states, and only once a failure has persisted ≥ 1h (sub-hour
// failures stay as the subtle SideNav dot — the top banner is the
// intrusive tier, reserved for sustained problems):
//
//   - push-failure: "{N} 个改动没传上去 · 已经 X 天没传上去" — your
//     local changes can't reach Drive (data at risk).
//   - pull-failure: "连不上云端 · 这台机器看到的可能不是最新版本" —
//     can't reach Drive to confirm we're current.
//
// Idle-but-consistent and queued-but-not-failing states never show a
// banner (that was the old false-"同步断开" noise this redesign kills).
//
// Per ERD §7.10 UX principle: never blocks the main UI, always one-
// click dismissable (session-scoped, re-surfaces on severity escalation).

import { useState } from 'react';
import {
  formatDurationLong,
  type SyncStatusClassification,
} from '@dayrail/core';
import { runManualSync } from '@/lib/sync/syncController';
import { useSyncClassification } from '@/lib/sync/useSyncClassification';

const HOUR_MS = 60 * 60 * 1000;

export function SyncStatusBanner() {
  const classification = useSyncClassification();
  // Session-scoped dismiss, keyed by severity so a mild → distinct →
  // heavy escalation re-surfaces the banner.
  const [dismissedSeverity, setDismissedSeverity] = useState<
    'mild' | 'distinct' | 'heavy' | null
  >(null);
  const [retrying, setRetrying] = useState(false);

  if (!shouldShow(classification, dismissedSeverity)) return null;
  // Past the guard, classification is a failure kind with a severity.
  const severity =
    classification.kind === 'push-failure' ||
    classification.kind === 'pull-failure'
      ? classification.severity
      : 'mild';

  const onRetry = async () => {
    setRetrying(true);
    try {
      await runManualSync();
    } catch {
      // Outcome surfaces via syncStore phase; classification re-
      // evaluates on the next tick. Swallow here.
    }
    setRetrying(false);
  };

  const onDismiss = () => setDismissedSeverity(severity);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-surface-3 bg-surface-1 px-4 py-2 text-xs text-ink-primary"
    >
      <span aria-hidden className="text-warn">
        {severity === 'mild' ? '⚠' : '⚠⚠'}
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
  // Only the two real failure states are intrusive-banner-worthy.
  if (
    classification.kind !== 'push-failure' &&
    classification.kind !== 'pull-failure'
  ) {
    return false;
  }
  // Sub-hour failures stay as the subtle SideNav dot only (§7.10.5
  // ladder: < 1h = no banner). Infinity (never reached remote) passes.
  if (classification.durationMs < HOUR_MS) return false;
  return dismissedSeverity !== classification.severity;
}

function bannerCopy(c: SyncStatusClassification): string {
  if (c.kind === 'push-failure') {
    return `${c.count} 个改动没传上去 · ${formatDurationLong(c.durationMs)}`;
  }
  if (c.kind === 'pull-failure') {
    return '连不上云端 · 这台机器看到的可能不是最新版本';
  }
  return '';
}
