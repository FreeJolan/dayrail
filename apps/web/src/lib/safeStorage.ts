// Safe localStorage access for module-evaluation-time callers.
//
// Chrome throws a SecurityError on *touching* `window.localStorage`
// when the user blocks the site's cookies/site data; private windows
// and some embedders disable DOM storage outright. Modules that read
// prefs during module evaluation (agentBridge's zustand initializer,
// theme's pre-mount initTheme) run before React mounts — an unguarded
// throw there kills the whole bundle before even the BootError page
// can render, leaving a blank white screen.
//
// This wrapper mirrors the guards the other pref modules already have
// (aiApiKey / upgradePref / backupPrefs / sync identity) and adds an
// in-memory fallback so a value written during the session still reads
// back consistently even when persistence is unavailable.

const memoryFallback = new Map<string, string>();

export function safeStorageGet(key: string): string | null {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return raw;
    } catch {
      // Blocked / disabled storage — fall through to the memory copy.
    }
  }
  return memoryFallback.get(key) ?? null;
}

export function safeStorageSet(key: string, value: string): void {
  memoryFallback.set(key, value);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Swallow — the in-memory copy keeps this session consistent;
    // persistence is simply unavailable.
  }
}

export function safeStorageRemove(key: string): void {
  memoryFallback.delete(key);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Swallow — see safeStorageSet.
  }
}
