// Event bus — append-only event log atop @dayrail/db.
//
// Each UI mutation dispatches a typed `Event` through `appendEvent`.
// The event is written to the `events` table with a fresh HLC, then
// the matching reducer mutates the materialised domain tables.
//
// Reducers live out of here — event.ts only concerns itself with the
// append-side of the pipeline. The `store` module wires reducers in.

import { getDb, type Database } from '@dayrail/db';
import { nextHLC, type HLC } from './hlc';

// ------------------------------------------------------------------
// Typed event vocabulary. Types live in strict string literals rather
// than a TS enum so that they survive JSON serialisation round-trips.
// Add new event types by extending this union; reducers are matched
// exhaustively on `type`.
// ------------------------------------------------------------------

export type EventType =
  // --- Rail / template edits (Template Editor session) ---
  | 'rail.created'
  | 'rail.updated'
  | 'rail.deleted'
  | 'template.created'
  | 'template.updated'
  | 'template.deleted'
  // --- RailInstance (Today Track / Pending) ---
  | 'instance.created'
  | 'instance.status-changed'
  | 'instance.time-shifted'
  // --- Shift records ---
  | 'shift.recorded'
  // --- Check-in surface (Signal response) ---
  | 'signal.acted'
  // --- Cycle planning (Cycle View session) ---
  | 'cycle.created'
  | 'cycleday.template-changed'
  | 'slot.assigned'
  | 'slot.cleared'
  // --- Projects ---
  | 'line.created'
  | 'line.updated'
  | 'line.archived'
  | 'chunk.created'
  | 'chunk.updated'
  | 'chunk.scheduled'
  // --- Calendar rules ---
  | 'calendar-rule.upserted'
  | 'calendar-rule.removed'
  | 'adhoc.created'
  | 'adhoc.removed';

export interface AppEvent<T extends EventType = EventType> {
  id: string;
  aggregateId: string;
  type: T;
  payload: Record<string, unknown>;
  hlc: HLC;
  sessionId?: string;
}

// Small in-process clock. The authoritative HLC lives in memory across
// the session; on startup we seed it from `MAX(hlc_wall, hlc_logical)`
// in the events table so replay ordering stays monotonic after reload.
let _clock: HLC = { wall: Date.now(), logical: 0 };

export async function initClock(): Promise<void> {
  const db = await getDb();
  let highest: HLC = { wall: Date.now(), logical: 0 };
  db.exec({
    sql: 'SELECT hlc_wall AS wall, hlc_logical AS logical FROM events ORDER BY hlc_wall DESC, hlc_logical DESC LIMIT 1;',
    rowMode: 'object',
    callback: (row: { wall: number; logical: number }) => {
      highest = { wall: row.wall, logical: row.logical };
    },
  });
  _clock = highest;
}

export function currentClock(): HLC {
  return _clock;
}

// ULID-lite: timestamp + random, 26 chars total, sorts lexicographically
// in the same order as its timestamp. Good enough for single-user multi-
// device without pulling in a dedicated ULID library.
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(ts = Date.now()): string {
  let time = '';
  let t = ts;
  for (let i = 0; i < 10; i++) {
    time = ULID_CHARS.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += ULID_CHARS.charAt(Math.floor(Math.random() * 32));
  }
  return time + rand;
}

// ------------------------------------------------------------------
// Append an event. This is the ONLY mutation path into the event log.
// ------------------------------------------------------------------
export interface AppendInput<T extends EventType = EventType> {
  aggregateId: string;
  type: T;
  payload?: Record<string, unknown>;
  sessionId?: string;
}

export async function appendEvent<T extends EventType>(
  input: AppendInput<T>,
): Promise<AppEvent<T>> {
  const db = await getDb();
  const hlc = nextHLC(_clock);
  _clock = hlc;
  const event: AppEvent<T> = {
    id: ulid(hlc.wall),
    aggregateId: input.aggregateId,
    type: input.type,
    payload: input.payload ?? {},
    hlc,
    sessionId: input.sessionId,
  };
  insertEventRow(db, event);
  return event;
}

/** Low-level insert — exported for tests + snapshot replay only.
 *  Downstream code should use `appendEvent` for normal writes. */
export function insertEventRow(db: Database, event: AppEvent): void {
  db.exec({
    sql: `INSERT INTO events (id, aggregate_id, type, payload, hlc_wall, hlc_logical, session_id, archived)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0);`,
    bind: [
      event.id,
      event.aggregateId,
      event.type,
      JSON.stringify(event.payload),
      event.hlc.wall,
      event.hlc.logical,
      event.sessionId ?? null,
    ],
  });
}

// ------------------------------------------------------------------
// Read-side: walk events in replay order.
// ------------------------------------------------------------------

export async function loadEvents(opts: {
  sinceHlc?: HLC;
  sessionId?: string;
} = {}): Promise<AppEvent[]> {
  const db = await getDb();
  const filters: string[] = ['archived = 0'];
  const binds: (string | number)[] = [];
  if (opts.sinceHlc) {
    filters.push(
      '(hlc_wall > ?' +
        (binds.length + 1) +
        ' OR (hlc_wall = ?' +
        (binds.length + 1) +
        ' AND hlc_logical > ?' +
        (binds.length + 2) +
        '))',
    );
    binds.push(opts.sinceHlc.wall, opts.sinceHlc.logical);
  }
  if (opts.sessionId) {
    filters.push('session_id = ?' + (binds.length + 1));
    binds.push(opts.sessionId);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows: AppEvent[] = [];
  db.exec({
    sql: `SELECT id, aggregate_id, type, payload, hlc_wall, hlc_logical, session_id
          FROM events ${where}
          ORDER BY hlc_wall ASC, hlc_logical ASC, id ASC;`,
    bind: binds,
    rowMode: 'object',
    callback: (row: {
      id: string;
      aggregate_id: string;
      type: string;
      payload: string;
      hlc_wall: number;
      hlc_logical: number;
      session_id: string | null;
    }) => {
      rows.push({
        id: row.id,
        aggregateId: row.aggregate_id,
        type: row.type as EventType,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
        hlc: { wall: row.hlc_wall, logical: row.hlc_logical },
        sessionId: row.session_id ?? undefined,
      });
    },
  });
  return rows;
}

/** Delete every event belonging to the given session — used by
 *  `⤺ Undo this edit session` (§5.3.1). Because events are append-
 *  only elsewhere, this is the single supported destructive op. */
export async function dropSessionEvents(sessionId: string): Promise<number> {
  const db = await getDb();
  let count = 0;
  db.exec({
    sql: 'SELECT COUNT(*) AS n FROM events WHERE session_id = ?1;',
    bind: [sessionId],
    rowMode: 'object',
    callback: (row: { n: number }) => {
      count = row.n;
    },
  });
  db.exec({
    sql: 'DELETE FROM events WHERE session_id = ?1;',
    bind: [sessionId],
  });
  return count;
}
