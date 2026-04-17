import { Undo2 } from 'lucide-react';

// Top-right corner indicator (ERD §5.3.1 + D6 + E1). Always on when there
// are uncommitted session changes. Clicking the ⤺ arrow rolls back the
// whole session; hovering shows tooltip "15 min 无动作后自动归档".

interface Props {
  changeCount: number;
}

export function EditSessionIndicator({ changeCount }: Props) {
  if (changeCount === 0) {
    return (
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        无改动
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-secondary">
        <span className="text-ink-primary tabular-nums">{changeCount}</span> 处改动
      </span>
      <button
        type="button"
        title="撤销本次编辑（15 min 无动作后本会话自动归档）"
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        <Undo2 className="h-3 w-3" strokeWidth={1.8} />
        撤销本次编辑
      </button>
    </div>
  );
}
