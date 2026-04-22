import * as RadixDialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { Maximize2, Undo2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

// ------------------------------------------------------------------
// `MarkdownField` — shared display + edit surface for long-form
// Markdown fields (Line.note / Task.note). ERD §5.5.4.
//
//   Display state : ReactMarkdown renders `value`, or an empty-state
//                   placeholder if value is empty.
//   Edit state    : Markdown-aware textarea. Tab/Shift+Tab indent,
//                   Enter continues list/quote prefixes, Cmd+B/I wrap
//                   selection, Cmd+Enter commits, Esc discards.
//   Fullscreen    : Maximize icon (or Cmd+Shift+E) opens a Radix Dialog
//                   with a split-pane editor + live preview. Cmd+P
//                   toggles the preview pane; closing the dialog (X /
//                   backdrop / Esc / Cmd+Enter) commits pending edits.
// ------------------------------------------------------------------

export interface MarkdownFieldProps {
  value: string | undefined;
  onCommit: (next: string | undefined) => void;
  /** Placeholder copy for the empty state (e.g. `+ 添加描述`). */
  placeholder: string;
  /** Copy shown as the fullscreen Dialog's header (e.g. `Project 描述`). */
  dialogTitle: string;
  /** Aria label for the display region / edit textarea. */
  ariaLabel?: string;
  /** Display-mode max-height hint. Undefined = no cap. */
  displayMaxHeight?: string;
}

export function MarkdownField({
  value,
  onCommit,
  placeholder,
  dialogTitle,
  ariaLabel,
  displayMaxHeight,
}: MarkdownFieldProps) {
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  // Sync draft when the source value changes externally (e.g. another
  // surface edited the same record, or user switched to a different
  // task without unmounting the drawer).
  useEffect(() => {
    if (!editing && !dialogOpen) setDraft(value ?? '');
  }, [value, editing, dialogOpen]);

  const commit = useCallback(
    (next: string) => {
      const trimmed = next.replace(/\s+$/g, '');
      const normalized = trimmed === '' ? undefined : trimmed;
      if (normalized === (value ?? undefined)) return;
      onCommit(normalized);
    },
    [onCommit, value],
  );

  const beginEdit = useCallback(() => {
    setDraft(value ?? '');
    setEditing(true);
  }, [value]);

  const commitInPlace = useCallback(() => {
    commit(draft);
    setEditing(false);
  }, [commit, draft]);

  const discardInPlace = useCallback(() => {
    setDraft(value ?? '');
    setEditing(false);
  }, [value]);

  const openDialog = useCallback(() => {
    setDraft((prev) => (editing ? prev : value ?? ''));
    setEditing(false);
    setDialogOpen(true);
  }, [editing, value]);

  const commitDialog = useCallback(
    (nextValue: string) => {
      commit(nextValue);
      setDialogOpen(false);
    },
    [commit],
  );

  const discardDialog = useCallback(() => {
    setDraft(value ?? '');
    setDialogOpen(false);
  }, [value]);

  const hasValue = !!value && value.trim().length > 0;

  if (dialogOpen) {
    return (
      <>
        <InPlaceMirror
          value={draft}
          placeholder={placeholder}
          displayMaxHeight={displayMaxHeight}
        />
        <FullscreenEditor
          initialValue={draft}
          baselineValue={value ?? ''}
          title={dialogTitle}
          onCommit={commitDialog}
          onDiscard={discardDialog}
        />
      </>
    );
  }

  if (editing) {
    return (
      <InPlaceEditor
        value={draft}
        onChange={setDraft}
        onCommit={commitInPlace}
        onDiscard={discardInPlace}
        onOpenDialog={openDialog}
        ariaLabel={ariaLabel ?? dialogTitle}
      />
    );
  }

  if (!hasValue) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        aria-label={`${placeholder} · ${dialogTitle}`}
        className="flex w-full items-center justify-start rounded-md border border-dashed border-hairline/70 bg-transparent px-3 py-2 text-left text-xs text-ink-tertiary transition hover:border-ink-tertiary hover:bg-surface-1 hover:text-ink-secondary"
      >
        {placeholder}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      aria-label={ariaLabel ?? `Edit ${dialogTitle}`}
      className="block w-full rounded-md px-3 py-2 text-left transition hover:bg-surface-1/60"
      style={
        displayMaxHeight == null
          ? undefined
          : { maxHeight: displayMaxHeight, overflow: 'auto' }
      }
    >
      <MarkdownView source={value ?? ''} />
    </button>
  );
}

