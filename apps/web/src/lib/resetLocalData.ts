// "重置本地数据" — wipes the active YDocStore (Y.Doc bytes +
// last-pulled snapshot + sync metadata), then reloads.
//
// As of ERD §7.9 this routes through the store abstraction so the
// behavior is consistent across backends (OPFS for browser, Tauri FS
// for desktop). Device identity / OAuth localStorage is intentionally
// preserved — "still the same device after a reset" is the right
// semantic, and reset shouldn't force a re-OAuth.
//
// Safe to call from any surface; the caller owns the confirmation UX.

import { suspendPersistence } from '@dayrail/core';
import { getYDocStore } from '@dayrail/db/yDocStore';

export async function resetLocalData(): Promise<void> {
  // Stop the debounced persist loop BEFORE wiping. A 750ms persist
  // timer armed by a recent edit (and kept pending while the user sat
  // in the confirm dialog) would otherwise fire mid-reset, enqueue a
  // full-doc save behind the wipe, and resurrect the old data on
  // reload. The suspension is one-way; location.reload() below gives
  // the next session a fresh context. Store-level deletions are also
  // serialized on the same per-file write queues as saves, so an
  // already-in-flight save fully lands before its file is removed.
  suspendPersistence();
  const store = await getYDocStore();
  await store.reset();
  location.reload();
}
