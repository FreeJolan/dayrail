import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Plus, X } from 'lucide-react';

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

export type ToastAction = 'done' | 'defer' | 'archive' | 'reschedule';

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

const ANIM_MS = 200;

export function ReasonToast({ state, onAddTag, onUndo, onClose }: Props) {
  const [appliedTags, setAppliedTags] = useState<string[]>([]);
  // Custom-tag input state. `null` = not in input mode; string = the
  // current input value (may be empty while the user is still typing).
  const [customInput, setCustomInput] = useState<string | null>(null);
  // `cached` lags the prop by one exit-animation window so the toast
  // stays mounted long enough to fade out; `visible` drives the CSS
  // transition on/off. Both together give us a declarative enter +
  // exit without pulling in a motion library.
  const [cached, setCached] = useState<ReasonToastState | null>(state);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armAutoClose = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onClose, TIMEOUT_MS);
  };
  const clearAutoClose = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Reset + re-arm the countdown each time a new action fires the toast.
  useEffect(() => {
    if (!state) return;
    setAppliedTags([]);
    setCustomInput(null);
    armAutoClose();
    return clearAutoClose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onClose]);

  // Drive the enter / exit animation by lagging `cached` one animation
  // window behind `state`. Mounting: sync cached, RAF to trigger the
  // transition into visible=true on the next paint. Unmounting: flip
  // visible=false immediately, keep cached until the exit animation
  // finishes, then drop it so the portal unmounts.
  useEffect(() => {
    if (state) {
      setCached(state);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const id = window.setTimeout(() => setCached(null), ANIM_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  // Esc closes the toast, EXCEPT while the custom-tag input is active —
  // there Esc should just exit input mode (the input's own onKeyDown
  // handles that). We read the current mode via ref so this listener
  // stays stable across keystrokes.
  const customActiveRef = useRef(false);
  customActiveRef.current = customInput !== null;
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !customActiveRef.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  // Always show 3 chips: history-top-N first (can be 0..3) and fill
  // the rest from the static fallback, deduped. Prevents "I tagged
  // <one tag> once and now that's the only option" — which the all-
  // or-nothing branch introduced.
  //
  // NB: this useMemo must live BEFORE any early-return or React's
  // rules-of-hooks will flag a conditional hook call when `cached`
  // transitions between null and non-null.
  const recommended = cached?.recommendedTags;
  const chips = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (tag: string): void => {
      if (seen.has(tag) || out.length >= 3) return;
      seen.add(tag);
      out.push(tag);
    };
    for (const t of recommended ?? []) push(t);
    for (const t of FALLBACK_TAGS) push(t);
    return out;
  }, [recommended]);

  if (typeof document === 'undefined' || !cached) return null;

  const handleChip = (tag: string): void => {
    const normalized = tag.trim();
    if (!normalized || appliedTags.includes(normalized)) return;
    setAppliedTags((prev) => [...prev, normalized]);
    onAddTag(normalized);
    // Picking a tag ends the toast's job — dismiss quickly after a
    // brief visual confirm so the user sees the chip highlight.
    clearAutoClose();
    timerRef.current = setTimeout(onClose, 220);
  };

  const enterCustom = (): void => {
    // While the user is typing, the 6s auto-close would race them.
    clearAutoClose();
    setCustomInput('');
  };

  const exitCustom = (): void => {
    setCustomInput(null);
    // Resume the countdown from a fresh 6s window — the user might
    // still pick a fallback chip.
    armAutoClose();
  };

  const submitCustom = (): void => {
    const raw = customInput ?? '';
    const tag = raw.trim();
    if (!tag) {
      exitCustom();
      return;
    }
    setCustomInput(null);
    handleChip(tag);
  };

  // Done actions don't need chips — there's no Shift to tag and nothing
  // to "explain". Keep the toast to a confirmation + Undo so the happy-
  // path finish feels frictionless.
  const showChips = cached.action !== 'done';
  // Reschedule doesn't show Undo: the schedule mutation already
  // committed and the inverse is "drag it back", not a toast button.
  // The archive-recurring hint also doesn't apply.
  const showUndo = cached.action !== 'reschedule';

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
      <div
        role="status"
        aria-live="polite"
        className={clsx(
          'pointer-events-auto flex max-w-[640px] items-center gap-3 rounded-md border border-hairline/40 bg-surface-3 px-4 py-3 text-sm text-ink-primary shadow-[0_8px_24px_-12px_rgba(30,28,26,0.25)]',
          'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
          visible
            ? 'translate-y-0 opacity-100'
            : 'translate-y-3 opacity-0',
        )}
      >
        <span className="shrink-0">
          <span className="font-medium">{headline(cached.action)}</span>
          <span className="ml-2 text-ink-secondary">「{cached.railName}」</span>
        </span>
        {showChips && (
          <>
            <span className="h-4 w-px bg-hairline/40" aria-hidden />
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
                        : 'bg-surface-1 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
              {customInput === null ? (
                <button
                  type="button"
                  onClick={enterCustom}
                  aria-label="添加自定义原因"
                  title="添加自定义原因"
                  className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-sm border border-dashed border-hairline/60 text-ink-tertiary transition hover:border-ink-tertiary hover:text-ink-secondary"
                >
                  <Plus className="h-3 w-3" strokeWidth={1.8} />
                </button>
              ) : (
                <input
                  autoFocus
                  value={customInput}
                  placeholder="原因…"
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    // IME composition guard — Enter during pinyin
                    // candidate selection shouldn't submit the tag.
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submitCustom();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      exitCustom();
                    }
                  }}
                  onBlur={exitCustom}
                  maxLength={24}
                  className="h-[22px] w-24 rounded-sm border border-hairline/60 bg-surface-0 px-1.5 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-primary"
                />
              )}
            </span>
          </>
        )}
        {showUndo && (
          <>
            <span className="h-4 w-px bg-hairline/40" aria-hidden />
            <button
              type="button"
              onClick={() => {
                onUndo();
                onClose();
              }}
              className="text-xs font-medium text-ink-secondary underline-offset-2 hover:text-ink-primary hover:underline"
            >
              撤销
            </button>
          </>
        )}
        {cached.action === 'archive' && cached.isRecurring && (
          <>
            <span className="h-4 w-px bg-hairline/40" aria-hidden />
            <span className="text-xs text-ink-tertiary">明天的仍会生成</span>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="ml-1 rounded-sm p-1 text-ink-tertiary transition hover:text-ink-primary"
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
    case 'reschedule':
      return '已改期';
  }
}
