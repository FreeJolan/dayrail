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

/** One sync attempt record (ERD §7.10.5 · v0.12 P2). `recentAttempts`
 *  is a ring buffer of these; the UI surfaces "已经 N 天没传上去"
 *  by walking back from `lastSuccessAt`. */
export interface SyncAttempt {
  /** ISO timestamp of when the attempt fired. */
  at: string;
  direction: 'push' | 'pull';
  result: 'ok' | 'fail';
  /** Coarse error category for fail attempts · null for ok. Used by
   *  the SideNav tooltip's "看看具体怎么了 ⌄" detail. Free-form so
   *  the recording site can pass whatever info is most useful. */
  errorCode?: string;
  /** First 500 chars of the response body on fail · null for ok.
   *  Surfaced in Settings → 同步 → 故障历史 for diagnostic. */
  errorBody?: string;
}

/** Identity pin (ERD §7.10.2 · v0.12 P1). Captured at first connect,
 *  compared on every subsequent reconnect / push HEAD check. A
 *  mismatch fires the IdentityMismatchModal — never silent. The
 *  `lastKnownMode` field is written by §7.10.1 mode inference and
 *  read by §7.10.6 mode regression guard (P3). */
export interface IdentityPin {
  /** Drive account email recorded at first connect.  */
  accountEmail: string;
  /** .dryj canonical file id from the first pull (if a remote
   *  snapshot was found). Informational; not used for comparison. */
  appdataFileId: string | null;
  /** Most recently confirmed runtime mode. Updated by mode inference.
   *  P3's regression guard refuses to silently downgrade below this. */
  lastKnownMode: 'backup' | 'sync';
  /** ISO timestamp of when this pin was first written / last
   *  overwritten by an explicit "switch to this account" action. */
  pinnedAt: string;
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
  /** Identity pin (v0.12 §7.10.2). Null = never connected to a Drive
   *  account from this device · the next successful connect captures
   *  the pin. */
  identityPin: IdentityPin | null;
  /** Recent sync attempt log (v0.12 §7.10.5). Ring buffer · oldest
   *  truncated when length exceeds 100. The "warn dot lit for 3 min
   *  vs 3 days looks the same" blind spot is fixed by walking back
   *  from `lastSuccessAt` rather than this buffer; the buffer is for
   *  the diagnostic detail view. */
  recentAttempts: SyncAttempt[];
  /** ISO timestamp of the last successful push / pull. Never evicted
   *  (i.e. distinct from `lastSyncAt` which is mutable for the
   *  legacy UI · `lastSuccessAt` is the duration-aware canonical).
   *  null = never succeeded on this device. */
  lastSuccessAt: {
    push: string | null;
    pull: string | null;
  };
  /** ISO timestamp until which the pending-pile alert is suppressed
   *  ("先关掉" button). Cleared automatically when push succeeds.
   *  null = no active suppression. */
  dismissPendingPileUntil: string | null;
}

export const DEFAULT_SYNC_META: SyncMeta = {
  lastPulledSnapshotId: null,
  lastSyncAt: null,
  lastSyncLabel: null,
  samplesOnly: false,
  dirtyCount: 0,
  lastPushedCounts: null,
  bootSyncChoice: 'auto-pull',
  identityPin: null,
  recentAttempts: [],
  lastSuccessAt: { push: null, pull: null },
  dismissPendingPileUntil: null,
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

/** Options passed into store constructors. */
export interface YDocStoreOptions {
  /** When true, the store namespaces all its paths with a `-dev`
   *  suffix so a dev build (`pnpm desktop:dev`) doesn't share data
   *  with the installed prod app. Critical for Tauri: dev and prod
   *  both resolve `app_data_dir()` to the same path (via
   *  `tauri.conf.json` identifier), so without this split they would
   *  read and write the same Y.Doc / metadata files. */
  devMode?: boolean;
}

let _devMode = false;

/** App boot calls this once before the first `getYDocStore()` to
 *  inform the store whether we're in dev mode. Vite's
 *  `import.meta.env.DEV` is the canonical source; we can't read it
 *  directly from packages/db because that workspace doesn't ship
 *  Vite ambient types, so the app passes the flag in. */
export function setYDocStoreDevMode(dev: boolean): void {
  _devMode = dev;
}

let _store: YDocStore | null = null;

/** Lazy singleton factory. The first caller selects the backend
 *  based on runtime; subsequent calls return the same instance.
 *  Both backends are dynamically imported so the browser bundle
 *  doesn't pull in `@tauri-apps/plugin-fs` if Tauri isn't present. */
export async function getYDocStore(): Promise<YDocStore> {
  if (_store) return _store;
  const options: YDocStoreOptions = { devMode: _devMode };
  if (isTauriRuntime()) {
    const { TauriFsYDocStore } = await import('./tauriFsYDocStore');
    _store = new TauriFsYDocStore(options);
  } else {
    const { OpfsYDocStore } = await import('./opfsYDocStore');
    _store = new OpfsYDocStore(options);
  }
  return _store;
}

/** For tests only — reset the cached singleton. */
export function __resetYDocStoreCache(): void {
  _store = null;
}
