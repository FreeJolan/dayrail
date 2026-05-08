// Backup import (v0.7) — accept a `.dryj` Yjs container the user
// either downloaded earlier (manual backup) or produced via the
// migration script. Mechanism: stash the raw bytes in sessionStorage,
// trigger resetLocalData (wipes OPFS, including the previous
// `dayrail-state.dryj`), and the page reloads. boot.ts picks up the
// stashed bytes via `popPendingImport()` and writes them to OPFS
// before hydrate, so the new state is what loadYDocBytes returns.
//
// Two callers:
//   1. Manual import: Settings → 同步 → "Import from snapshot".
//   2. Sync layer: not used in v0.7 because pull is in-memory
//      (Y.applyUpdate) and never reloads. Kept available for future
//      "force reset to remote" flows if needed.

import { decodeDryj } from '@dayrail/db/dryj';
import { resetLocalData } from './resetLocalData';
import {
  bumpDirtyCount,
  clearLocalIsSamplesOnly,
} from './sync/identity';

const PENDING_IMPORT_KEY = 'dayrail.pending-import';

/** Read a user-picked File, validate the .dryj container, stash the
 *  raw bytes for boot to pick up, then reset OPFS and reload. The
 *  function never returns — the reload takes over. */
export async function importLocalData(file: File): Promise<void> {
  const buf = await file.arrayBuffer();
  await importLocalDataFromBytes(new Uint8Array(buf));
}

/** Bytes-direct variant for callers that already have the raw `.dryj`
 *  payload (e.g. Tauri's native file picker — `tauri-plugin-fs`'s
 *  `readFile` returns `Uint8Array` directly, no `File` wrapper). The
 *  WKWebView HTML5 file input's `files[0]` is unreliable on Tauri,
 *  which is why the desktop import flow takes this path. */
export async function importLocalDataFromBytes(bytes: Uint8Array): Promise<void> {
  // Validate the container header before reload so the user sees an
  // immediate error rather than a silent boot into empty state.
  try {
    decodeDryj(bytes);
  } catch (err) {
    throw new Error(
      `这个文件不是合法的 .dryj 备份：${(err as Error).message}`,
    );
  }
  // Base64-encode for sessionStorage (which only stores strings).
  const b64 = bytesToBase64(bytes);
  sessionStorage.setItem(PENDING_IMPORT_KEY, b64);
  // The user just brought in real data. Clear the samples-only flag
  // pre-emptively (boot.ts won't re-seed when there's a pending
  // import, but a stale flag from a prior boot would otherwise let
  // ConnectDrivePanel destroy this import on its first Drive pull).
  clearLocalIsSamplesOnly();
  // Bump the dirty cursor so the imported state actually pushes to
  // Drive on the next sync trigger. Without this, post-reload boot
  // applies the .dryj with origin='opfs' (filtered by the
  // afterTransaction listener), dirty stays 0, and no push trigger
  // ever fires — the import would be stranded on this device unless
  // the user happened to make another edit. localStorage survives
  // resetLocalData's OPFS wipe, so the bump persists across the
  // reload that this function triggers.
  bumpDirtyCount();
  await resetLocalData(); // wipes OPFS + reload; boot picks up sessionStorage
}

/** Boot reads the stashed bytes here. Returns the raw .dryj container
 *  the user supplied (or undefined when no import is pending). */
export function popPendingImport(): Uint8Array | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = sessionStorage.getItem(PENDING_IMPORT_KEY);
  if (!raw) return undefined;
  sessionStorage.removeItem(PENDING_IMPORT_KEY);
  try {
    return base64ToBytes(raw);
  } catch {
    // Corrupted stash — silently drop. boot will fall through to the
    // empty-state path, which seeds from samples.
    return undefined;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  // Chunk to avoid stack overflow on very large arrays — Drive bundles
  // are ~hundreds of KB, far below any practical limit, but the chunked
  // approach is robust without measurable cost.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