// ------------------------------------------------------------------
// InPlaceEditor — textarea + Maximize icon. Save-on-blur mirrors the
// HabitDetail / TaskDetailDrawer convention in this codebase.
// ------------------------------------------------------------------

function InPlaceEditor({
  value,
  onChange,
  onCommit,
  onDiscard,
  onOpenDialog,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onDiscard: () => void;
  onOpenDialog: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (markdownKeyHandler(e, onChange)) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onCommit();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onDiscard();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === 'e' || e.key === 'E')
      ) {
        e.preventDefault();
        onOpenDialog();
      }
    },
    [onChange, onCommit, onDiscard, onOpenDialog],
  );

  return (
    <div className="relative flex flex-col">
      <textarea
        ref={ref}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
        rows={6}
        className="resize-y rounded-md border border-hairline/60 bg-surface-0 px-3 py-2 pr-10 text-sm leading-relaxed text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
        placeholder="Markdown 支持:**粗体** · `代码` · - 列表 · > 引用 · ⌘⇧E 大屏"
      />
      {/* onMouseDown preventDefault so the textarea's blur doesn't
          race the dialog mount — otherwise edit mode collapses
          before the dialog can seed its draft. */}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onOpenDialog();
        }}
        aria-label="全屏编辑"
        title="全屏编辑 (⌘⇧E)"
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------
// FullscreenEditor — modal Dialog with split-pane editor + preview.
// ------------------------------------------------------------------

function FullscreenEditor({
  initialValue,
  baselineValue,
  title,
  onCommit,
  onDiscard,
}: {
  initialValue: string;
  baselineValue: string;
  title: string;
  onCommit: (next: string) => void;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const [splitOpen, setSplitOpen] = useState(true);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const dirty = draft !== baselineValue;

  // Dialog-level shortcuts (active regardless of focus within the
  // dialog). Esc is handled by Radix (→ onOpenChange false → commit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        onCommit(draft);
        return;
      }
      if (meta && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setSplitOpen((v) => !v);
        return;
      }
      if (meta && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        onCommit(draft);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [draft, onCommit]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onCommit(draft);
    },
    [draft, onCommit],
  );

  return (
    <RadixDialog.Root open onOpenChange={handleOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-primary/20 backdrop-blur-[1px] data-[state=open]:animate-[popoverIn_160ms_cubic-bezier(0.22,0.61,0.36,1)]" />
        <RadixDialog.Content
          aria-label={title}
          className="fixed left-1/2 top-1/2 z-50 flex h-[88vh] w-[min(1040px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md bg-surface-0 shadow-[0_0_0_0.5px_theme(colors.hairline),0_24px_72px_-24px_rgba(0,0,0,0.35)] data-[state=open]:animate-[popoverIn_200ms_cubic-bezier(0.22,0.61,0.36,1)]"
        >
          <DialogHeader
            title={title}
            splitOpen={splitOpen}
            dirty={dirty}
            onToggleSplit={() => setSplitOpen((v) => !v)}
            onDiscard={onDiscard}
            onClose={() => onCommit(draft)}
          />
          <div className="relative flex min-h-0 flex-1">
            <div
              className="flex min-h-0 flex-col"
              style={{ width: splitOpen ? `${splitRatio * 100}%` : '100%' }}
            >
              <FullscreenTextarea
                value={draft}
                onChange={setDraft}
                onDiscard={onDiscard}
                ariaLabel={title}
              />
            </div>
            {splitOpen && (
              <>
                <SplitDivider onChange={setSplitRatio} />
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-1/60 px-6 py-5">
                  <MarkdownView source={draft} />
                </div>
              </>
            )}
          </div>
          <DialogFooter splitOpen={splitOpen} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function DialogHeader({
  title,
  splitOpen,
  dirty,
  onToggleSplit,
  onDiscard,
  onClose,
}: {
  title: string;
  splitOpen: boolean;
  dirty: boolean;
  onToggleSplit: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-hairline/70 px-5 py-3">
      <RadixDialog.Title className="flex items-baseline gap-3">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Markdown
        </span>
        <span className="text-sm text-ink-primary">{title}</span>
      </RadixDialog.Title>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleSplit}
          className={clsx(
            'rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest transition',
            splitOpen
              ? 'bg-surface-2 text-ink-primary'
              : 'text-ink-tertiary hover:bg-surface-2 hover:text-ink-primary',
          )}
          title={splitOpen ? '只编辑 (⌘P)' : '分栏预览 (⌘P)'}
        >
          {splitOpen ? '👁 分栏' : '✎ 只编辑'}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={onDiscard}
            className="inline-flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:bg-warn/10 hover:text-warn"
            title="放弃改动并关闭"
          >
            <Undo2 className="h-3 w-3" strokeWidth={1.8} />
            放弃
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}

function DialogFooter({ splitOpen }: { splitOpen: boolean }) {
  return (
    <footer className="flex items-center gap-4 border-t border-hairline/70 px-5 py-2 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>⌘+Enter 保存</span>
      <span>Esc 关闭</span>
      <span>⌘+P {splitOpen ? '仅编辑' : '分栏'}</span>
    </footer>
  );
}

function FullscreenTextarea({
  value,
  onChange,
  onDiscard,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  onDiscard: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (markdownKeyHandler(e, onChange)) return;
      // Esc is intercepted by Radix Dialog and routed through
      // onOpenChange (= commit). Shift+Esc = explicit discard.
      if (e.key === 'Escape' && e.shiftKey) {
        e.preventDefault();
        onDiscard();
      }
    },
    [onChange, onDiscard],
  );

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      spellCheck={false}
      className="h-full flex-1 resize-none border-0 bg-surface-0 px-6 py-5 font-mono text-sm leading-[1.7] text-ink-primary outline-none"
    />
  );
}

