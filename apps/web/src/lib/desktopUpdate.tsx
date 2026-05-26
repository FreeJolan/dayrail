// ERD §15.4 — Tauri-side implementation of the version-update
// context. Mirrors `WebVersionUpdateProvider` from `swRegistration.tsx`
// but driven by `tauri-plugin-updater` instead of the PWA Service
// Worker.
//
// Mount this provider when `isTauriRuntime() === true`; both
// providers populate the same `VersionUpdateContext`, so consumer
// hooks (`useVersionUpdate()`, `useUpgradeFlow()`, the update banner)
// behave identically across web + desktop.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import {
  VersionUpdateContext,
  type CheckStatus,
  type VersionUpdateState,
} from './versionUpdateContext';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min — desktop polls less often than web (5 min) since users notice less often

export function DesktopVersionUpdateProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useDesktopVersionUpdateImpl();
  return (
    <VersionUpdateContext.Provider value={value}>
      {children}
    </VersionUpdateContext.Provider>
  );
}

function useDesktopVersionUpdateImpl(): VersionUpdateState {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<CheckStatus>('idle');
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<number | null>(null);

  // Track the latest detected version so we can re-open the banner if
  // a fresher one shows up after dismissal.
  const dismissedVersionRef = useRef<string | null>(null);

  const checkNow = useCallback(async (): Promise<
    'up-to-date' | 'needs-update'
  > => {
    setStatus('checking');
    let result: Update | null = null;
    try {
      result = await check();
    } catch (err) {
      // Network failure / signature mismatch / malformed manifest.
      // Logging is enough — UI just stays on its current state.
      // eslint-disable-next-line no-console
      console.warn('[updater] check failed', err);
      setLastCheckedAt(Date.now());
      setStatus('idle');
      return 'up-to-date';
    }
    setLastCheckedAt(Date.now());
    if (!result) {
      setPendingUpdate(null);
      setStatus('up-to-date');
      return 'up-to-date';
    }
    // A genuinely new version (different from the one the user
    // dismissed) re-opens the banner.
    if (
      dismissedVersionRef.current &&
      dismissedVersionRef.current !== result.version
    ) {
      setDismissed(false);
    }
    setPendingUpdate(result);
    setStatus('needs-update');
    return 'needs-update';
  }, []);

  // Periodic + visibility + online auto-checks. Same triggers as the
  // PWA path (see swRegistration.tsx) — visibility / online events
  // catch "user opens the laptop after a while".
  useEffect(() => {
    void checkNow();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkNow();
    };
    const onOnline = () => {
      void checkNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    const interval = window.setInterval(() => {
      void checkNow();
    }, CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.clearInterval(interval);
    };
  }, [checkNow]);

  const update = useCallback(async () => {
    if (!pendingUpdate) return;
    // Raise the global blocking overlay for the whole commit. The
    // pre-download phases (sync flush + local backup) have no
    // measurable progress, so start indeterminate (null) and switch to
    // a determinate fraction once the updater's download events arrive.
    setInstalling(true);
    setInstallProgress(null);
    try {
      // (1) Pre-update Drive flush — best-effort sync push so the
      // last 60s of local writes (still inside the schedulePush
      // debounce window) make it to Drive too. Combined with the
      // local auto-backup below, this gives "both local AND remote
      // have the latest state" before .app replacement, instead of
      // just "local has it (in a backup file)".
      try {
        const { runManualSync } = await import('./sync/syncController');
        const { isDriveConnected } = await import('./sync/driveAuth');
        if (isDriveConnected()) {
          await runManualSync();
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[updater] pre-update sync flush failed:', err);
        // Best-effort: the local backup below is the primary safety
        // net. Drive falling slightly behind is recoverable; missing
        // local backup is not.
      }

      // (2) Pre-update local auto-backup. Provides a recovery point
      // in case the new version's first boot mishandles state — user
      // can restore from Settings → 同步 → 本地数据 → 自动备份.
      const { autoBackup } = await import('./sync/backupController');
      await autoBackup('pre-update');

      // Tauri's downloadAndInstall() resolves *after* install
      // completes; we then trigger a relaunch to land on the new
      // version. The user perceives this as: click → brief "applying
      // update…" → app restarts.
      //
      // v0.11.6 (ERD §15.8): route through the Rust-side
      // `relaunch_for_update` command instead of the plain
      // `relaunch()` from tauri-plugin-process. The Rust command
      // sets the `DAYRAIL_RESTART_REASON=update` env var before
      // `app.restart()` so the new process's setup hook can force-
      // foreground the window (macOS does not auto-promote relaunched
      // processes to foreground; without this step the new version
      // boots behind whatever window the user was looking at).
      // Stream download progress into the overlay. `contentLength` can
      // be absent (chunked transfer / server omission) — fall back to
      // the indeterminate bar (null) in that case rather than faking a
      // denominator.
      let total = 0;
      let downloaded = 0;
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            setInstallProgress(total > 0 ? 0 : null);
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (total > 0) {
              // Cap below 1 so "100%" only shows on Finished, avoiding a
              // full bar that then sits there during the install step.
              setInstallProgress(Math.min(0.99, downloaded / total));
            }
            break;
          case 'Finished':
            setInstallProgress(total > 0 ? 1 : null);
            break;
        }
      });
      await invoke('relaunch_for_update');
      // On success the relaunch tears down this webview, so we never
      // clear `installing` here — the overlay stays up until the new
      // process paints, giving a seamless hand-off.
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[updater] install failed', err);
      // Release the overlay so the user isn't trapped behind it.
      setInstalling(false);
      setInstallProgress(null);
    }
  }, [pendingUpdate]);

  const dismiss = useCallback(() => {
    if (pendingUpdate) {
      dismissedVersionRef.current = pendingUpdate.version;
    }
    setDismissed(true);
  }, [pendingUpdate]);

  const dismissOfflineReady = useCallback(() => {
    // Web-only concept; no-op on desktop.
  }, []);

  return {
    needsRefresh: !!pendingUpdate && !dismissed,
    offlineReady: false,
    lastCheckedAt,
    status,
    installing,
    installProgress,
    update,
    dismiss,
    checkNow,
    dismissOfflineReady,
  };
}
