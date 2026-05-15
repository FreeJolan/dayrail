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
// `@tauri-apps/plugin-fs` and `@tauri-apps/api/path` are dynamically
// imported — the `getYDocStore` factory only routes here when
// `__TAURI_INTERNALS__` is present, so the browser bundle pays
// nothing for these.

import type { SyncMeta, YDocStore, YDocStoreOptions } from './yDocStore';
import { DEFAULT_SYNC_META } from './yDocStore';

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

// Per-file serial write chains — mirrors opfsYDocStore. Without this,
// two concurrent saveYDoc() calls race on the .tmp file.
function makeSerialQueue(): (task: () => Promise<void>) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return (taskFn) => {
    const prev = inFlight;
    const task = (async () => {
      if (prev) {
        try {
          await prev;
        } catch {
          /* prior task failed; we proceed */
        }
      }
      await taskFn();
    })();
    const wrapped: Promise<void> = task.finally(() => {
      if (inFlight === wrapped) inFlight = null;
    });
    inFlight = wrapped;
    return task;
  };
}

export class TauriFsYDocStore implements YDocStore {
  private stateQueue = makeSerialQueue();
  private lastPulledQueue = makeSerialQueue();
  private syncMetaQueue = makeSerialQueue();
  private pathsPromise: Promise<Paths>;
  private dirEnsured = false;

  constructor(options: YDocStoreOptions = {}) {
    const dirName = dirNameFor(options.devMode === true);
    // Resolved absolute paths cached after first call. `appDataDir()`
    // hits Tauri IPC, no reason to call it on every save.
    this.pathsPromise = buildPaths(dirName);
  }

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    const { dir } = await this.pathsPromise;
    const fs = await import('@tauri-apps/plugin-fs');
    if (!(await fs.exists(dir))) {
      await fs.mkdir(dir, { recursive: true });
    }
    this.dirEnsured = true;
  }

  // Atomic write: write .tmp, then rename. plugin-fs `rename` calls
  // `std::fs::rename` on the Rust side, which is atomic on POSIX
  // when both paths share a filesystem (always true within app_data_dir).
  private async atomicWriteBinary(path: string, tmp: string, bytes: Uint8Array): Promise<void> {
    await this.ensureDir();
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, path);
  }

  private async atomicWriteText(path: string, tmp: string, text: string): Promise<void> {
    await this.ensureDir();
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.writeTextFile(tmp, text);
    await fs.rename(tmp, path);
  }

  async loadYDoc(): Promise<Uint8Array | null> {
    const p = await this.pathsPromise;
    return readBinary(p.state);
  }

  async saveYDoc(bytes: Uint8Array): Promise<void> {
    const p = await this.pathsPromise;
    return this.stateQueue(() => this.atomicWriteBinary(p.state, p.stateTmp, bytes));
  }

  async deleteYDoc(): Promise<void> {
    const p = await this.pathsPromise;
    await removeIfExists(p.state);
    await removeIfExists(p.stateTmp);
  }

  async loadLastPulled(): Promise<Uint8Array | null> {
    const p = await this.pathsPromise;
    return readBinary(p.lastPulled);
  }

  async saveLastPulled(bytes: Uint8Array): Promise<void> {
    const p = await this.pathsPromise;
    return this.lastPulledQueue(() =>
      this.atomicWriteBinary(p.lastPulled, p.lastPulledTmp, bytes),
    );
  }

  async deleteLastPulled(): Promise<void> {
    const p = await this.pathsPromise;
    await removeIfExists(p.lastPulled);
    await removeIfExists(p.lastPulledTmp);
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
    const p = await this.pathsPromise;
    return this.syncMetaQueue(() =>
      this.atomicWriteText(p.syncMeta, p.syncMetaTmp, JSON.stringify(meta)),
    );
  }

  async reset(): Promise<void> {
    const p = await this.pathsPromise;
    await Promise.all([
      removeIfExists(p.state),
      removeIfExists(p.stateTmp),
      removeIfExists(p.lastPulled),
      removeIfExists(p.lastPulledTmp),
      removeIfExists(p.syncMeta),
      removeIfExists(p.syncMetaTmp),
    ]);
  }
}
