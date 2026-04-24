import * as RadixHoverCard from '@radix-ui/react-hover-card';
import { clsx } from 'clsx';
import type { ReactElement, ReactNode } from 'react';
import { MarkdownView } from './MarkdownField';

// ------------------------------------------------------------------
// `NoteHoverPopover` — Markdown-capable hover preview. Used by
// CycleCell pill hover when a task has a note (tooltip couldn't
// render structured Markdown) and by RailCard's `· 备注` badge.
//
// Built on `@radix-ui/react-hover-card` (not `react-popover`) so the
// component can be safely nested inside another Popover Root without
// the outer Popover's Trigger binding to this one via React context.
// Earlier revisions used a second Popover.Root here, which caused a
// nested <PopoverTrigger> inside this component to toggle the note
// hover state instead of the intended outer action popover.
// ------------------------------------------------------------------

const OPEN_DELAY = 200;
const CLOSE_DELAY = 200;

export interface NoteHoverPopoverProps {
  /** The Markdown source. Empty string hides the popover entirely. */
  note: string | undefined;
  /** Trigger element — wrapped by HoverCard.Trigger (asChild). */
  children: ReactElement;
  /** Optional header block (meta row). Rendered above the Markdown. */
  header?: ReactNode;
  /** Optional footer block (e.g. sub-items list). Rendered below. */
  footer?: ReactNode;
  /** Radix `side` / `align` forwarded to HoverCard.Content. */
  side?: RadixHoverCard.HoverCardContentProps['side'];
  align?: RadixHoverCard.HoverCardContentProps['align'];
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
  const hasNote = !!note && note.trim().length > 0;
  if (!hasNote) return children;

  return (
    <RadixHoverCard.Root openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY}>
      <RadixHoverCard.Trigger asChild>{children}</RadixHoverCard.Trigger>
      <RadixHoverCard.Portal>
        <RadixHoverCard.Content
          side={side}
          align={align}
          sideOffset={6}
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
          <div className="overflow-y-auto" style={{ maxHeight }}>
            <MarkdownView source={note!} />
          </div>
          {footer && (
            <div className="border-t border-hairline/60 pt-2">{footer}</div>
          )}
        </RadixHoverCard.Content>
      </RadixHoverCard.Portal>
    </RadixHoverCard.Root>
  );
}
