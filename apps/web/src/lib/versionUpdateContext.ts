// Shared types + React context for "is there a new version available?".
//
// v0.9 splits the implementation into two providers:
//   - Web: PWA Service Worker (apps/web/src/lib/swRegistration.tsx)
//   - Desktop: Tauri updater plugin (apps/web/src/lib/desktopUpdate.tsx)
//
// `App.tsx` mounts one or the other based on `isTauriRuntime()`.
// Consumers (UpdateBanner, useUpgradeFlow, Settings About row) call
// `useVersionUpdate()` and get the same shape regardless of which
// implementation is active.

import { createContext, useContext } from 'react';

export type CheckStatus = 'idle' | 'checking' | 'up-to-date' | 'needs-update';

export interface VersionUpdateState {
  /** True when a new version is waiting AND the user hasn't dismissed
   *  this session. Banner should render iff this is true. */
  needsRefresh: boolean;
  /** PWA-only signal: SW finished its install pass and the app is
   *  now offline-capable. Always `false` on desktop. */
  offlineReady: boolean;
  /** Epoch ms of the last check resolution; `null` until first check. */
  lastCheckedAt: number | null;
  status: CheckStatus;
  /** True from the moment `update()` begins committing until the page
   *  reloads (web) / the app relaunches (desktop). Drives the global
   *  blocking install overlay (`UpdateInstallOverlay`). Reset to false
   *  only if the commit fails — on success the page tears down first. */
  installing: boolean;
  /** Download fraction in [0,1] while `installing`, or `null` for an
   *  indeterminate bar: the web SW reload (no measurable download), the
   *  desktop pre-download backup phase, or when the updater server omits
   *  Content-Length. Only meaningful while `installing` is true. */
  installProgress: number | null;
  /** Commit: install the new version + reload. On web this is
   *  skipWaiting + page reload; on desktop this is downloadAndInstall
   *  + app restart. */
  update: () => Promise<void>;
  /** "Later" — hide the banner for this session. A subsequent new
   *  version detection re-opens it. */
  dismiss: () => void;
  /** Manual "check for updates". Resolves with the outcome for UI
   *  side-effects (e.g. flashing an "already up to date" toast). */
  checkNow: () => Promise<'up-to-date' | 'needs-update'>;
  /** Web-only: dismiss the one-time offline-ready notice. No-op on
   *  desktop. */
  dismissOfflineReady: () => void;
}

export const VersionUpdateContext = createContext<VersionUpdateState | null>(
  null,
);

export function useVersionUpdate(): VersionUpdateState {
  const ctx = useContext(VersionUpdateContext);
  if (!ctx) {
    throw new Error(
      'useVersionUpdate() called outside <VersionUpdateProvider>. Mount the appropriate provider in App.tsx (Web or Desktop) before consuming.',
    );
  }
  return ctx;
}

/** Detect Tauri runtime. Tauri 2 sets `__TAURI_INTERNALS__` on
 *  `window`; this is the canonical detection (rather than the legacy
 *  `__TAURI__` v1 flag).  Used by App.tsx to pick which provider to
 *  mount; safe to call before any plugin is loaded. */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  );
}
