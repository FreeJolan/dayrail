// Backup import. Inverse of exportLocalData: read a JSON bundle,
// validate it, and seed the store from the bundle instead of the
// built-in sample data. The mechanism re-uses the OPFS-wipe path
// (resetLocalData) — we stash the parsed bundle in sessionStorage
// first, wipe + reload, and boot.ts picks the bundle up on next
// cold start via `popPendingImport()`. The page reload guarantees
// the SQLite worker releases its handles before we write new data.
//
// Single-device, self-use only (§7 sync is out of scope). Import
// OVERWRITES — it's restore-from-backup semantics, not merge.

import type { ExportBundle } from './exportData';
import { resetLocalData } from './resetLocalData';

const PENDING_IMPORT_KEY = 'dayrail.pending-import';

/** Read a user-picked File, validate it as a dayrail backup bundle,
 *  stash it for boot to pick up, then reset OPFS and reload. The
 *  function never returns — the reload takes over. */
export async function importLocalData(file: File): Promise<void> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `这个文件不是合法 JSON：${(err as Error).message}`,
    );
  }
  const bundle = validateBundle(parsed);
  sessionStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(bundle));
  await resetLocalData(); // wipes OPFS + reload; boot picks up sessionStorage
}

/** Called from boot.ts on every cold start. Returns the stashed
 *  bundle (and clears sessionStorage) if an import was queued; else
 *  undefined. Runs before hydrate so the snapshot write below
 *  happens against a fresh empty DB. */
export function popPendingImport(): ExportBundle | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = sessionStorage.getItem(PENDING_IMPORT_KEY);
  if (!raw) return undefined;
  sessionStorage.removeItem(PENDING_IMPORT_KEY);
  try {
    return JSON.parse(raw) as ExportBundle;
  } catch {
    // Corrupted stash — silently drop. The user will see the app come
    // up seeded from defaults, which is the safer failure mode than
    // crashing boot.
    return undefined;
  }
}

function validateBundle(raw: unknown): ExportBundle {
  if (!raw || typeof raw !== 'object') {
    throw new Error('文件内容不是对象。');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.app !== 'dayrail') {
    throw new Error('不是 dayrail 的备份文件（缺 app=dayrail 标记）。');
  }
  if (obj.schemaVersion !== 1) {
    throw new Error(
      `不支持的 schemaVersion: ${String(obj.schemaVersion)}（当前支持 1）。`,
    );
  }
  if (!obj.state || typeof obj.state !== 'object') {
    throw new Error('文件缺少 state 字段。');
  }
  // Shape-check the state record minimally — we trust the producer
  // (dayrail itself) beyond this. A malformed bundle will surface as
  // empty / weird UI state after reload, not a crash.
  const state = obj.state as Record<string, unknown>;
  const requiredMaps = [
    'templates',
    'rails',
    'lines',
    'tasks',
    'habitBindings',
  ];
  for (const key of requiredMaps) {
    if (!state[key] || typeof state[key] !== 'object') {
      throw new Error(`state.${key} 不是对象 —— 文件已损坏。`);
    }
  }
  return raw as ExportBundle;
}
