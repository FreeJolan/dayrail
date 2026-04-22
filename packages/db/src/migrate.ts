// Runtime migrator. `INITIAL_SCHEMA_SQL` is the living source of truth;
// every statement is idempotent (`CREATE TABLE IF NOT EXISTS`,
// `CREATE INDEX IF NOT EXISTS`, `DROP TABLE IF EXISTS`) so it's safe
// to re-run on every boot.
//
// Isolation: we split the batch and exec each statement on its own so
// a legacy hiccup (e.g. a v0.3 OPFS DB that has an `events` row shape
// the current indexes reference unknown columns on) can't cascade and
// leave later CREATEs unexecuted. Reported as "no such table: snapshots"
// by a beta user who had carried an older `events` schema across the
// v0.3 → v0.4 cut — the CREATE INDEX on `events(session_id)` threw on
// their DB, which aborted the batch before `snapshots` was created, and
// the cold-start loadLatestSnapshot query then crashed the hydrate.

import type { Database } from './connection';
import { INITIAL_SCHEMA_SQL } from './schema';

export const LATEST_SCHEMA_VERSION = 6;

export async function runMigrations(db: Database): Promise<void> {
  const statements = splitSqlStatements(INITIAL_SCHEMA_SQL);
  for (const stmt of statements) {
    try {
      await db.exec({ sql: stmt });
    } catch (err) {
      // Keep schema evolution forgiving. A failed statement on an
      // older DB (missing column, renamed table, …) shouldn't block
      // later CREATEs. Log so the dev notices if a NEW statement
      // regresses, and proceed with the rest.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        '[dayrail db] schema statement failed; continuing with next:',
        { statement: statementHead(stmt), message },
      );
    }
  }
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

// ------------------------------------------------------------------
// Statement splitter. INITIAL_SCHEMA_SQL is pure DDL — no string
// literals, no triggers, no BEGIN/END blocks — so splitting on `;`
// outside of comments is safe. We strip `--` line comments first so
// a trailing `-- note` on a statement doesn't swallow the terminator.
// ------------------------------------------------------------------

function splitSqlStatements(sql: string): string[] {
  const withoutLineComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
  return withoutLineComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';');
}

function statementHead(stmt: string): string {
  // Trim to the first line + up to ~80 chars — enough to identify which
  // CREATE / DROP a warning is about without spamming the console with
  // full DDL.
  const firstLine = stmt.split('\n', 1)[0] ?? '';
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}
