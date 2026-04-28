// Backup-before-upgrade preference. Stored in localStorage rather than
// the Zustand core store: it is a UI preference, not domain data, and
// keeping it out of the store also means it never lands inside the
// backup bundle that exportLocalData() produces (no recursive
// metadata about future upgrade behaviour). ERD §13.8.

export type UpgradePref = 'ask' | 'always' | 'never';

const STORAGE_KEY = 'dayrail:upgrade-backup-pref';
const DEFAULT_PREF: UpgradePref = 'ask';

function isUpgradePref(v: unknown): v is UpgradePref {
  return v === 'ask' || v === 'always' || v === 'never';
}

export function getUpgradePref(): UpgradePref {
  if (typeof window === 'undefined') return DEFAULT_PREF;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isUpgradePref(raw) ? raw : DEFAULT_PREF;
  } catch {
    // Private browsing / disabled storage — fall back to the default
    // ('ask') so the dialog still shows up and the user is in control.
    return DEFAULT_PREF;
  }
}

export function setUpgradePref(next: UpgradePref): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Swallow — write failure is non-fatal; user keeps the dialog flow.
  }
  for (const fn of listeners) fn(next);
}

const listeners = new Set<(next: UpgradePref) => void>();

/** Subscribe to preference changes from the same tab. (Cross-tab sync
 *  via the `storage` event isn't needed for this preference — the
 *  dialog reads on demand and the Settings row re-reads when its
 *  section mounts.) */
export function subscribeUpgradePref(
  fn: (next: UpgradePref) => void,
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
