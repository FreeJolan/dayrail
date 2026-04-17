import { useState } from 'react';
import { clsx } from 'clsx';
import { Popover, PopoverContent, PopoverTrigger } from './primitives/Popover';
import type { RailColor } from '@/data/sample';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.4 E2: single color dot on each Rail card. Click opens the 2×5
// grid of Radix step-9 dots. Each dot is 28px with 12px gap; the current
// color wears a ring.

const PALETTE: Array<{ key: RailColor; label: string }> = [
  { key: 'sand', label: 'Sand' },
  { key: 'sage', label: 'Sage' },
  { key: 'slate', label: 'Slate' },
  { key: 'brown', label: 'Clay' },
  { key: 'amber', label: 'Apricot' },
  { key: 'teal', label: 'Seafoam' },
  { key: 'pink', label: 'Dusty Rose' },
  { key: 'grass', label: 'Grass' },
  { key: 'indigo', label: 'Indigo' },
  { key: 'plum', label: 'Plum' },
];

interface Props {
  value: RailColor;
  onChange: (next: RailColor) => void;
}

export function RailColorPopover({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Rail color: ${value}`}
          className="flex h-5 w-5 items-center justify-center rounded-full transition hover:scale-110"
        >
          <span
            aria-hidden
            className={clsx(
              'block h-3 w-3 rounded-full',
              'ring-1 ring-inset ring-ink-tertiary/30',
            )}
            style={{ background: RAIL_COLOR_HEX[value] }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[192px]">
        <div className="grid grid-cols-5 gap-3">
          {PALETTE.map((c) => {
            const active = c.key === value;
            return (
              <button
                key={c.key}
                type="button"
                title={c.label}
                aria-label={c.label}
                onClick={() => {
                  onChange(c.key);
                  setOpen(false);
                }}
                className={clsx(
                  'flex h-7 w-7 items-center justify-center rounded-full transition',
                  'hover:scale-110',
                )}
              >
                <span
                  aria-hidden
                  className={clsx(
                    'block h-6 w-6 rounded-full',
                    active
                      ? 'ring-2 ring-ink-primary ring-offset-2 ring-offset-surface-1'
                      : 'ring-1 ring-inset ring-ink-tertiary/20',
                  )}
                  style={{ background: RAIL_COLOR_HEX[c.key] }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-3 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          {PALETTE.find((c) => c.key === value)?.label}
        </div>
      </PopoverContent>
    </Popover>
  );
}
