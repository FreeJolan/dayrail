// Mode upgrade toast (ERD §7.10.1 · v0.12 P5).
//
// Mounts when `syncStore.showModeUpgradeToast === true` · fired by
// `runReconcileAtBoot` when the inferred mode goes backup → sync
// for the first time (or after a 24h cooldown).
//
// Per ERD §7.10.1 design discussion: this is **informational**, not
// a forced acknowledgment. The user gave consent to multi-device
// sync by completing OAuth on the second device · this toast just
// surfaces "by the way, you're now in multi-device territory".
//
// Folded "看看会有什么变化 ⌄" disclosure for the curious.

import { useState } from 'react';
import { syncStore, useSyncStatus } from '@/lib/sync/syncStore';

export function ModeUpgradeToast() {
  const { showModeUpgradeToast } = useSyncStatus();
  const [showDetail, setShowDetail] = useState(false);
  if (!showModeUpgradeToast) return null;

  const onDismiss = () => {
    setShowDetail(false);
    syncStore.setShowModeUpgradeToast(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 border-b border-surface-3 bg-surface-1 px-4 py-2 text-xs text-ink-primary"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-ink-secondary">
          ℹ
        </span>
        <span className="flex-1">
          另一台设备加入了同步 ·{' '}
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="text-ink-secondary underline-offset-2 transition hover:text-ink-primary hover:underline"
          >
            {showDetail ? '收起 ⌃' : '看看会有什么变化 ⌄'}
          </button>
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2.5 py-1 text-2xs text-ink-tertiary transition hover:text-ink-secondary"
        >
          关掉
        </button>
      </div>
      {showDetail ? (
        <p className="text-2xs leading-relaxed text-ink-tertiary">
          从现在起，你在任意一台设备的改动会自动同步到其它设备。
          启动时 DayRail 会检查另一台设备的最近活动，
          告诉你这里看到的是不是最新版本。
          如果某天两台设备同时改了同一个字段，会弹一个小窗让你挑保留哪边。
        </p>
      ) : null}
    </div>
  );
}
