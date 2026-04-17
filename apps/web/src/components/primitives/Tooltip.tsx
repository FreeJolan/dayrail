import * as RadixTooltip from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';

// Thin wrapper around Radix Tooltip. The native `title=""` attribute
// uses a 1–2s browser default that feels sluggish on hover-revealed
// action bars; this component defaults to 200ms + styled content.
//
// The TooltipProvider is mounted once at the app root with the default
// delay; individual `Tooltip` components inherit unless overridden.

export const TooltipProvider = RadixTooltip.Provider;
export const TooltipRoot = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

type ContentProps = ComponentPropsWithoutRef<typeof RadixTooltip.Content>;

export const TooltipContent = forwardRef<
  ElementRef<typeof RadixTooltip.Content>,
  ContentProps
>(({ className, sideOffset = 6, ...rest }, ref) => (
  <RadixTooltip.Portal>
    <RadixTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      className={clsx(
        'z-50 rounded-sm bg-ink-primary px-2 py-1 font-mono text-2xs uppercase tracking-widest text-surface-0 shadow-md',
        'data-[state=delayed-open]:animate-[tooltipIn_120ms_cubic-bezier(0.22,0.61,0.36,1)]',
        className,
      )}
      {...rest}
    />
  </RadixTooltip.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/** One-shot convenience wrapper for the common "hover shows text"
 *  case. Use the split Root / Trigger / Content primitives when the
 *  tooltip needs richer content. */
export function Tooltip({
  content,
  children,
  side,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: RadixTooltip.TooltipContentProps['side'];
}) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TooltipRoot>
  );
}
