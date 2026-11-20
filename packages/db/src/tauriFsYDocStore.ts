// Tauri FS-backed YDocStore (desktop). Files live under
// `app_data_dir()/ydoc/` (prod) or `app_data_dir()/ydoc-dev/` (dev),
// alongside `drive-refresh-token` and `backups/`. Path is independent
// of WKWebView bundle hash / translocation / quarantine — the
// storage-layer reasons that motivated ERD §7.9 in the first place.
//
// Dev / prod path split (v0.11.2). Tauri's `app_data_dir()` resolves
// to the same path for `tauri dev` (debug binary) and the installed
// `.app` bundle, because both read the identifier from
// `tauri.conf.json`. The OPFS-era accidental isolation (WKWebView's
// NSBundle-based scoping that differed between a direct binary and a
// packaged .app) does NOT apply to `app_data_dir()` — without this
// split a dev session would read and write the same Y.Doc / metadata
// files as the user's daily prod app.
//
// Durability: all writes go through the dedicated `ydoc_atomic_write`
// Rust command (write unique tmp → fsync file → rename → fsync parent
// dir). plugin-fs's JS `writeFile` + `rename` never fsyncs, so on
// power loss the rename's metadata change could land before the tmp
// file's data blocks, leaving a 0-byte / truncated `state.dryj` —
// violating the YDocStore "interrupted write leaves the previous
// bytes intact" contract. Reads and removals still use plugin-fs.
//
// `@tauri-apps/plugin-fs`, `@tauri-apps/api/path` and
// `@tauri-apps/api/core` are dynamically imported — the
// `getYDocStore` factory only routes here when `__TAURI_INTERNALS__`
// is present, so the browser bundle pays nothing for these.

import type { SyncMeta, YDocStore, YDocStoreOptions } from './yDocStore';
import { DEFAULT_SYNC_META } from './yDocStore';
import { makeSerialQueue } from './serialQueue';

const STATE_BASENAME = 'state.dryj';
const LAST_PULLED_BASENAME = 'last-pulled.dryj';
const SYNC_META_BASENAME = 'sync-meta.json';
const TMP_SUFFIX = '.tmp';

function dirNameFor(devMode: boolean): string {
  return devMode ? 'ydoc-dev' : 'ydoc';
}

type Paths = {
  dir: string;
  state: string;
  stateTmp: string;
  lastPulled: string;
  lastPulledTmp: string;
  syncMeta: string;
  syncMetaTmp: string;
};

async function buildPaths(dirName: string): Promise<Paths> {
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const baseDir = await appDataDir();
  const dir = await join(baseDir, dirName);
  const state = await join(dir, STATE_BASENAME);
  const lastPulled = await join(dir, LAST_PULLED_BASENAME);
  const syncMeta = await join(dir, SYNC_META_BASENAME);
  return {
    dir,
    state,
    stateTmp: state + TMP_SUFFIX,
    lastPulled,
    lastPulledTmp: lastPulled + TMP_SUFFIX,
    syncMeta,
    syncMetaTmp: syncMeta + TMP_SUFFIX,
  };
}

async function readBinary(path: string): Promise<Uint8Array | null> {
  const fs = await import('@tauri-apps/plugin-fs');
  if (!(await fs.exists(path))) return null;
  return fs.readFile(path);
}

async function readText(path: string): Promise<string | null> {
  const fs = await import('@tauri-apps/plugin-fs');
  if (!(await fs.exists(path))) return null;
  return fs.readTextFile(path);
}

async function removeIfExists(path: string): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs');
  if (!(await fs.exists(path))) return;
  await fs.remove(path);
}

/** Remove the fixed-name legacy tmp plus any `<basename>.<uuid>.tmp`
 *  leftovers an interrupted Rust-side write may have stranded in the
 *  ydoc dir. Best-effort. */
async function removeStaleTmps(dir: string, basename: string): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  await removeIfExists(await join(dir, basename + TMP_SUFFIX)).catch(() => {});
  let entries: { name?: string }[] = [];
  try {
    entries = await fs.readDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (!name) continue;
    if (name.startsWith(`${basename}.`) && name.endsWith(TMP_SUFFIX)) {
      await removeIfExists(await join(dir, name)).catch(() => {});
    }
  }
}

export class TauriFsYDocStore implements YDocStore {
  private stateQueue = makeSerialQueue();
  private lastPulledQueue = makeSerialQueue();
  private syncMetaQueue = makeSerialQueue();
  private pathsPromise: Promise<Paths>;
  private dirName: string;

  constructor(options: YDocStoreOptions = {}) {
    this.dirName = dirNameFor(options.devMode === true);
    // Resolved absolute paths cached after first call. `appDataDir()`
    // hits Tauri IPC, no reason to call it on every save.
    this.pathsPromise = buildPaths(this.dirName);
  }

