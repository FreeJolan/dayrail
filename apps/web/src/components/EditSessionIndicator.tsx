import { Undo2 } from 'lucide-react';

// Top-right corner indicator (ERD §5.3.1 + D6 + E1). Always on when there
// are uncommitted session changes. Clicking the ⤺ arrow rolls back the
// whole session; hovering shows a tooltip explaining the 15-min idle
// auto-close.

interface Props {
  changeCount: number;
  onUndo?: () => void;
}

export function EditSessionIndicator({ changeCount, onUndo }: Props) {
  if (changeCount === 0) {
    return (
      <span className="text-xs text-ink-tertiary">无改动</span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-secondary">
        <span className="font-mono tabular-nums text-ink-primary">
          {changeCount}
        </span>{' '}
        处改动
      </span>
      <button
        type="button"
        onClick={onUndo}
        title="撤销本次编辑（15 min 无动作后本会话自动归档）"
        className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        <Undo2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        撤销本次编辑
      </button>
    </div>
  );
}
