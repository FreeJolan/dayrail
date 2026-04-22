// Main-thread RPC client for the SQLite worker (see sqlite.worker.ts).
//
// Exposes an async `Database` facade — every operation is a postMessage
// round-trip. Ordering is preserved because the worker processes
// messages serially on its microtask queue, and our id-based pending
// map resolves responses in FIFO arrival order.
//
// Prior art: we originally tried running sqlite-wasm on the main thread
// via `installOpfsSAHPoolVfs`, but `FileSystemSyncAccessHandle` is
// dedicated-worker-only in every shipping browser. Hence this client.

// `?worker` is Vite's built-in suffix: it builds the referenced module
// as a separate worker bundle and returns a Worker constructor.
// The triple-slash reference pulls in the ambient declaration from
// vite-env.d.ts so consumers (packages/core, apps/web) don't need to
// set up vite/client types of their own when they follow the import.
/// <reference path="./vite-env.d.ts" />
import SqliteWorker from './sqlite.worker.ts?worker';
import { runMigrations } from './migrate';

export interface Database {
  exec(opts: {
    sql: string;
    bind?: ReadonlyArray<string | number | null>;
  }): Promise<void>;
  query<T = Record<string, unknown>>(opts: {
    sql: string;
    bind?: ReadonlyArray<string | number | null>;
  }): Promise<T[]>;
  close(): Promise<void>;
}

interface WorkerMessage {
  id: number;
  ok: boolean;
  rows?: unknown[];
  ready?: boolean;
  error?: string;
  stack?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let dbInstance: Database | null = null;
// Single in-flight migration promise. Every caller of getDb() awaits
// this, so the schema is guaranteed ready before the first query runs
// — protects callers that touch tables pre-hydrate (e.g. the Import
// flow in apps/web/src/boot.ts writes a snapshot before hydrate is
// reached, which was landing INSERTs against a not-yet-created
// `snapshots` table).
let migrationsPromise: Promise<void> | null = null;

function send<T>(
  w: Worker,
  type: 'exec' | 'query' | 'close',
  payload: Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    w.postMessage({ id, type, payload });
  });
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new SqliteWorker({ name: 'dayrail-sqlite' });
  w.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as WorkerMessage;
    if (msg.ready) {
      // Worker bootstrap signal — no pending slot to resolve.
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) {
      p.resolve(msg.rows ?? undefined);
    } else {
      const err = new Error(msg.error ?? 'Unknown DB error');
      if (msg.stack) err.stack = msg.stack;
      p.reject(err);
    }
  });
  w.addEventListener('error', (ev: ErrorEvent) => {
    console.error('[db worker error]', ev.message, ev.filename, ev.lineno);
    // Reject all pending requests so callers fail fast.
    for (const p of pending.values()) {
      p.reject(new Error(`Worker crashed: ${ev.message}`));
    }
    pending.clear();
  });
  worker = w;
  return w;
}

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    // Cached handle — still wait for migrations so the first caller
    // that triggers getDb() can't race ahead of the schema setup if
    // a second caller arrives before the promise resolves.
    if (migrationsPromise) await migrationsPromise;
    return dbInstance;
  }
  const w = ensureWorker();
  const instance: Database = {
    async exec({ sql, bind }) {
      await send<void>(w, 'exec', { sql, bind });
    },
    async query<T>({
      sql,
      bind,
    }: {
      sql: string;
      bind?: ReadonlyArray<string | number | null>;
    }): Promise<T[]> {
      const rows = await send<unknown[] | undefined>(w, 'query', { sql, bind });
      return (rows ?? []) as T[];
    },
    async close() {
      await send<void>(w, 'close', {});
      w.terminate();
      worker = null;
      dbInstance = null;
      migrationsPromise = null;
    },
  };
  dbInstance = instance;
  // Run schema DDL exactly once per session so every getDb() caller
  // sees a migrated DB. The store still calls runMigrations() from
  // hydrate as belt-and-suspenders — idempotent thanks to the
  // IF-(NOT)-EXISTS guards.
  migrationsPromise = runMigrations(instance);
  await migrationsPromise;
  return instance;
}

export async function resetDb(): Promise<void> {
  // Graceful close first so the worker releases OPFS SAH handles in an
  // orderly fashion. If the worker is wedged (e.g. corrupt DB → openDb
  // rejected → every subsequent message rejects), fall through to a
  // hard terminate so the handles still get freed on the host side.
  if (dbInstance) {
    try {
      await dbInstance.close();
    } catch {
      /* fall through to hard-terminate */
    }
  }
  if (worker) {
    try {
      worker.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
    dbInstance = null;
    migrationsPromise = null;
  }
  // Reject anything left dangling so callers get a clean error instead
  // of a hung promise.
  for (const p of pending.values()) {
    p.reject(new Error('DB reset: worker terminated'));
  }
  pending.clear();
}
