import * as RadixPopover from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

// Minimal wrapper around Radix Popover. Styled against DayRail tokens:
// surface-1 card, radius-md, 0.5px hairline shadow (G2 whitelist — a
// popover IS a sticky floating layer, gets the hairline treatment).

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

type ContentProps = ComponentPropsWithoutRef<typeof RadixPopover.Content>;

export const PopoverContent = forwardRef<
  ElementRef<typeof RadixPopover.Content>,
  ContentProps
>(({ className, align = 'start', sideOffset = 6, ...rest }, ref) => (
  <RadixPopover.Portal>
    <RadixPopover.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={clsx(
        'z-50 rounded-md bg-surface-1 p-3 text-ink-primary shadow-[0_0.5px_0_0_theme(colors.hairline),0_8px_24px_-12px_rgba(0,0,0,0.18)]',
        'outline-none',
        'data-[state=open]:animate-[popoverIn_160ms_cubic-bezier(0.22,0.61,0.36,1)]',
        className,
      )}
      {...rest}
    />
  </RadixPopover.Portal>
));
PopoverContent.displayName = 'PopoverContent';
