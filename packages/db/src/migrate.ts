// Minimal runtime migrator. We don't pull in drizzle-kit for v0.2
// because browser-side migrations don't need a full file-based
// migrations folder — we maintain a single `INITIAL_SCHEMA_SQL` DDL
// blob + a linear version counter. When the schema evolves, append
// ALTER TABLE statements under their target version and bump
// `LATEST_SCHEMA_VERSION`.

import type { Database } from './connection';
import { INITIAL_SCHEMA_SQL } from './schema';

export const LATEST_SCHEMA_VERSION = 1;

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

  // Future migrations: guard with version check, then bump.
  // if (current < 2) { await db.exec(...); await db.exec("INSERT INTO schema_version ..."); }
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
