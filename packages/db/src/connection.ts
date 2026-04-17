// Connection layer for @dayrail/db. Uses @sqlite.org/sqlite-wasm with
// the OPFS SAH Pool VFS — no COOP/COEP headers required, works on the
// main thread in Chromium, and falls back to a dedicated worker only
// where the browser forces it.
//
// We expose a single async `getDb()` that lazily initialises once per
// page load and returns the live handle. Tests that need a fresh DB
// can call `resetDb()` to close + rebuild.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

// The SQLite-WASM types are shipped as top-level declarations (not as
// named exports on the module namespace), so we re-declare thin aliases
// that match the surface we actually use. This keeps downstream code
// type-safe without fighting the upstream d.ts layout.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sqlite3Static = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

interface Handle {
  sqlite3: Sqlite3Static;
  db: Database;
}

let _handle: Handle | null = null;
let _initPromise: Promise<Handle> | null = null;

/** Resolves to the shared Database handle. Opens OPFS + runs migrations
 *  on first call; every subsequent call is instant. */
export async function getDb(): Promise<Database> {
  if (_handle) return _handle.db;
  if (!_initPromise) _initPromise = open();
  const h = await _initPromise;
  return h.db;
}

/** Returns the raw SQLite3 module in addition to the DB — handy for
 *  calling things like `sqlite3.version` during startup diagnostics. */
export async function getSqlite(): Promise<Sqlite3Static> {
  if (_handle) return _handle.sqlite3;
  if (!_initPromise) _initPromise = open();
  const h = await _initPromise;
  return h.sqlite3;
}

/** For tests: close the DB + clear the cached handle. */
export async function resetDb(): Promise<void> {
  if (_handle) {
    try {
      _handle.db.close();
    } catch {
      // ignore; db may already be closed
    }
    _handle = null;
  }
  _initPromise = null;
}

async function open(): Promise<Handle> {
  // Loaded once per page lifetime. The initModule call returns a
  // namespace populated with `oo1`, `capi`, `wasm`, etc.
  const sqlite3 = await sqlite3InitModule({
    print: (msg: string) => console.log('[sqlite]', msg),
    printErr: (msg: string) => console.warn('[sqlite]', msg),
  });

  // Install the OPFS Sync-Access-Handle pool VFS. This gives us
  // persistence without requiring COOP/COEP or SharedArrayBuffer.
  // The pool lives under the provided `directory` inside OPFS.
  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: 'dayrail-pool',
    directory: '/dayrail',
    clearOnInit: false,
  });

  const db = new poolUtil.OpfsSAHPoolDb('/dayrail.db');

  // One-time pragmas — DayRail is a single-user single-writer DB so
  // these are safe and give us ~2x write perf.
  db.exec(`
    PRAGMA journal_mode = MEMORY;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
  `);

  _handle = { sqlite3, db };
  return _handle;
}
