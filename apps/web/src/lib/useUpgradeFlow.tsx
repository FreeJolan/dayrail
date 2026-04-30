import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { exportDryjSnapshot } from '@/lib/exportData';
import { getDeviceId, getDeviceLabel } from '@/lib/sync/identity';
import {
  getUpgradePref,
  setUpgradePref,
  subscribeUpgradePref,
  type UpgradePref,
} from '@/lib/upgradePref';
import { useVersionUpdate } from '@/lib/swRegistration';
import { BackupPromptDialog } from '@/components/BackupPromptDialog';

// §13.8 — entry-point hook for the upgrade flow. Both the top
// `UpdateBanner` ("立即更新") and the Settings About "升级" button
// route through `requestUpgrade()`. The hook owns:
//
//   • dialog open/close state (driven by pref === 'ask')
//   • the "remember my choice" checkbox value
//   • the actual exportDryjSnapshot() → 250ms tick → update() chain
//     (v0.7+: backup is a `.dryj` Y.Doc binary — round-trips cleanly
//     through Settings → "Import from snapshot". The legacy JSON dump
//     stays available under Settings → 高级 → 下载 JSON for manual
//     inspection but cannot be re-imported.)
//   • the visibility toast on the 'always' silent-backup path
//   • atomic backup-failure handling: a failed export aborts the
//     upgrade entirely and surfaces an error toast (ERD §13.8).

const TICK_BEFORE_UPDATE_MS = 250;
const TOAST_AUTO_DISMISS_MS = 4000;

type ToastKind = 'backed-up' | 'failed';

interface ToastState {
  kind: ToastKind;
  filename?: string;
  message?: string;
}

export interface UseUpgradeFlowResult {
  /** Read the current preference and decide whether to open the dialog
   *  or proceed silently. Idempotent while a flow is in flight. */
  requestUpgrade: () => void;
  /** Render this in the parent tree. Wraps the dialog and the
   *  visibility toast; does not affect layout when both are idle. */
  surface: React.ReactNode;
}

export function useUpgradeFlow(): UseUpgradeFlowResult {
  const { update } = useVersionUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Track pref in state so the surface reacts to Settings flips made
  // while the dialog is closed (no functional impact, but keeps the
  // hook's view consistent with the source of truth).
  const [, setPref] = useState<UpgradePref>(() => getUpgradePref());

  useEffect(() => subscribeUpgradePref((next) => setPref(next)), []);

  // Auto-dismiss the toast. The 'backed-up' toast is also racing the
  // page reload triggered by `update()`; whichever wins is fine — the
  // user perceives a confirmation flash followed by the new version.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(
      () => setToast(null),
      TOAST_AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(id);
  }, [toast]);

  const runBackupThenUpdate = useCallback(async () => {
    setBusy(true);
    let filename: string;
    try {
      filename = exportDryjSnapshot(getDeviceId(), getDeviceLabel());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[upgrade] backup failed', err);
      setBusy(false);
      setDialogOpen(false);
      setToast({
        kind: 'failed',
        message: '备份失败，已取消升级',
      });
      return;
    }
    setToast({ kind: 'backed-up', filename });
    setDialogOpen(false);
    // Hand the navigation off to the download stream before SW reload
    // tears the page down. 250 ms is empirically enough on every
    // browser we target; `exportDryjSnapshot` itself defers
    // URL.revokeObjectURL by 1 s, so we're inside that window.
    window.setTimeout(() => {
      void update();
    }, TICK_BEFORE_UPDATE_MS);
  }, [update]);

  const runUpdateOnly = useCallback(() => {
    setDialogOpen(false);
    void update();
  }, [update]);

  const requestUpgrade = useCallback(() => {
    if (busy || dialogOpen) return;
    const pref = getUpgradePref();
    if (pref === 'always') {
      void runBackupThenUpdate();
      return;
    }
    if (pref === 'never') {
      runUpdateOnly();
      return;
    }
    // 'ask' → reset transient dialog state and open.
    setRemember(false);
    setDialogOpen(true);
  }, [busy, dialogOpen, runBackupThenUpdate, runUpdateOnly]);

  const handleBackupAndUpgrade = useCallback(() => {
    if (remember) setUpgradePref('always');
    void runBackupThenUpdate();
  }, [remember, runBackupThenUpdate]);

  const handleUpgradeOnly = useCallback(() => {
    if (remember) setUpgradePref('never');
    runUpdateOnly();
  }, [remember, runUpdateOnly]);

  const handleCancel = useCallback(() => {
    // "Cancel" never persists the preference — even if the user had
    // ticked "Remember my choice", cancelling means they made no
    // choice this round (ERD §13.8).
    setDialogOpen(false);
    setBusy(false);
  }, []);

  const surface = (
    <>
      <BackupPromptDialog
        open={dialogOpen}
        remember={remember}
        onRememberChange={setRemember}
        onBackupAndUpgrade={handleBackupAndUpgrade}
        onUpgradeOnly={handleUpgradeOnly}
        onCancel={handleCancel}
        busy={busy}
      />
      <UpgradeFlowToast toast={toast} onClose={() => setToast(null)} />
    </>
  );

  return { requestUpgrade, surface };
}

// ------------------------------------------------------------------
// Inline toast — bottom-right, same slot as §13.6's offline-ready
// notice. Two flavours:
//   • backed-up: visible-confirmation that the silent 'always' path
//     just downloaded a file, name included.
//   • failed: backup attempt threw — the upgrade was aborted and the
//     user needs to know why nothing happened.
// ------------------------------------------------------------------

function UpgradeFlowToast({
  toast,
  onClose,
}: {
  toast: ToastState | null;
  onClose: () => void;
}) {
  if (typeof document === 'undefined' || !toast) return null;
  const isFail = toast.kind === 'failed';
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'fixed bottom-6 right-6 z-[80] flex max-w-sm items-center gap-2 rounded-md px-3 py-2 text-xs shadow-[0_0_0_0.5px_theme(colors.hairline),0_8px_24px_-12px_rgba(0,0,0,0.18)]',
        isFail ? 'bg-surface-1 text-ink-primary' : 'bg-surface-1 text-ink-primary',
      )}
    >
      <Check
        className={clsx('h-3.5 w-3.5 shrink-0', isFail ? 'hidden' : 'text-cta')}
        strokeWidth={2}
      />
      {isFail ? (
        <span>{toast.message ?? '备份失败，已取消升级'}</span>
      ) : (
        <span>
          已备份到 <span className="font-mono">{toast.filename}</span> · 即将升级…
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="ml-1 rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        <X className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </div>,
    document.body,
  );
}
