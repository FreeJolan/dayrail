import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X } from 'lucide-react';

// §5.2 Reason toast — the lightweight replacement for the old Shift-tag
// sheet. Slides in after a check-in action, offers 3 quick-reason tag
// chips + Undo, auto-dismisses after TIMEOUT_MS.
//
// Design rules:
// - Default path is zero friction — action is already applied when the
//   toast appears. The toast is *optional* annotation, not a modal.
// - Chip click adds a tag and keeps the toast alive through the
//   countdown (the user might pick a second tag). It doesn't reset the
//   clock — a fresh 6s window per chip would feel like nagging.
// - Undo rolls back the action entirely (caller's concern).
// - Esc / X closes the toast without further changes.

const TIMEOUT_MS = 6_000;

const FALLBACK_TAGS = ['天气', '太累', '会议'];

export type ToastAction = 'done' | 'defer' | 'archive';

export interface ReasonToastState {
  action: ToastAction;
  instanceId: string;
  railName: string;
  /** True when the Rail recurs daily / on weekdays / etc. Used to
   *  surface a "tomorrow's one will still be generated" hint after
   *  `archive`. */
  isRecurring?: boolean;
  recommendedTags?: string[];
}

interface Props {
  state: ReasonToastState | null;
  onAddTag: (tag: string) => void;
  onUndo: () => void;
  onClose: () => void;
}

export function ReasonToast({ state, onAddTag, onUndo, onClose }: Props) {
  const [appliedTags, setAppliedTags] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset + re-arm the countdown each time a new action fires the toast.
  useEffect(() => {
    if (!state) return;
    setAppliedTags([]);
    timerRef.current = setTimeout(onClose, TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state, onClose]);

  // Esc closes the toast.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  if (typeof document === 'undefined' || !state) return null;

  const chips =
    state.recommendedTags && state.recommendedTags.length > 0
      ? state.recommendedTags.slice(0, 3)
      : FALLBACK_TAGS;

  const handleChip = (tag: string): void => {
    if (appliedTags.includes(tag)) return;
    setAppliedTags((prev) => [...prev, tag]);
    onAddTag(tag);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex max-w-[640px] items-center gap-3 rounded-md bg-ink-primary px-4 py-3 text-sm text-surface-0 shadow-xl"
      >
        <span className="shrink-0">
          <span className="font-medium">{headline(state.action)}</span>
          <span className="ml-2 text-surface-0/70">
            「{state.railName}」
          </span>
        </span>
        <span className="h-4 w-px bg-surface-0/25" aria-hidden />
        <span className="flex items-center gap-1.5">
          {chips.map((tag) => {
            const applied = appliedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => handleChip(tag)}
                className={clsx(
                  'rounded-sm px-2 py-0.5 text-xs font-medium transition',
                  applied
                    ? 'bg-cta text-cta-foreground'
                    : 'bg-surface-0/15 text-surface-0 hover:bg-surface-0/25',
                )}
              >
                {tag}
              </button>
            );
          })}
        </span>
        <span className="h-4 w-px bg-surface-0/25" aria-hidden />
        <button
          type="button"
          onClick={() => {
            onUndo();
            onClose();
          }}
          className="text-xs font-medium text-surface-0 underline-offset-2 hover:underline"
        >
          撤销
        </button>
        {state.action === 'archive' && state.isRecurring && (
          <>
            <span className="h-4 w-px bg-surface-0/25" aria-hidden />
            <span className="text-xs text-surface-0/70">
              明天的仍会生成
            </span>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="ml-1 rounded-sm p-1 text-surface-0/70 transition hover:text-surface-0"
        >
          <X className="h-3 w-3" strokeWidth={1.6} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

function headline(action: ToastAction): string {
  switch (action) {
    case 'done':
      return '已完成';
    case 'defer':
      return '以后再说';
    case 'archive':
      return '已归档';
  }
}