function SplitDivider({
  onChange,
}: {
  onChange: (next: number) => void;
}) {
  const draggingRef = useRef(false);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let next = x / rect.width;
      if (next < 0.2) next = 0.2;
      if (next > 0.8) next = 0.8;
      onChange(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [onChange]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    hostRef.current = e.currentTarget.parentElement;
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="group relative w-px shrink-0 cursor-col-resize bg-hairline"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 -left-1 -right-1 block group-hover:bg-cta-soft/20"
      />
    </div>
  );
}

function InPlaceMirror({
  value,
  placeholder,
  displayMaxHeight,
}: {
  value: string;
  placeholder: string;
  displayMaxHeight?: string;
}) {
  const hasValue = value.trim().length > 0;
  if (!hasValue) {
    return (
      <div className="flex w-full items-center justify-start rounded-md border border-dashed border-hairline/40 px-3 py-2 text-xs text-ink-tertiary opacity-50">
        {placeholder}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="w-full rounded-md opacity-50"
      style={
        displayMaxHeight == null
          ? undefined
          : { maxHeight: displayMaxHeight, overflow: 'hidden' }
      }
    >
      <MarkdownView source={value} />
    </div>
  );
}

// ------------------------------------------------------------------
// MarkdownView — shared renderer; exported so NoteHoverPopover can
// reuse without dragging in the whole field.
// ------------------------------------------------------------------

export function MarkdownView({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  return (
    <div className={clsx('dr-prose', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}

const REMARK_PLUGINS = [remarkGfm];

// ------------------------------------------------------------------
// markdownKeyHandler — shared Markdown-aware key bindings (Tab /
// Shift+Tab indent, Enter list continuation, Cmd+B / Cmd+I wrap).
// Returns `true` when handled (preventDefault already called) so the
// caller can chain contextual shortcuts (Esc, Cmd+Enter, …).
// ------------------------------------------------------------------

function markdownKeyHandler(
  e: ReactKeyboardEvent<HTMLTextAreaElement>,
  onChange: (next: string) => void,
): boolean {
  const el = e.currentTarget;
  const value = el.value;
  const start = el.selectionStart;
  const end = el.selectionEnd;

  if (e.key === 'Tab') {
    e.preventDefault();
    if (start === end) {
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const stripped = stripIndent(value.slice(lineStart));
        if (stripped.removed === 0) return true;
        const next =
          value.slice(0, lineStart) +
          stripped.text +
          value.slice(lineStart + stripped.removed);
        onChange(next);
        queueCaret(el, start - stripped.removed);
        return true;
      }
      const next = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      queueCaret(el, start + 2);
      return true;
    }
    const rangeStart = value.lastIndexOf('\n', start - 1) + 1;
    const rangeEnd = end;
    const block = value.slice(rangeStart, rangeEnd);
    const transformed = e.shiftKey
      ? block
          .split('\n')
          .map((ln) => stripIndent(ln).text)
          .join('\n')
      : block
          .split('\n')
          .map((ln) => '  ' + ln)
          .join('\n');
    const nextValue =
      value.slice(0, rangeStart) + transformed + value.slice(rangeEnd);
    onChange(nextValue);
    const delta = transformed.length - block.length;
    queueSelection(el, rangeStart, rangeEnd + delta);
    return true;
  }

  if (
    (e.metaKey || e.ctrlKey) &&
    !e.shiftKey &&
    (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')
  ) {
    e.preventDefault();
    const wrap = e.key === 'b' || e.key === 'B' ? '**' : '*';
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + wrap + selected + wrap + value.slice(end);
    onChange(next);
    if (start === end) queueCaret(el, start + wrap.length);
    else queueSelection(el, start + wrap.length, end + wrap.length);
    return true;
  }

  if (
    e.key === 'Enter' &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  ) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineToCaret = value.slice(lineStart, start);
    const prefix = parseListPrefix(lineToCaret);
    if (prefix == null) return false;

    const afterPrefix = lineToCaret.slice(prefix.raw.length);
    if (afterPrefix.trim() === '') {
      // Empty list/quote line → strip the prefix and break out.
      e.preventDefault();
      const next = value.slice(0, lineStart) + value.slice(start);
      onChange(next);
      queueCaret(el, lineStart);
      return true;
    }

    e.preventDefault();
    const insertion = '\n' + nextListPrefix(prefix);
    const next = value.slice(0, start) + insertion + value.slice(end);
    onChange(next);
    queueCaret(el, start + insertion.length);
    return true;
  }

  return false;
}

function stripIndent(line: string): { text: string; removed: number } {
  if (line.startsWith('  ')) return { text: line.slice(2), removed: 2 };
  if (line.startsWith(' ')) return { text: line.slice(1), removed: 1 };
  if (line.startsWith('\t')) return { text: line.slice(1), removed: 1 };
  return { text: line, removed: 0 };
}

interface ListPrefix {
  raw: string;
  indent: string;
  kind: 'ul' | 'ol' | 'quote' | 'task';
  ordered?: number;
  taskMarker?: string;
}

function parseListPrefix(lineToCaret: string): ListPrefix | null {
  const task = /^(\s*)([-*])\s\[([ xX])\]\s/.exec(lineToCaret);
  if (task) {
    return {
      raw: task[0]!,
      indent: task[1]!,
      kind: 'task',
      taskMarker: task[2]!,
    };
  }
  const ul = /^(\s*)[-*]\s/.exec(lineToCaret);
  if (ul) return { raw: ul[0]!, indent: ul[1]!, kind: 'ul' };
  const ol = /^(\s*)(\d+)\.\s/.exec(lineToCaret);
  if (ol) {
    return {
      raw: ol[0]!,
      indent: ol[1]!,
      kind: 'ol',
      ordered: Number.parseInt(ol[2]!, 10),
    };
  }
  const quote = /^(\s*)>\s?/.exec(lineToCaret);
  if (quote) return { raw: quote[0]!, indent: quote[1]!, kind: 'quote' };
  return null;
}

function nextListPrefix(prev: ListPrefix): string {
  switch (prev.kind) {
    case 'ul':
      return `${prev.indent}- `;
    case 'task':
      return `${prev.indent}${prev.taskMarker ?? '-'} [ ] `;
    case 'ol':
      return `${prev.indent}${(prev.ordered ?? 1) + 1}. `;
    case 'quote':
      return `${prev.indent}> `;
  }
}

// Caret placement has to wait for React to flush the onChange → value
// swap; otherwise the textarea resets the caret to the end of the
// new text.
function queueCaret(el: HTMLTextAreaElement, pos: number) {
  requestAnimationFrame(() => el.setSelectionRange(pos, pos));
}

function queueSelection(el: HTMLTextAreaElement, s: number, e: number) {
  requestAnimationFrame(() => el.setSelectionRange(s, e));
}
