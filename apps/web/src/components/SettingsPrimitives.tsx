import { clsx } from 'clsx';
import type { ReactNode } from 'react';

// Small, scope-limited primitives shared across the Settings sections.
// Intentionally NOT in packages/ui — they'll graduate there when another
// screen (Project detail edit sheet, etc.) needs the same shapes.

// ---------- Section shell ----------

export function SettingsSectionShell({
  title,
  overline,
  description,
  children,
}: {
  title: string;
  overline?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        {overline && (
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {overline}
          </span>
        )}
        <h2 className="text-xl font-medium text-ink-primary">{title}</h2>
        {description && (
          <p className="max-w-xl text-sm text-ink-secondary">{description}</p>
        )}
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

// ---------- Row (label + description on left, control on right) ----------

export function Row({
  label,
  description,
  control,
  bordered = true,
}: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
  bordered?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-6 py-4',
        bordered && 'first:pt-2 [&:not(:first-child)]:hairline-t',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-ink-primary">{label}</span>
        {description && (
          <p className="text-xs text-ink-tertiary">{description}</p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

// ---------- Segmented control ----------

interface SegmentedOption<T extends string> {
  key: T;
  label: string;
  note?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
}) {
  return (
    <div className="inline-flex rounded-md bg-surface-1 p-0.5">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={clsx(
              'rounded-sm px-3 py-1 text-xs font-medium transition',
              active
                ? 'bg-surface-3 text-ink-primary'
                : 'text-ink-secondary hover:text-ink-primary',
            )}
          >
            {opt.label}
            {opt.note && (
              <span className="ml-1 font-mono text-2xs tabular-nums text-ink-tertiary">
                {opt.note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Toggle switch (boolean control) ----------

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition',
        checked ? 'bg-ink-primary' : 'bg-surface-3',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'absolute h-4 w-4 rounded-full bg-surface-0 shadow-sm transition-[left]',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

// ---------- Text input ----------

export function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  mono?: boolean;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={clsx(
        'rounded-md bg-surface-1 px-3 py-1.5 text-sm text-ink-primary outline-none transition focus:bg-surface-2',
        'placeholder:text-ink-tertiary/70',
        mono && 'font-mono tabular-nums',
        className,
      )}
    />
  );
}

// ---------- KeyValue (read-only pair) ----------

export function KeyValue({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2">
      <span className="text-sm text-ink-secondary">{label}</span>
      <span
        className={clsx(
          'text-sm text-ink-primary',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </span>
    </div>
  );
}