  // Durable atomic write via the dedicated Rust command — see module
  // header. The command resolves `relPath` against app_data_dir() on
  // the Rust side (and rejects traversal), creates the parent dir,
  // writes a uniquely-named tmp file, fsyncs it, renames it into
  // place, then fsyncs the parent directory.
  private async atomicWriteBinary(basename: string, bytes: Uint8Array): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ydoc_atomic_write', {
      relPath: `${this.dirName}/${basename}`,
      // Tauri serialises a plain Array as Vec<u8>; same pattern as
      // backup_save in backupController.ts.
      bytes: Array.from(bytes),
    });
  }

  private async atomicWriteText(basename: string, text: string): Promise<void> {
    await this.atomicWriteBinary(basename, new TextEncoder().encode(text));
  }

  async loadYDoc(): Promise<Uint8Array | null> {
    const p = await this.pathsPromise;
    return readBinary(p.state);
  }

  async saveYDoc(bytes: Uint8Array): Promise<void> {
    return this.stateQueue(() => this.atomicWriteBinary(STATE_BASENAME, bytes));
  }

  // Deletion goes through the SAME serial queue as saveYDoc —
  // otherwise an in-flight / queued save interleaves with the wipe
  // and its final rename resurrects the file after the delete
  // claims to be done.
  async deleteYDoc(): Promise<void> {
    const p = await this.pathsPromise;
    return this.stateQueue(async () => {
      await removeIfExists(p.state);
      await removeStaleTmps(p.dir, STATE_BASENAME);
    });
  }

  /** Move a state file that failed to decode aside under a
   *  `.corrupt-<n>` name so the bytes survive for manual recovery /
   *  a future fixed build, while hydrate restarts from a clean slate
   *  without ever overwriting them. Serialized on the state queue so
   *  it can't interleave with an in-flight save. */
  async quarantineYDoc(): Promise<string | null> {
    const p = await this.pathsPromise;
    return this.stateQueue(async () => {
      const fs = await import('@tauri-apps/plugin-fs');
      if (!(await fs.exists(p.state))) return null;
      let target = `${p.state}.corrupt-${Date.now()}`;
      for (let i = 1; i <= 99; i++) {
        const candidate = `${p.state}.corrupt-${i}`;
        if (!(await fs.exists(candidate))) {
          target = candidate;
          break;
        }
      }
      await fs.rename(p.state, target);
      return `${STATE_BASENAME}${target.slice(p.state.length)}`;
    });
  }

  async loadLastPulled(): Promise<Uint8Array | null> {
    const p = await this.pathsPromise;
    return readBinary(p.lastPulled);
  }

  async saveLastPulled(bytes: Uint8Array): Promise<void> {
    return this.lastPulledQueue(() =>
      this.atomicWriteBinary(LAST_PULLED_BASENAME, bytes),
    );
  }

  async deleteLastPulled(): Promise<void> {
    const p = await this.pathsPromise;
    return this.lastPulledQueue(async () => {
      await removeIfExists(p.lastPulled);
      await removeStaleTmps(p.dir, LAST_PULLED_BASENAME);
    });
  }

  async loadSyncMeta(): Promise<SyncMeta | null> {
    const p = await this.pathsPromise;
    const text = await readText(p.syncMeta);
    if (text === null) return null;
    try {
      const parsed = JSON.parse(text) as Partial<SyncMeta>;
      return { ...DEFAULT_SYNC_META, ...parsed };
    } catch {
      return null;
    }
  }

  async saveSyncMeta(meta: SyncMeta): Promise<void> {
    return this.syncMetaQueue(() =>
      this.atomicWriteText(SYNC_META_BASENAME, JSON.stringify(meta)),
    );
  }

  // Each file's deletion is enqueued on that file's own serial write
  // queue — see deleteYDoc. A save that was already queued (e.g. the
  // 750ms debounced persist that fired while the user sat in the
  // confirm dialog) fully lands BEFORE the wipe removes the file,
  // instead of interleaving with it and resurrecting old data
  // post-reset.
  async reset(): Promise<void> {
    const p = await this.pathsPromise;
    await Promise.all([
      this.stateQueue(async () => {
        await removeIfExists(p.state);
        await removeStaleTmps(p.dir, STATE_BASENAME);
      }),
      this.lastPulledQueue(async () => {
        await removeIfExists(p.lastPulled);
        await removeStaleTmps(p.dir, LAST_PULLED_BASENAME);
      }),
      this.syncMetaQueue(async () => {
        await removeIfExists(p.syncMeta);
        await removeStaleTmps(p.dir, SYNC_META_BASENAME);
      }),
    ]);
  }
}
