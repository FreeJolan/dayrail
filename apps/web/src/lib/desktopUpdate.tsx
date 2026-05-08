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
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
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
    try {
      // Tauri's downloadAndInstall() resolves *after* install
      // completes; we then trigger a relaunch to land on the new
      // version. The user perceives this as: click → brief "applying
      // update…" → app restarts.
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[updater] install failed', err);
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
    update,
    dismiss,
    checkNow,
    dismissOfflineReady,
  };
}
