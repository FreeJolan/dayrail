import { ArrowUp, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useVersionUpdate } from '@/lib/swRegistration';

// ------------------------------------------------------------------
// Top-of-page banner that surfaces a pending SW update + a one-time
// offline-ready toast. ERD §13.3 / §13.6.
//
// Behaviour summary:
//   • `needsRefresh` drives the primary banner. "Update now" commits
//     the waiting SW and reloads; "Later" suppresses for this session.
//   • `offlineReady` (fires on first SW install) drops a one-time
//     bottom-right toast that auto-dismisses after 5s.
// ------------------------------------------------------------------

const OFFLINE_TOAST_MS = 5000;

export function UpdateBanner() {
  const { needsRefresh, update, dismiss, offlineReady, dismissOfflineReady } =
    useVersionUpdate();
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!offlineReady) return;
    const t = window.setTimeout(dismissOfflineReady, OFFLINE_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [offlineReady, dismissOfflineReady]);

  const handleUpdate = async () => {
    setUpdating(true);
    await update();
    // `update()` triggers a reload on success, so this state rarely
    // matters after the call. Guard against the no-SW edge case by
    // flipping it back so the button is usable again.
    setUpdating(false);
  };

  return (
    <>
      {needsRefresh && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-cta/30 bg-cta-soft/80 px-4 py-2 text-sm backdrop-blur"
        >
          <ArrowUp className="h-4 w-4 text-cta" strokeWidth={2} />
          <span className="text-ink-primary">
            新版本已就绪 · 刷新后立即生效
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUpdate}
              disabled={updating}
              className="inline-flex items-center gap-1 rounded-md bg-cta px-3 py-1 text-xs font-medium text-cta-foreground transition hover:bg-cta-hover disabled:opacity-60"
            >
              <Check className="h-3 w-3" strokeWidth={2} />
              {updating ? '正在更新…' : '立即更新'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-3 py-1 text-xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              稍后
            </button>
          </div>
        </div>
      )}
      {offlineReady && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-md bg-surface-1 px-3 py-2 text-xs text-ink-primary shadow-[0_0_0_0.5px_theme(colors.hairline),0_8px_24px_-12px_rgba(0,0,0,0.18)] data-[state=open]:animate-[popoverIn_160ms_cubic-bezier(0.22,0.61,0.36,1)]"
        >
          <Check className="h-3.5 w-3.5 text-cta" strokeWidth={2} />
          <span>已可离线使用</span>
          <button
            type="button"
            onClick={dismissOfflineReady}
            aria-label="关闭"
            className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <X className="h-3 w-3" strokeWidth={1.8} />
          </button>
        </div>
      )}
    </>
  );
}
