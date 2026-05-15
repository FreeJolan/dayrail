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

import { getYDocStore } from '@dayrail/db/yDocStore';

export async function resetLocalData(): Promise<void> {
  const store = await getYDocStore();
  await store.reset();
  location.reload();
}
