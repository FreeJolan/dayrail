// Event bus — append-only event log atop @dayrail/db.
//
// Each UI mutation dispatches a typed `Event` through `appendEvent`.
// The event is written to the `events` table with a fresh HLC; the
// store's reducer then updates the in-memory domain tables.
//
// All DB access here is async (the DB lives in a dedicated worker;
// see @dayrail/db/connection for why).

import { getDb } from '@dayrail/db';
import { nextHLC, type HLC } from './hlc';

// ------------------------------------------------------------------
// Typed event vocabulary. Types live in strict string literals rather
// than a TS enum so that they survive JSON serialisation round-trips.
// ------------------------------------------------------------------

export type EventType =
  // Rail / Template edits (Template Editor session)
  | 'rail.created'
  | 'rail.updated'
  | 'rail.deleted'
  | 'template.created'
  | 'template.updated'
  | 'template.deleted'
  // Shift records (anchored to Task from v0.4)
  | 'shift.recorded'
  // Check-in surface (Signal response)
  | 'signal.acted'
  // Cycle planning (Cycle View session)
  | 'cycle.created'
  | 'cycle.upserted'
  | 'cycle.removed'
  | 'cycleday.template-changed'
  | 'slot.assigned'
  | 'slot.cleared'
  // Projects (Lines)
  | 'line.created'
  | 'line.updated'
  | 'line.restored'
  | 'line.deleted'
  | 'line.purged'
  // Tasks (units of work inside a Line, §5.5)
  | 'task.created'
  | 'task.updated'
  | 'task.scheduled'
  | 'task.unscheduled'
  | 'task.archived'
  | 'task.restored'
  | 'task.deleted'
  | 'task.purged'
  // Calendar rules
  | 'calendar-rule.upserted'
  | 'calendar-rule.removed'
  // Ad-hoc Events
  | 'adhoc.created'
  | 'adhoc.updated'
  | 'adhoc.deleted'
  | 'adhoc.restored'
  // Habit-phase tracking (§5.5.0; v0.3.3+)
  | 'habit-phase.upserted'
  | 'habit-phase.removed'
  // Habit bindings — habit ↔ rail relationship (§5.5.0; v0.4+)
  | 'habit-binding.upserted'
  | 'habit-binding.removed';

export interface AppEvent<T extends EventType = EventType> {
  id: string;
  aggregateId: string;
  type: T;
  payload: Record<string, unknown>;
  hlc: HLC;
  sessionId?: string;
}

// In-process clock. On startup we seed it from MAX(hlc) in the events
// table so replay ordering stays monotonic across reloads.
let _clock: HLC = { wall: Date.now(), logical: 0 };

export async function initClock(): Promise<void> {
  const db = await getDb();
  const rows = await db.query<{ wall: number; logical: number }>({
    sql: 'SELECT hlc_wall AS wall, hlc_logical AS logical FROM events ORDER BY hlc_wall DESC, hlc_logical DESC LIMIT 1;',
  });
  if (rows.length > 0 && rows[0]) {
    _clock = { wall: rows[0].wall, logical: rows[0].logical };
  } else {
    _clock = { wall: Date.now(), logical: 0 };
  }
}

export function currentClock(): HLC {
  return _clock;
}

// ULID-lite: timestamp + random, 26 chars total, lexicographic sort
// matches timestamp order. Good enough for single-user multi-device.
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
// Write side.
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
  await db.exec({
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
  return event;
}

// ------------------------------------------------------------------
// Read side.
// ------------------------------------------------------------------

interface EventRow {
  id: string;
  aggregate_id: string;
  type: string;
  payload: string;
  hlc_wall: number;
  hlc_logical: number;
  session_id: string | null;
}

export async function loadEvents(
  opts: { sinceHlc?: HLC; sessionId?: string } = {},
): Promise<AppEvent[]> {
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
  const rows = await db.query<EventRow>({
    sql: `SELECT id, aggregate_id, type, payload, hlc_wall, hlc_logical, session_id
          FROM events ${where}
          ORDER BY hlc_wall ASC, hlc_logical ASC, id ASC;`,
    bind: binds,
  });
  return rows.map((row) => ({
    id: row.id,
    aggregateId: row.aggregate_id,
    type: row.type as EventType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    hlc: { wall: row.hlc_wall, logical: row.hlc_logical },
    sessionId: row.session_id ?? undefined,
  }));
}

/** Drop every event tagged with the given session — implements the
 *  ⤺ Undo this edit session button from §5.3.1. */
export async function dropSessionEvents(sessionId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ n: number }>({
    sql: 'SELECT COUNT(*) AS n FROM events WHERE session_id = ?1;',
    bind: [sessionId],
  });
  const count = rows[0]?.n ?? 0;
  await db.exec({
    sql: 'DELETE FROM events WHERE session_id = ?1;',
    bind: [sessionId],
  });
  return count;
}
