// YDocStore — single co-resident persistence layer for Y.Doc bytes
// + last-pulled snapshot + all sync-lineage metadata (ERD §7.9).
//
// Two backends share the interface so metadata always lives on the
// SAME storage medium as the Y.Doc bytes it describes. When that
// medium goes away (OPFS evicted, Tauri FS dir wiped externally),
// data and metadata vanish together — boot probe sees a null
// lastPulled and walks the first-connect path. Drift is structurally
// impossible.
//
// Backend selection (see getYDocStore):
//   - OpfsYDocStore        — non-Tauri (browser, dev, debug)
//   - TauriFsYDocStore     — Tauri (desktop)

/** Sanity-check baseline captured at the last successful push.
 *  syncController compares the current Y.Doc's counts against this
 *  to detect the v0.9.0→v0.9.1 "looks suspiciously empty" failure
 *  shape before it overwrites Drive. Carried inside SyncMeta so it
 *  shares lifecycle with the Y.Doc bytes themselves — losing both
 *  together is correct (no false alarm on a legitimate reset). */
export interface LastPushedCounts {
  templates: number;
  tasks: number;
  lines: number;
  reflections: number;
  /** ISO timestamp of when these counts were captured. */
  at: string;
}

/** Sync-lineage metadata. Kept in one JSON blob so all keys share
 *  the Y.Doc's lifecycle. Device identity, OAuth cache, and session
 *  flags stay in localStorage / sessionStorage — see ERD §7.9 split
 *  table. */
export interface SyncMeta {
  /** Drive snapshotId of the last successful pull. Together with the
   *  bytes in `loadLastPulled()` this anchors the smart-diff base. */
  lastPulledSnapshotId: string | null;
  /** Epoch ms of the last successful round-trip (push or pull). */
  lastSyncAt: number | null;
  /** Device label of the peer that authored the last roundtrip
   *  (informational, surfaced in Settings). */
  lastSyncLabel: string | null;
  /** v0.7-era seed marker. Now dead-code in fresh installs but kept
   *  as a defense-in-depth gate for any path that reintroduces
   *  disposable seed data. */
  samplesOnly: boolean;
  /** Count of unpushed local writes since the last successful push.
   *  Used by the syncController to decide whether to schedule a
   *  push. */
  dirtyCount: number;
  /** Sanity-check baseline at last successful push (see
   *  LastPushedCounts above). */
  lastPushedCounts: LastPushedCounts | null;
  /** User preference for boot-time sync UX: 'auto-pull' silently
   *  pulls if remote is ahead, 'ask' surfaces a dialog. */
  bootSyncChoice: 'auto-pull' | 'ask';
}

export const DEFAULT_SYNC_META: SyncMeta = {
  lastPulledSnapshotId: null,
  lastSyncAt: null,
  lastSyncLabel: null,
  samplesOnly: false,
  dirtyCount: 0,
  lastPushedCounts: null,
  bootSyncChoice: 'auto-pull',
};

export interface YDocStore {
  /** Load the persisted Y.Doc bytes (.dryj container). Returns null
   *  on fresh install / after reset. */
  loadYDoc(): Promise<Uint8Array | null>;
  /** Atomic write — must use a .tmp + rename pattern so an
   *  interrupted write leaves the previous bytes intact. */
  saveYDoc(bytes: Uint8Array): Promise<void>;
  deleteYDoc(): Promise<void>;
  loadLastPulled(): Promise<Uint8Array | null>;
  saveLastPulled(bytes: Uint8Array): Promise<void>;
  deleteLastPulled(): Promise<void>;
  /** Read the sync-lineage metadata blob. Null = never written
   *  (fresh install or post-reset). Callers should fall back to
   *  DEFAULT_SYNC_META in that case. */
  loadSyncMeta(): Promise<SyncMeta | null>;
  saveSyncMeta(meta: SyncMeta): Promise<void>;
  /** Wipe everything in this store (Y.Doc + last-pulled +
   *  sync-meta). Device identity / OAuth localStorage is untouched. */
  reset(): Promise<void>;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let _store: YDocStore | null = null;

/** Lazy singleton factory. The first caller selects the backend
 *  based on runtime; subsequent calls return the same instance.
 *  Both backends are dynamically imported so the browser bundle
 *  doesn't pull in `@tauri-apps/plugin-fs` if Tauri isn't present. */
export async function getYDocStore(): Promise<YDocStore> {
  if (_store) return _store;
  if (isTauriRuntime()) {
    const { TauriFsYDocStore } = await import('./tauriFsYDocStore');
    _store = new TauriFsYDocStore();
  } else {
    const { OpfsYDocStore } = await import('./opfsYDocStore');
    _store = new OpfsYDocStore();
  }
  return _store;
}

/** For tests only — reset the cached singleton. */
export function __resetYDocStoreCache(): void {
  _store = null;
}
