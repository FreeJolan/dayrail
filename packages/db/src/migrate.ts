// Minimal runtime migrator. We don't pull in drizzle-kit for v0.2
// because browser-side migrations don't need a full file-based
// migrations folder — we maintain a single `INITIAL_SCHEMA_SQL` DDL
// blob + a linear version counter. When the schema evolves, append
// ALTER TABLE statements under their target version and bump
// `LATEST_SCHEMA_VERSION`.

import type { Database } from './connection';
import { INITIAL_SCHEMA_SQL } from './schema';

export const LATEST_SCHEMA_VERSION = 1;

interface VersionRow {
  version: number;
}

export function runMigrations(db: Database): void {
  // Apply the initial schema unconditionally (CREATE TABLE IF NOT
  // EXISTS makes this idempotent).
  db.exec(INITIAL_SCHEMA_SQL);

  const current = currentVersion(db);

  if (current < 1) {
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (1, ?1);`, {
      bind: [Date.now()],
    });
  }

  // Future migrations:
  // if (current < 2) { db.exec("ALTER TABLE ..."); db.exec("INSERT INTO schema_version ..."); }
}

function currentVersion(db: Database): number {
  try {
    const rows: VersionRow[] = [];
    db.exec({
      sql: 'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;',
      rowMode: 'object',
      callback: (row: VersionRow) => {
        rows.push(row);
      },
    });
    return rows[0]?.version ?? 0;
  } catch {
    return 0;
  }
}
