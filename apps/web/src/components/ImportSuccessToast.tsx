// One-shot success toast surfaced after a successful `.dryj` import.
//
// importLocalDataFromBytes sets a sessionStorage flag right before
// triggering the reload (see lib/importData.ts). On the next mount
// after that reload, this component reads + clears the flag and
// shows a transient banner so the user has explicit confirmation
// that "the file landed" rather than wondering whether the silent
// page refresh did anything.
//
// Auto-dismisses after 5s; clickable [×] for immediate dismissal.

import { useEffect, useState } from 'react';
import { popImportSuccessFlag } from '@/lib/importData';

const AUTO_DISMISS_MS = 5_000;

export function ImportSuccessToast() {
  const [filename, setFilename] = useState<string | null>(null);

  // Effect 1 · pop the sessionStorage flag exactly once and seed
  // state. popImportSuccessFlag is destructive (clears the flag on
  // read), so React StrictMode's double-invoke of effects in dev is
  // safe — the second invoke returns null and short-circuits without
  // resetting the state set by the first.
  useEffect(() => {
    const v = popImportSuccessFlag();
    if (v) setFilename(v);
  }, []);

  // Effect 2 · auto-dismiss timer keyed on filename. Splitting from
  // effect 1 means StrictMode's mount → cleanup → mount cycle still
  // re-installs the timer on second mount (filename state survives
  // the cycle, but the timer set up in effect 1 would have been
  // canceled by effect 1's cleanup and never recreated because the
  // flag was already consumed).
  useEffect(() => {
    if (!filename) return;
    const id = window.setTimeout(() => setFilename(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [filename]);

  if (!filename) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex max-w-md">
      <div className="pointer-events-auto flex items-start gap-3 rounded-md bg-surface-0 px-4 py-3 shadow-xl ring-1 ring-hairline/60">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-ink-primary">
            ✓ 已从快照恢复
          </span>
          <span className="font-mono text-2xs text-ink-tertiary">
            {filename}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setFilename(null)}
          aria-label="关闭"
          className="ml-2 self-start rounded-sm px-1.5 py-0.5 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          ×
        </button>
      </div>
    </div>
  );
}
