import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X, SkipForward, Clock, Replace, StickyNote } from 'lucide-react';
import type { ShiftType } from '@dayrail/core';

// §5.2 unified Shift sheet — the one collection point for Skip / Postpone
// / Replace / Add note. Desktop: right-side 320px panel slides in from
// the right. (Mobile bottom drawer is a v0.3 concern.)
//
// Tag recommender uses the Rail's historical frequency (top-3 + "其它");
// until the tag library is populated we render a single placeholder chip.
// The user can always skip tags — the empty sheet is explicitly
// allowed per ERD "No guilt design" §9.

const REASON_MAX = 500;
const REASON_WARN_BELOW = 50;

export interface ShiftSubmission {
  type: ShiftType;
  tags: string[];
  reason?: string;
  /** Postpone only — minutes to push plannedStart forward. */
  postponeMinutes?: number;
}

interface Props {
  open: boolean;
  railName: string;
  initialType?: ShiftType;
  /** Existing tags we can recommend for this Rail, highest-frequency
   *  first. Falls back to a static set if empty. */
  recommendedTags?: string[];
  onClose: () => void;
  onSubmit: (submission: ShiftSubmission) => void;
}

const TYPE_OPTIONS: Array<{
  type: ShiftType;
  label: string;
  icon: typeof SkipForward;
}> = [
  { type: 'skip', label: '跳过', icon: SkipForward },
  { type: 'postpone', label: '延后', icon: Clock },
  { type: 'replace', label: '替换', icon: Replace },
  { type: 'note', label: '记一笔', icon: StickyNote },
];

const POSTPONE_OPTIONS = [15, 30, 60];

const FALLBACK_TAGS = ['天气', '太累', '会议'];

export function ShiftSheet({
  open,
  railName,
  initialType = 'skip',
  recommendedTags,
  onClose,
  onSubmit,
}: Props) {
  const [type, setType] = useState<ShiftType>(initialType);
  const [tags, setTags] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [postponeMinutes, setPostponeMinutes] = useState<number>(30);

  // Reset form on open — a re-opened sheet shouldn't inherit the last
  // session's draft.
  useEffect(() => {
    if (open) {
      setType(initialType);
      setTags([]);
      setReason('');
      setPostponeMinutes(30);
    }
  }, [open, initialType]);

  // Esc to close, backdrop click too. Focus is moved to the textarea
  // on open so the user can start typing — full focus-trap is a v0.3
  // accessibility follow-up.
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const chipCandidates = useMemo(
    () => (recommendedTags && recommendedTags.length > 0 ? recommendedTags : FALLBACK_TAGS),
    [recommendedTags],
  );

  if (typeof document === 'undefined' || !open) return null;

  const remaining = REASON_MAX - reason.length;
  const canSubmit = type !== 'replace'; // Replace needs sub-flow; v0.3.

  const submit = (): void => {
    const trimmed = reason.trim();
    const submission: ShiftSubmission = {
      type,
      tags,
      reason: trimmed.length > 0 ? trimmed : undefined,
    };
    if (type === 'postpone') submission.postponeMinutes = postponeMinutes;
    onSubmit(submission);
  };

  const toggleTag = (t: string): void => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  return createPortal(
    <div
      aria-hidden={!open}
      className="fixed inset-0 z-50 flex items-stretch justify-end"
    >
      <button
        type="button"
        aria-label="关闭 Shift 面板"
        onClick={onClose}
        className="absolute inset-0 bg-ink-primary/30 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-label={`${primaryButtonLabel(type)}「${railName}」`}
        className="relative flex h-full w-full max-w-[360px] flex-col bg-surface-0 shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Shift
            </span>
            <h2 className="truncate text-sm font-medium text-ink-primary">
              {primaryButtonLabel(type)}「{railName}」
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <X className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <SectionLabel>动作</SectionLabel>
          <TypePicker value={type} onChange={setType} />

          {type === 'postpone' && (
            <div className="mt-4">
              <SectionLabel>延后</SectionLabel>
              <div className="mt-2 flex flex-wrap gap-2">
                {POSTPONE_OPTIONS.map((m) => (
                  <Chip
                    key={m}
                    selected={postponeMinutes === m}
                    onClick={() => setPostponeMinutes(m)}
                  >
                    +{m}min
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {type === 'replace' && (
            <p className="mt-4 rounded-sm bg-surface-2 px-3 py-2 text-xs text-ink-tertiary">
              Replace 的 Ad-hoc 流程 v0.3 接入。暂时无法确认。
            </p>
          )}

          <div className="mt-6">
            <SectionLabel>快速原因</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {chipCandidates.map((t) => (
                <Chip
                  key={t}
                  selected={tags.includes(t)}
                  onClick={() => toggleTag(t)}
                >
                  {t}
                </Chip>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <SectionLabel>备注（可选）</SectionLabel>
              <span
                className={clsx(
                  'font-mono text-2xs tabular-nums',
                  remaining < REASON_WARN_BELOW ? 'text-warn' : 'text-ink-tertiary',
                )}
              >
                {remaining}
              </span>
            </div>
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(e) =>
                setReason(e.target.value.slice(0, REASON_MAX))
              }
              placeholder="这次偏离的背景…（可跳过）"
              rows={4}
              className="mt-2 w-full resize-none rounded-sm bg-surface-1 px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-tertiary focus:bg-surface-2"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-3 py-1.5 text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className={clsx(
              'rounded-sm px-3 py-1.5 text-sm font-medium transition',
              canSubmit
                ? 'bg-ink-primary text-surface-0 hover:bg-ink-secondary'
                : 'cursor-not-allowed bg-surface-2 text-ink-tertiary',
            )}
          >
            {primaryButtonLabel(type)}
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function primaryButtonLabel(type: ShiftType): string {
  switch (type) {
    case 'skip':
      return '跳过';
    case 'postpone':
      return '延后';
    case 'replace':
      return '替换';
    case 'note':
      return '记一笔';
    default:
      return '确认';
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      {children}
    </span>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: ShiftType;
  onChange: (t: ShiftType) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {TYPE_OPTIONS.map(({ type, label, icon: Icon }) => {
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={clsx(
              'flex items-center gap-2 rounded-sm border px-3 py-2 text-left text-sm transition',
              selected
                ? 'border-ink-primary bg-surface-2 text-ink-primary'
                : 'border-hairline bg-surface-0 text-ink-secondary hover:border-ink-tertiary hover:text-ink-primary',
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Chip({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-sm px-2.5 py-1 text-xs font-medium transition',
        selected
          ? 'bg-ink-primary text-surface-0'
          : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
      )}
    >
      {children}
    </button>
  );
}
