import * as RadixPopover from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { MarkdownView } from './MarkdownField';

// ------------------------------------------------------------------
// `NoteHoverPopover` — Markdown-capable hover preview. Used by
// CycleCell pill hover when a task has a note (tooltip couldn't
// render structured Markdown) and by RailCard's `· 备注` badge.
//
// Radix popover defaults to click-trigger — we hand-roll hover via
// onMouseEnter / onMouseLeave with open + close delays so the
// pointer can traverse the gap between trigger and popover without
// the panel flickering shut.
// ------------------------------------------------------------------

const OPEN_DELAY = 200;
const CLOSE_DELAY = 200;

export interface NoteHoverPopoverProps {
  /** The Markdown source. Empty string hides the popover entirely. */
  note: string | undefined;
  /** Trigger element — cloned with hover handlers and a ref. */
  children: ReactElement;
  /** Optional header block (meta row). Rendered above the Markdown. */
  header?: ReactNode;
  /** Optional footer block (e.g. sub-items list). Rendered below. */
  footer?: ReactNode;
  /** Radix `side` / `align` forwarded to PopoverContent. */
  side?: RadixPopover.PopoverContentProps['side'];
  align?: RadixPopover.PopoverContentProps['align'];
  /** Override the default 360 x 280 body cap. */
  maxWidth?: number;
  maxHeight?: number;
}

export function NoteHoverPopover({
  note,
  children,
  header,
  footer,
  side = 'top',
  align = 'center',
  maxWidth = 360,
  maxHeight = 280,
}: NoteHoverPopoverProps) {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const hasNote = !!note && note.trim().length > 0;
  if (!hasNote) return children;

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>
        <span
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onFocus={scheduleOpen}
          onBlur={scheduleClose}
          className="contents"
        >
          {children}
        </span>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={clearTimers}
          onMouseLeave={scheduleClose}
          className={clsx(
            'z-50 flex flex-col gap-2 rounded-md bg-surface-1 p-3 text-ink-primary',
            'shadow-[0_0_0_0.5px_theme(colors.hairline),0_8px_24px_-12px_rgba(0,0,0,0.18)]',
            'outline-none',
            'data-[state=open]:animate-[popoverIn_160ms_cubic-bezier(0.22,0.61,0.36,1)]',
          )}
          style={{ maxWidth }}
        >
          {header && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {header}
            </div>
          )}
          <div
            className="overflow-y-auto"
            style={{ maxHeight }}
          >
            <MarkdownView source={note!} />
          </div>
          {footer && (
            <div className="border-t border-hairline/60 pt-2">{footer}</div>
          )}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
