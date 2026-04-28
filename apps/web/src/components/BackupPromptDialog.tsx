import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, X } from 'lucide-react';

// §13.8 — secondary confirmation before an upgrade. Three branches +
// a "remember my choice" checkbox. The dialog is dumb on purpose:
// it owns layout, focus, and Escape; all preference + upgrade work
// lives in `useUpgradeFlow` so the same dialog can be driven from
// both the top banner and Settings.

interface Props {
  open: boolean;
  /** Bound to the "Remember my choice" checkbox. The hook owns the
   *  state so the value survives a re-render and can be read at click
   *  time. Unchecked by default — see ERD §13.8. */
  remember: boolean;
  onRememberChange: (next: boolean) => void;
  onBackupAndUpgrade: () => void;
  onUpgradeOnly: () => void;
  onCancel: () => void;
  /** Disable the action buttons while the backup-then-upgrade chain
   *  is mid-flight (download triggered, 250ms tick, reload pending).
   *  Prevents double-clicks during the brief visible window. */
  busy?: boolean;
}

export function BackupPromptDialog({
  open,
  remember,
  onRememberChange,
  onBackupAndUpgrade,
  onUpgradeOnly,
  onCancel,
  busy = false,
}: Props) {
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  // Focus the primary CTA on open so keyboard users land on the
  // recommended path. We focus on the next frame to let the portal
  // mount + transition apply first.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      primaryRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Escape closes the dialog as Cancel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="取消"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-ink-primary/30 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-prompt-title"
        aria-describedby="backup-prompt-body"
        className="relative w-full max-w-sm rounded-lg border border-hairline/60 bg-surface-1 p-5 shadow-[0_0_0_0.5px_theme(colors.hairline),0_24px_48px_-16px_rgba(0,0,0,0.32)]"
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="关闭"
          className="absolute right-3 top-3 rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>

        <h2
          id="backup-prompt-title"
          className="pr-6 text-sm font-semibold text-ink-primary"
        >
          升级前备份？
        </h2>
        <p
          id="backup-prompt-body"
          className="mt-2 text-xs leading-relaxed text-ink-secondary"
        >
          新版本已就绪。是否在升级前先把当前数据导出一份到本地？
          <br />
          数据本就保存在浏览器中，备份是额外的一份保险。
        </p>

        <label className="mt-4 flex items-center gap-2 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => onRememberChange(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-cta"
          />
          <span className="cursor-pointer select-none">记住我的选择</span>
          <span className="text-2xs text-ink-tertiary">
            （之后可在「设置 · 关于」中改回）
          </span>
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onUpgradeOnly}
            disabled={busy}
            className="rounded-md border border-hairline/60 bg-surface-0 px-3 py-1.5 text-xs text-ink-primary transition hover:border-ink-tertiary hover:bg-surface-1 disabled:opacity-60"
          >
            直接升级
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={onBackupAndUpgrade}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-cta px-3 py-1.5 text-xs font-medium text-cta-foreground transition hover:bg-cta-hover disabled:opacity-60"
          >
            {busy ? (
              <Check className="h-3 w-3" strokeWidth={2} />
            ) : (
              <Download className="h-3 w-3" strokeWidth={2} />
            )}
            {busy ? '正在备份…' : '备份并升级'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
