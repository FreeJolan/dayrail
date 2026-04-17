// Dedicated worker that hosts the SQLite instance + OPFS SAH Pool VFS.
//
// `FileSystemSyncAccessHandle` — the API the SAH Pool VFS depends on —
// is only exposed in dedicated-worker contexts (as of Chromium 127 /
// Safari 17). Calling installOpfsSAHPoolVfs() from the main thread
// therefore fails with "Missing required OPFS APIs.". This worker
// owns the DB and exposes a tiny RPC over postMessage.
//
// Message protocol:
//   { id, type: 'exec',  payload: { sql, bind? }                 }
//   { id, type: 'query', payload: { sql, bind? }                 }
//   { id, type: 'close', payload: {}                             }
// Replies:
//   { id, ok: true,  rows?: Row[] }
//   { id, ok: false, error: string, stack?: string }
//
// Vite loads this via `?worker` import in connection.ts; the
// sqlite-wasm assets are fetched via Vite's asset pipeline.

/// <reference lib="webworker" />

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

interface ExecPayload {
  sql: string;
  bind?: ReadonlyArray<string | number | null>;
}

let dbPromise: Promise<AnyDb> | null = null;

async function openDb(): Promise<AnyDb> {
  const sqlite3 = await sqlite3InitModule({
    print: (msg: string) => console.log('[sqlite worker]', msg),
    printErr: (msg: string) => console.warn('[sqlite worker]', msg),
  });
  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: 'dayrail-pool',
    directory: '/dayrail',
    clearOnInit: false,
  });
  const db = new poolUtil.OpfsSAHPoolDb('/dayrail.db');
  db.exec(`
    PRAGMA journal_mode = MEMORY;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
  `);
  return db;
}

function db(): Promise<AnyDb> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

self.addEventListener('message', async (ev: MessageEvent) => {
  const { id, type, payload } = ev.data as {
    id: number;
    type: string;
    payload: ExecPayload;
  };
  try {
    const handle = await db();
    switch (type) {
      case 'exec': {
        handle.exec({ sql: payload.sql, bind: payload.bind as unknown[] });
        (self as unknown as DedicatedWorkerGlobalScope).postMessage({
          id,
          ok: true,
        });
        break;
      }
      case 'query': {
        const rows: unknown[] = [];
        handle.exec({
          sql: payload.sql,
          bind: payload.bind as unknown[],
          rowMode: 'object',
          callback: (row: unknown) => {
            rows.push(row);
          },
        });
        (self as unknown as DedicatedWorkerGlobalScope).postMessage({
          id,
          ok: true,
          rows,
        });
        break;
      }
      case 'close': {
        try {
          handle.close();
        } catch {
          /* ignore */
        }
        dbPromise = null;
        (self as unknown as DedicatedWorkerGlobalScope).postMessage({
          id,
          ok: true,
        });
        break;
      }
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (err) {
    const e = err as Error;
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      id,
      ok: false,
      error: `${e.name}: ${e.message}`,
      stack: e.stack,
    });
  }
});

// Signal readiness so the main thread knows the worker script loaded,
// even before the first message triggers openDb().
(self as unknown as DedicatedWorkerGlobalScope).postMessage({
  id: 0,
  ok: true,
  ready: true,
});
