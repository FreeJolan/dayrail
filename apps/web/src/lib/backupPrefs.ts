// Local auto-backup preferences (v0.14.0, ERD §15.12). Desktop-only in
// effect — the PWA has no managed backup store — but the getters are
// safe to call anywhere. Mirrors the upgradePref.ts pattern: localStorage
// + a module-scoped listener set, read on demand by the Settings rows and
// by backupController before each backup_* invoke.
//
//   • backupDir:      string | null — null = default app_data_dir/backups
//                     (resolved Rust-side). A non-null value is an
//                     absolute folder path the user picked.
//   • backupMaxCount: number — retention; oldest beyond this are GC'd on
//                     the next backup. Defaults to DEFAULT_MAX_BACKUPS.

const STORAGE_KEY_DIR = 'dayrail:backup-dir';
const STORAGE_KEY_MAX = 'dayrail:backup-max-count';

/** Keep in sync with DEFAULT_MAX_BACKUPS in apps/desktop/src-tauri/src/backup.rs. */
export const DEFAULT_MAX_BACKUPS = 20;
/** Guard rails for the user-entered retention count. */
export const MIN_MAX_BACKUPS = 1;
export const MAX_MAX_BACKUPS = 200;

// ---- backupDir ----------------------------------------------------

const dirListeners = new Set<(next: string | null) => void>();

export function getBackupDir(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_DIR);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function setBackupDir(next: string | null): void {
  if (typeof window !== 'undefined') {
    try {
      if (next && next.trim()) {
        window.localStorage.setItem(STORAGE_KEY_DIR, next);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_DIR);
      }
    } catch {
      // private mode / storage disabled — fall through to notify so the
      // in-memory Settings UI still reflects the choice this session.
    }
  }
  const normalized = next && next.trim() ? next : null;
  for (const fn of dirListeners) fn(normalized);
}

export function subscribeBackupDir(fn: (next: string | null) => void): () => void {
  dirListeners.add(fn);
  return () => {
    dirListeners.delete(fn);
  };
}

// ---- backupMaxCount ----------------------------------------------

const maxListeners = new Set<(next: number) => void>();

function clampMax(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_BACKUPS;
  return Math.min(MAX_MAX_BACKUPS, Math.max(MIN_MAX_BACKUPS, Math.round(n)));
}

export function getBackupMaxCount(): number {
  if (typeof window === 'undefined') return DEFAULT_MAX_BACKUPS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_MAX);
    if (raw == null) return DEFAULT_MAX_BACKUPS;
    return clampMax(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_MAX_BACKUPS;
  }
}

export function setBackupMaxCount(next: number): void {
  const value = clampMax(next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY_MAX, String(value));
    } catch {
      // see setBackupDir
    }
  }
  for (const fn of maxListeners) fn(value);
}

export function subscribeBackupMaxCount(fn: (next: number) => void): () => void {
  maxListeners.add(fn);
  return () => {
    maxListeners.delete(fn);
  };
}
