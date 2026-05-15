// Tauri FS-backed YDocStore (desktop). Files live under
// `app_data_dir()/ydoc/`, alongside `drive-refresh-token` and
// `backups/`. Path is independent of WKWebView bundle hash /
// translocation / quarantine — the storage-layer reasons that
// motivated ERD §7.9 in the first place.
//
// Absolute paths are resolved via `@tauri-apps/api/path` once and
// cached. plugin-fs operations use the resolved absolute path so
// capability checks pass via the existing `$HOME/**` scope rules
// (app_data_dir() always sits under $HOME on macOS / Linux and
// under $APPDATA on Windows).
//
// `@tauri-apps/plugin-fs` and `@tauri-apps/api/path` are dynamically
// imported — the `getYDocStore` factory only routes here when
// `__TAURI_INTERNALS__` is present, so the browser bundle pays
// nothing for these.

import type { SyncMeta, YDocStore } from './yDocStore';
import { DEFAULT_SYNC_META } from './yDocStore';

const DIR_NAME = 'ydoc';
const STATE_BASENAME = 'state.dryj';
const LAST_PULLED_BASENAME = 'last-pulled.dryj';
const SYNC_META_BASENAME = 'sync-meta.json';
const TMP_SUFFIX = '.tmp';

// Resolved absolute paths cached after first call. `appDataDir()`
// hits Tauri IPC, no reason to call it on every save.
type Paths = {
  dir: string;
  state: string;
  stateTmp: string;
  lastPulled: string;
  lastPulledTmp: string;
  syncMeta: string;
  syncMetaTmp: string;
};
let _paths: Paths | null = null;
let _dirEnsured = false;

async function resolvePaths(): Promise<Paths> {
  if (_paths) return _paths;
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const baseDir = await appDataDir();
  const dir = await join(baseDir, DIR_NAME);
  const state = await join(dir, STATE_BASENAME);
  const lastPulled = await join(dir, LAST_PULLED_BASENAME);
  const syncMeta = await join(dir, SYNC_META_BASENAME);
  _paths = {
    dir,
    state,
    stateTmp: state + TMP_SUFFIX,
    lastPulled,
    lastPulledTmp: lastPulled + TMP_SUFFIX,
    syncMeta,
    syncMetaTmp: syncMeta + TMP_SUFFIX,
  };
  return _paths;
}

async function ensureDir(): Promise<void> {
  if (_dirEnsured) return;
  const { dir } = await resolvePaths();
  const fs = await import('@tauri-apps/plugin-fs');
  if (!(await fs.exists(dir))) {
    await fs.mkdir(dir, { recursive: true });
  }
  _dirEnsured = true;
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

// Atomic write: write .tmp, then rename. plugin-fs `rename` calls
// `std::fs::rename` on the Rust side, which is atomic on POSIX
// when both paths share a filesystem (always true within app_data_dir).
async function atomicWriteBinary(path: string, tmp: string, bytes: Uint8Array): Promise<void> {
  await ensureDir();
  const fs = await import('@tauri-apps/plugin-fs');
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, path);
}

async function atomicWriteText(path: string, tmp: string, text: string): Promise<void> {
  await ensureDir();
  const fs = await import('@tauri-apps/plugin-fs');
  await fs.writeTextFile(tmp, text);
  await fs.rename(tmp, path);
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

  async loadYDoc(): Promise<Uint8Array | null> {
    const p = await resolvePaths();
    return readBinary(p.state);
  }

  async saveYDoc(bytes: Uint8Array): Promise<void> {
    const p = await resolvePaths();
    return this.stateQueue(() => atomicWriteBinary(p.state, p.stateTmp, bytes));
  }

  async deleteYDoc(): Promise<void> {
    const p = await resolvePaths();
    await removeIfExists(p.state);
    await removeIfExists(p.stateTmp);
  }

  async loadLastPulled(): Promise<Uint8Array | null> {
    const p = await resolvePaths();
    return readBinary(p.lastPulled);
  }

  async saveLastPulled(bytes: Uint8Array): Promise<void> {
    const p = await resolvePaths();
    return this.lastPulledQueue(() =>
      atomicWriteBinary(p.lastPulled, p.lastPulledTmp, bytes),
    );
  }

  async deleteLastPulled(): Promise<void> {
    const p = await resolvePaths();
    await removeIfExists(p.lastPulled);
    await removeIfExists(p.lastPulledTmp);
  }

  async loadSyncMeta(): Promise<SyncMeta | null> {
    const p = await resolvePaths();
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
    const p = await resolvePaths();
    return this.syncMetaQueue(() =>
      atomicWriteText(p.syncMeta, p.syncMetaTmp, JSON.stringify(meta)),
    );
  }

  async reset(): Promise<void> {
    const p = await resolvePaths();
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
