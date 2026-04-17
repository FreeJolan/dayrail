import * as Rdm from '@radix-ui/react-dropdown-menu';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

// Thin styled wrapper around Radix DropdownMenu. Used by the row-level
// `⋯` menu on the Template Editor (ERD §5.4 E7 decision).

export const DropdownMenu = Rdm.Root;
export const DropdownMenuTrigger = Rdm.Trigger;
export const DropdownMenuGroup = Rdm.Group;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof Rdm.Content>,
  ComponentPropsWithoutRef<typeof Rdm.Content>
>(({ className, sideOffset = 4, ...rest }, ref) => (
  <Rdm.Portal>
    <Rdm.Content
      ref={ref}
      sideOffset={sideOffset}
      className={clsx(
        'z-50 min-w-[180px] overflow-hidden rounded-md bg-surface-1 py-1.5 text-ink-primary shadow-[0_0.5px_0_0_theme(colors.hairline),0_8px_24px_-12px_rgba(0,0,0,0.18)]',
        'outline-none',
        'data-[state=open]:animate-[popoverIn_160ms_cubic-bezier(0.22,0.61,0.36,1)]',
        className,
      )}
      {...rest}
    />
  </Rdm.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof Rdm.Item>,
  ComponentPropsWithoutRef<typeof Rdm.Item> & { destructive?: boolean }
>(({ className, destructive, ...rest }, ref) => (
  <Rdm.Item
    ref={ref}
    className={clsx(
      'flex cursor-default select-none items-center gap-2 px-3 py-1.5 text-sm outline-none transition',
      'data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink-primary',
      'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
      destructive && 'text-ink-secondary data-[highlighted]:text-ink-primary',
      className,
    )}
    {...rest}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof Rdm.CheckboxItem>,
  ComponentPropsWithoutRef<typeof Rdm.CheckboxItem>
>(({ className, children, checked, ...rest }, ref) => (
  <Rdm.CheckboxItem
    ref={ref}
    checked={checked}
    className={clsx(
      'flex cursor-default select-none items-center gap-2 px-3 py-1.5 text-sm outline-none transition',
      'data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink-primary',
      className,
    )}
    {...rest}
  >
    <span className="flex h-3 w-3 items-center justify-center">
      <Rdm.ItemIndicator>
        <Check className="h-3 w-3" strokeWidth={2.2} />
      </Rdm.ItemIndicator>
    </span>
    {children}
  </Rdm.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof Rdm.Separator>,
  ComponentPropsWithoutRef<typeof Rdm.Separator>
>(({ className, ...rest }, ref) => (
  <Rdm.Separator
    ref={ref}
    className={clsx('mx-3 my-1 h-px bg-surface-3', className)}
    {...rest}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof Rdm.Label>,
  ComponentPropsWithoutRef<typeof Rdm.Label>
>(({ className, ...rest }, ref) => (
  <Rdm.Label
    ref={ref}
    className={clsx(
      'px-3 pb-1 pt-1.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary',
      className,
    )}
    {...rest}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';
