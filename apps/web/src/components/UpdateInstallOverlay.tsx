import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useVersionUpdate } from '@/lib/versionUpdateContext';

// ------------------------------------------------------------------
// Global blocking overlay shown while a version update is committing.
// ERD §13.8 / §15.4.
//
// Replaces the old corner toast: once the user commits an update
// ("立即更新" → backup → download → relaunch), this full-screen layer
// covers the app, blocks all interaction, and surfaces download
// progress so the multi-second desktop download doesn't look frozen.
//
// • Desktop: `installProgress` tracks the updater's download events
//   (determinate bar + %). The pre-download phases (sync flush + local
//   backup) and unknown-length downloads show the indeterminate sweep.
// • Web: the SW reload is instant, so the overlay just flashes an
//   indeterminate bar over the skipWaiting + reload.
//
// z-[400] sits above every other layer — modals (z-[200]–[230]),
// floating overlays (z-[240]), and the dev strip (z-[300]) — because
// the update is a terminal, irreversible action: nothing should paint
// over it until the app reloads / relaunches.
// ------------------------------------------------------------------

export function UpdateInstallOverlay() {
  const { installing, installProgress } = useVersionUpdate();

  if (typeof document === 'undefined' || !installing) return null;

  const determinate = installProgress != null;
  const pct = determinate ? Math.round(installProgress * 100) : null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-label="正在更新 DayRail"
      className="fixed inset-0 z-[400] flex items-center justify-center bg-surface-0/85 backdrop-blur-sm animate-[overlayIn_180ms_ease-out]"
    >
      <div className="flex w-[260px] flex-col items-center gap-3 text-center">
        <span className="text-sm font-medium text-ink-primary">
          {determinate ? '正在下载新版本' : '正在准备更新…'}
        </span>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          {determinate ? (
            <div
              className="h-full rounded-full bg-cta transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="h-full w-1/3 rounded-full bg-cta animate-[indeterminateSlide_1.2s_ease-in-out_infinite]" />
          )}
        </div>

        <span
          className={clsx(
            'font-mono text-2xs tabular-nums text-ink-tertiary',
            !determinate && 'opacity-70',
          )}
        >
          {determinate ? `${pct}%` : '准备中…'}
        </span>

        <span className="text-2xs text-ink-tertiary">
          完成后将自动重启 DayRail
        </span>
      </div>
    </div>,
    document.body,
  );
}
