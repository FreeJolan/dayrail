// Edit Session registry (ERD §5.3.1).
//
// Sessions exist to make Template Editor / Cycle planning feel safe:
// "mess things up and hit ⤺ Undo this edit" rolls back every mutation
// that carried the same sessionId.
//
// Lifecycle:
//   - openSession(surface) on view mount
//   - every mutation the view performs passes sessionId in the event
//   - touchSession() on each mutation → resets the idle timer
//   - closeSession() on view unmount OR after 15 min idle
//   - after closeSession, the session is "archived": still visible in
//     the session table but no longer eligible for batch undo.

import { getDb, type Database } from '@dayrail/db';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export interface EditSession {
  id: string;
  surface: string;
  openedAt: number;
  lastActivityAt: number;
  changeCount: number;
  closed: boolean;
}

const activeSessions = new Map<string, EditSession>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<(session: EditSession) => void>();

function ulidLite(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${t}-${r}`;
}

/** Subscribe to change-count / closed-state updates on any session. */
export function onSessionChange(fn: (session: EditSession) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(session: EditSession): void {
  for (const fn of listeners) fn(session);
}

export async function openSession(surface: string): Promise<EditSession> {
  const db = await getDb();
  const now = Date.now();
  const session: EditSession = {
    id: ulidLite(),
    surface,
    openedAt: now,
    lastActivityAt: now,
    changeCount: 0,
    closed: false,
  };
  db.exec({
    sql: `INSERT INTO sessions (id, surface, opened_at, last_activity_at, change_count)
          VALUES (?1, ?2, ?3, ?4, 0);`,
    bind: [session.id, session.surface, session.openedAt, session.lastActivityAt],
  });
  activeSessions.set(session.id, session);
  armIdle(session.id);
  emit(session);
  return session;
}

/** Bump `lastActivityAt` + `changeCount`. Call from the event bus for
 *  each event that carries this sessionId. */
export async function touchSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session || session.closed) return;
  const now = Date.now();
  session.lastActivityAt = now;
  session.changeCount += 1;
  const db = await getDb();
  db.exec({
    sql: `UPDATE sessions SET last_activity_at = ?1, change_count = change_count + 1 WHERE id = ?2;`,
    bind: [now, sessionId],
  });
  armIdle(sessionId);
  emit(session);
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session || session.closed) return;
  session.closed = true;
  const now = Date.now();
  const db = await getDb();
  db.exec({
    sql: `UPDATE sessions SET closed_at = ?1 WHERE id = ?2;`,
    bind: [now, sessionId],
  });
  clearIdle(sessionId);
  emit(session);
  activeSessions.delete(sessionId);
}

export function getSession(sessionId: string): EditSession | undefined {
  return activeSessions.get(sessionId);
}

/** Snapshot of every currently-active session (used by diagnostics UI). */
export function listActiveSessions(): EditSession[] {
  return [...activeSessions.values()];
}

// ------------------------------------------------------------------
// Idle timer plumbing.
// ------------------------------------------------------------------

function armIdle(sessionId: string): void {
  clearIdle(sessionId);
  const t = setTimeout(() => {
    void closeSession(sessionId);
  }, IDLE_TIMEOUT_MS);
  idleTimers.set(sessionId, t);
}

function clearIdle(sessionId: string): void {
  const t = idleTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    idleTimers.delete(sessionId);
  }
}

// ------------------------------------------------------------------
// Diagnostic: load persisted session rows for recovery on app start.
// ------------------------------------------------------------------

export async function recoverActiveSessions(): Promise<EditSession[]> {
  const db: Database = await getDb();
  const recovered: EditSession[] = [];
  db.exec({
    sql: `SELECT id, surface, opened_at, last_activity_at, change_count, closed_at
          FROM sessions WHERE closed_at IS NULL;`,
    rowMode: 'object',
    callback: (row: {
      id: string;
      surface: string;
      opened_at: number;
      last_activity_at: number;
      change_count: number;
      closed_at: number | null;
    }) => {
      const s: EditSession = {
        id: row.id,
        surface: row.surface,
        openedAt: row.opened_at,
        lastActivityAt: row.last_activity_at,
        changeCount: row.change_count,
        closed: row.closed_at != null,
      };
      // If the session was left idle beyond the timeout while the app
      // was closed, mark it closed on recovery rather than resurrect it.
      if (Date.now() - s.lastActivityAt > IDLE_TIMEOUT_MS) {
        db.exec({
          sql: `UPDATE sessions SET closed_at = ?1 WHERE id = ?2;`,
          bind: [Date.now(), s.id],
        });
        s.closed = true;
      } else {
        activeSessions.set(s.id, s);
        armIdle(s.id);
      }
      recovered.push(s);
    },
  });
  return recovered;
}
