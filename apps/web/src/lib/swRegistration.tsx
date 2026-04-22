import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// ------------------------------------------------------------------
// Service Worker registration + version-update state.
//
// ERD §13. Wraps vite-plugin-pwa's `useRegisterSW` (which in turn
// owns the Workbox glue) and layers DayRail's policy on top:
//
// • `registerType = 'prompt'` in vite.config — app code owns the
//   skipWaiting trigger so we can surface a banner instead of
//   silent auto-update.
// • Auto-check cadence: every 5 minutes, plus whenever the tab
//   becomes visible or the browser regains connectivity.
// • "Later" dismissal scopes to the current session only — stored
//   in React state, not localStorage, so a reopen / reload resets.
//   A brand-new `waiting` SW mid-session re-surfaces the banner
//   because we detect the false → true transition explicitly.
// ------------------------------------------------------------------

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type CheckStatus = 'idle' | 'checking' | 'up-to-date' | 'needs-update';

export interface VersionUpdateState {
  /** True when a new SW is waiting AND the user hasn't dismissed this
   *  session. Banner should render iff this is true. */
  needsRefresh: boolean;
  offlineReady: boolean;
  /** Epoch ms of the last `updateSW`/registration.update() resolution;
   *  `null` until the first check fires. */
  lastCheckedAt: number | null;
  status: CheckStatus;
  /** Commit: skipWaiting the new SW and reload the page. */
  update: () => Promise<void>;
  /** "Later" — hide the banner for this session. A subsequent new
   *  waiting SW will re-open it. */
  dismiss: () => void;
  /** Manual "check for updates". Resolves with the outcome for UI
   *  side-effects (e.g. flashing an "already up to date" toast). */
  checkNow: () => Promise<'up-to-date' | 'needs-update'>;
  /** Dismiss the one-time offline-ready notice. */
  dismissOfflineReady: () => void;
}

const VersionUpdateContext = createContext<VersionUpdateState | null>(null);

export function VersionUpdateProvider({ children }: { children: ReactNode }) {
  const value = useVersionUpdateImpl();
  return (
    <VersionUpdateContext.Provider value={value}>
      {children}
    </VersionUpdateContext.Provider>
  );
}

export function useVersionUpdate(): VersionUpdateState {
  const ctx = useContext(VersionUpdateContext);
  if (!ctx) {
    throw new Error(
      'useVersionUpdate() called outside <VersionUpdateProvider>. Mount the provider in App.tsx before consuming.',
    );
  }
  return ctx;
}

function useVersionUpdateImpl(): VersionUpdateState {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(
    undefined,
  );
  const [dismissed, setDismissed] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<CheckStatus>('idle');

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registrationRef.current = r;
    },
    onRegisterError(err) {
      // Registration can fail in unusual environments (private tab,
      // disabled SW). Swallow — the banner just never surfaces and
      // the app continues to work from live network fetches.
      // eslint-disable-next-line no-console
      console.warn('[sw] register failed', err);
    },
  });

  // A fresh needRefresh=true should re-enable the banner even if the
  // user had dismissed a previous wave. Detect the false → true edge.
  const prevNeedRefreshRef = useRef(needRefresh);
  useEffect(() => {
    if (needRefresh && !prevNeedRefreshRef.current) {
      setDismissed(false);
    }
    prevNeedRefreshRef.current = needRefresh;
  }, [needRefresh]);

  const checkNow = useCallback(async (): Promise<
    'up-to-date' | 'needs-update'
  > => {
    const reg = registrationRef.current;
    if (!reg) {
      setLastCheckedAt(Date.now());
      return 'up-to-date';
    }
    setStatus('checking');
    try {
      await reg.update();
    } catch {
      // Offline / transient fetch failure — not user-actionable here.
    }
    setLastCheckedAt(Date.now());
    const hasWaiting = !!reg.waiting;
    const outcome: 'up-to-date' | 'needs-update' = hasWaiting
      ? 'needs-update'
      : 'up-to-date';
    setStatus(outcome);
    return outcome;
  }, []);

  // Periodic + visibility + online auto-checks.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkNow();
      }
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
    try {
      // vite-plugin-pwa's updateServiceWorker handles skipWaiting +
      // reload internally. As of 0.13.2+ the boolean arg is a no-op,
      // but we pass `true` for clarity.
      await updateServiceWorker(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sw] updateServiceWorker failed', err);
    }
  }, [updateServiceWorker]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    // Flip the hook's own flag to false so downstream consumers
    // (Settings hint, future UI) also see the dismissed state.
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  const dismissOfflineReady = useCallback(() => {
    setOfflineReady(false);
  }, [setOfflineReady]);

  return {
    needsRefresh: needRefresh && !dismissed,
    offlineReady,
    lastCheckedAt,
    status,
    update,
    dismiss,
    checkNow,
    dismissOfflineReady,
  };
}

// ------------------------------------------------------------------
// Build-time version metadata surfaced in Settings → About and the
// update banner subtitle. Exported from the same module so consumers
// don't need to know the constant names.
// ------------------------------------------------------------------

export const APP_VERSION = __APP_VERSION__;
export const APP_GIT_SHA = __APP_GIT_SHA__;
export const APP_BUILD_DATE = __APP_BUILD_DATE__;
