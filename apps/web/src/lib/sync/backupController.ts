// Local snapshot backup helpers — wraps the Rust-side `backup_*`
// commands plus the Y.Doc → bytes pipeline so callers don't have to
// remember the encode/encode-meta dance.
//
// PWA path: this is a no-op for now. Browser PWAs don't have a
// stable filesystem to write to (downloads dir is user-visible
// but auto-dumping there clutters it; OPFS would put the backup
// inside the same wipe-prone storage we're trying to back up
// against). Auto-backup is desktop-only; PWA users still have the
// manual "下载本地快照" path which they can run periodically by
// hand.

import { encodeDryj } from '@dayrail/db/dryj';
import { exportYDocAsUpdate } from '@dayrail/core';
import { getDeviceId, getDeviceLabel } from './identity';
import { isTauriRuntime } from '../versionUpdateContext';
import { getBackupDir, getBackupMaxCount } from '../backupPrefs';

export interface BackupEntry {
  filename: string;
  reason: string;
  size_bytes: number;
  created_at: string;
}

export type BackupReason =
  | 'pre-update'
  | 'pre-import'
  | 'pre-force-push'
  | 'pre-rollback'
  | 'manual';

/** The configured backup dir as the Rust commands expect it: the
 *  user's chosen folder, or `null` to let Rust use the default
 *  `app_data_dir()/backups/`. */
function configuredDir(): string | null {
  return getBackupDir();
}

/** Encode the current Y.Doc state as a `.dryj` byte buffer ready to
 *  pass to `backup_save` or to write to a user-chosen path. */
function buildLocalDryj(): Uint8Array {
  const update = exportYDocAsUpdate();
  const meta = {
    snapshotId: cryptoUUID(),
    deviceId: getDeviceId(),
    deviceLabel: getDeviceLabel(),
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
  };
  return encodeDryj(meta, update);
}

function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `bk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Best-effort auto-backup before a destructive action. Logs +
 *  swallows on failure so we never block the action the user
 *  actually wanted to take. Returns the entry on success, null on
 *  failure or non-Tauri runtime. */
export async function autoBackup(
  reason: BackupReason,
): Promise<BackupEntry | null> {
  if (!isTauriRuntime()) return null;
  try {
    const bytes = buildLocalDryj();
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<BackupEntry>('backup_save', {
      reason,
      // Tauri serialises Uint8Array as Vec<u8> when wrapped in an
      // Array. The Vec roundtrip cost is fine for a few-hundred-KB
      // snapshot taken at most a handful of times per session.
      bytes: Array.from(bytes),
      dir: configuredDir(),
      maxCount: getBackupMaxCount(),
    });
  } catch (err) {
    console.warn(`[backup] auto-backup (${reason}) failed:`, err);
    return null;
  }
}

export async function listBackups(): Promise<BackupEntry[]> {
  if (!isTauriRuntime()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<BackupEntry[]>('backup_list', { dir: configuredDir() });
}

export async function readBackup(filename: string): Promise<Uint8Array> {
  if (!isTauriRuntime()) {
    throw new Error('readBackup is desktop-only');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<number[]>('backup_read', {
    filename,
    dir: configuredDir(),
  });
  return new Uint8Array(bytes);
}

export async function deleteBackup(filename: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke<void>('backup_delete', { filename, dir: configuredDir() });
}

/** Absolute path of the default backups dir (app_data_dir/backups),
 *  for the Settings UI to show what "默认" resolves to. */
export async function backupDefaultDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('backup_default_dir');
}

/** Open native save dialog and copy the backup file there. The user
 *  picks the path, including filename + extension; we suggest the
 *  original `.dryj` name as default. Cancel returns false. */
export async function exportBackupToUserPath(
  entry: BackupEntry,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const dest = await save({
    title: '导出 .dryj 快照',
    defaultPath: entry.filename,
    filters: [{ name: 'DayRail snapshot', extensions: ['dryj'] }],
  });
  if (!dest) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke<void>('backup_export_to', {
    filename: entry.filename,
    destPath: String(dest),
    dir: configuredDir(),
  });
  return true;
}

/** Manual "下载本地快照" — encode the current Y.Doc state, open
 *  native save dialog, and write to the user-chosen path. No
 *  intermediate backup file under app_data_dir. */
export async function exportLocalSnapshotToUserPath(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const bytes = buildLocalDryj();
  const { save } = await import('@tauri-apps/plugin-dialog');
  const today = new Date().toISOString().slice(0, 10);
  const dest = await save({
    title: '下载本地快照',
    defaultPath: `dayrail-${today}.dryj`,
    filters: [{ name: 'DayRail snapshot', extensions: ['dryj'] }],
  });
  if (!dest) return false;
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(String(dest), bytes);
  return true;
}
