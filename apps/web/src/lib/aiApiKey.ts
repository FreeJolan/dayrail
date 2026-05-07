// ERD §6.6 v0.8.2 — `userProfile` field-split policy.
//
// AI provider API key lives in browser localStorage, NOT in the Y.Doc
// sync stream. The dichotomy: "if this device loses it, the device
// loses access to an external service" → credential → local only.
// Same bucket as Drive OAuth tokens / WebDAV passwords (§7.1).
//
// Do not put this key into snapshot exports, sync streams, or any
// shared transport. The other three AI fields (aiBaseUrl / aiModel /
// background) ride the Y.Doc sync stream via `userProfile` Y.Map and
// do not pass through here.

const STORAGE_KEY = 'dayrail.aiApiKey';

export function getAiApiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    // Private browsing / disabled storage — return empty so the AI
    // surface treats the key as unset (the Settings UI will prompt).
    return '';
  }
}

export function setAiApiKey(next: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (next.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // Swallow — write failure is non-fatal; the user can retry.
  }
  for (const fn of listeners) fn(next);
}

export function clearAiApiKey(): void {
  setAiApiKey('');
}

const listeners = new Set<(next: string) => void>();

/** Subscribe to changes from the same tab. Settings re-reads on mount
 *  is enough for the typical flow; subscribers are useful when a
 *  panel needs live updates (e.g. an "AI key set?" indicator). */
export function subscribeAiApiKey(fn: (next: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
