// Last-pulled Y.Doc snapshot persistence — thin re-export over
// YDocStore (ERD §7.9).
//
// Pre-§7.9 this module owned OPFS read/write directly. The new
// architecture co-locates Y.Doc bytes + last-pulled snapshot + sync
// metadata in a single store so the three share lifecycle. The
// functions below preserve the original signatures so the
// syncController smart-diff path doesn't change.

import { getYDocStore } from '@dayrail/db/yDocStore';

export async function loadLastPulledDocBytes(): Promise<Uint8Array | null> {
  try {
    const store = await getYDocStore();
    return store.loadLastPulled();
  } catch {
    return null;
  }
}

export async function saveLastPulledDocBytes(bytes: Uint8Array): Promise<void> {
  const store = await getYDocStore();
  return store.saveLastPulled(bytes);
}

export async function deleteLastPulledDocBytes(): Promise<void> {
  const store = await getYDocStore();
  return store.deleteLastPulled();
}
