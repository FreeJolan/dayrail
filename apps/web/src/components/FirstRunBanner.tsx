import { useState } from 'react';
import { X, Info } from 'lucide-react';

// ERD §5.4 E1: the dismissible inline banner shown the first time a user
// enters the Template Editor, explaining the no-save model.

export function FirstRunBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <aside
      role="note"
      className="flex items-start gap-3 rounded-md bg-surface-1 px-4 py-3 text-sm text-ink-secondary"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.6} />
      <div className="flex-1">
        <span className="text-ink-primary">改动即时保存。</span>{' '}
        想反悔？点{' '}
        <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-primary">
          ⤺ 撤销本次编辑
        </span>{' '}
        —— 一次回退本次会话的所有改动（15 min 无动作后本会话自动归档）。
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="关闭提示"
        className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-secondary"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </aside>
  );
}
