import { SHORTCUTS } from '@/lib/keyboardShortcuts';

// Lightweight cheatsheet overlay triggered by `?`. Intentionally not a
// Radix Dialog — we don't need focus-trapping or a portal; a keydown on
// Escape closes it (see useCheatsheetToggle).

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutCheatsheet({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-primary/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[360px] flex-col gap-4 rounded-lg bg-surface-0 p-6 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]"
      >
        <header className="flex items-baseline justify-between">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Shortcuts
          </span>
          <span className="font-mono text-2xs text-ink-tertiary">Esc 关闭</span>
        </header>
        <ul className="flex flex-col gap-1.5">
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys}
              className="flex items-center justify-between text-sm text-ink-secondary"
            >
              <span>{s.label}</span>
              <KeyCombo value={s.keys} />
            </li>
          ))}
          <li className="mt-2 flex items-center justify-between text-sm text-ink-secondary">
            <span>打开本面板</span>
            <KeyCombo value="?" />
          </li>
        </ul>
        <footer className="text-2xs text-ink-tertiary">
          按 <kbd className="font-mono">g</kbd> 再按目标键（1.2s 内）。在输入框里不生效。
        </footer>
      </div>
    </div>
  );
}

function KeyCombo({ value }: { value: string }) {
  return (
    <span className="flex items-center gap-1">
      {value.split(' ').map((k, i) => (
        <kbd
          key={i}
          className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider text-ink-secondary"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
