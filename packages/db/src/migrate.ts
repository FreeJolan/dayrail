// Minimal runtime migrator. Pre-release / solo-dev phase — we don't
// carry a migration staircase: `INITIAL_SCHEMA_SQL` is the living
// source of truth, and when it evolves the dev clears OPFS and
// reseeds. `schema_version` is stamped once per fresh DB for future
// use when we do start shipping to users.

import type { Database } from './connection';
import { INITIAL_SCHEMA_SQL } from './schema';

export const LATEST_SCHEMA_VERSION = 3;

export async function runMigrations(db: Database): Promise<void> {
  await db.exec({ sql: INITIAL_SCHEMA_SQL });
  const current = await currentVersion(db);
  if (current < LATEST_SCHEMA_VERSION) {
    await db.exec({
      sql: 'INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2);',
      bind: [LATEST_SCHEMA_VERSION, Date.now()],
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
