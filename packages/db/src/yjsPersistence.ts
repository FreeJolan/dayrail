// Y.Doc binary persistence — thin re-export layer over the
// `YDocStore` abstraction (ERD §7.9).
//
// Pre-§7.9 this module owned OPFS read/write directly. The new
// architecture co-locates Y.Doc bytes with sync metadata in a single
// store so the two share lifecycle (see ERD §7.9 for the
// metadata-vs-data drift bug that motivated this). The functions
// below preserve the original signatures so consumers (`@dayrail/core`
// store hydrate/flush, boot.ts pending-import path) don't need to
// change.

import { getYDocStore } from './yDocStore';

export async function loadYDocBytes(): Promise<Uint8Array | null> {
  const store = await getYDocStore();
  return store.loadYDoc();
}

export async function saveYDocBytes(bytes: Uint8Array): Promise<void> {
  const store = await getYDocStore();
  return store.saveYDoc(bytes);
}

export async function deleteYDocBytes(): Promise<void> {
  const store = await getYDocStore();
  return store.deleteYDoc();
}

/** Quarantine a corrupt state file (rename to `.corrupt-<n>`) instead
 *  of leaving it in place to be overwritten by the next persist.
 *  Returns the quarantine file name, or null when no state file
 *  exists. See YDocStore.quarantineYDoc. */
export async function quarantineYDocBytes(): Promise<string | null> {
  const store = await getYDocStore();
  return store.quarantineYDoc();
}
