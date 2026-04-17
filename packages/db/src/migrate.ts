// Minimal runtime migrator. We don't pull in drizzle-kit for v0.2
// because browser-side migrations don't need a full file-based
// migrations folder — we maintain a single `INITIAL_SCHEMA_SQL` DDL
// blob + a linear version counter. When the schema evolves, append
// ALTER TABLE statements under their target version and bump
// `LATEST_SCHEMA_VERSION`.

import type { Database } from './connection';
import { INITIAL_SCHEMA_SQL } from './schema';

export const LATEST_SCHEMA_VERSION = 3;

export async function runMigrations(db: Database): Promise<void> {
  // Apply the initial schema unconditionally (CREATE TABLE IF NOT
  // EXISTS makes this idempotent).
  await db.exec({ sql: INITIAL_SCHEMA_SQL });

  const current = await currentVersion(db);

  if (current < 1) {
    await db.exec({
      sql: 'INSERT INTO schema_version (version, applied_at) VALUES (1, ?1);',
      bind: [Date.now()],
    });
  }

  if (current < 2) {
    // v2: Chunk → Task rename. `INITIAL_SCHEMA_SQL` above already
    // created the `tasks` table (IF NOT EXISTS) and — on fresh
    // installs — the new `slots` shape with `task_ids`. For DBs
    // that lived through v1 we still need to:
    //   - drop the old empty `chunks` table
    //   - rename `slots.chunk_ids` → `task_ids`
    // Both old artefacts are guaranteed empty because Projects was
    // never wired to the store in v0.2; nothing ever wrote to them.
    await db.exec({ sql: 'DROP TABLE IF EXISTS chunks;' });
    try {
      await db.exec({
        sql: 'ALTER TABLE slots RENAME COLUMN chunk_ids TO task_ids;',
      });
    } catch {
      // Column was created as `task_ids` from the start (fresh v2
      // install) — RENAME fails because there's no `chunk_ids`.
    }
    await db.exec({
      sql: 'INSERT INTO schema_version (version, applied_at) VALUES (2, ?1);',
      bind: [Date.now()],
    });
  }

  if (current < 3) {
    // v3: Tasks-view refactor.
    //   - lines:        +is_default, +archived_at, +deleted_at
    //   - tasks:        +done_at, +archived_at, +deleted_at (status enum
    //                    widened to include 'archived' | 'deleted';
    //                    enum is stored as TEXT so no DDL for that)
    //   - adhoc_events: +task_id, +status, +deleted_at
    // Each ALTER is wrapped in try/catch so a fresh v3 install (where
    // INITIAL_SCHEMA_SQL already put the columns there) doesn't trip on
    // the "duplicate column" error.
    const addColumn = async (sql: string): Promise<void> => {
      try {
        await db.exec({ sql });
      } catch {
        // Column already exists on fresh v3 install — ALTER TABLE ADD
        // COLUMN throws. Ignore.
      }
    };
    await addColumn(
      "ALTER TABLE lines ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;",
    );
    await addColumn('ALTER TABLE lines ADD COLUMN archived_at INTEGER;');
    await addColumn('ALTER TABLE lines ADD COLUMN deleted_at INTEGER;');
    await addColumn('ALTER TABLE tasks ADD COLUMN done_at TEXT;');
    await addColumn('ALTER TABLE tasks ADD COLUMN archived_at TEXT;');
    await addColumn('ALTER TABLE tasks ADD COLUMN deleted_at TEXT;');
    await addColumn('ALTER TABLE adhoc_events ADD COLUMN task_id TEXT;');
    await addColumn(
      "ALTER TABLE adhoc_events ADD COLUMN status TEXT NOT NULL DEFAULT 'active';",
    );
    await addColumn('ALTER TABLE adhoc_events ADD COLUMN deleted_at TEXT;');
    await db.exec({
      sql: 'INSERT INTO schema_version (version, applied_at) VALUES (3, ?1);',
      bind: [Date.now()],
    });
  }
}

async function currentVersion(db: Database): Promise<number> {
  try {
    const rows = await db.query<{ version: number }>({
      sql: 'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;',
    });
    return rows[0]?.version ?? 0;
  } catch {
    return 0;
  }
}
