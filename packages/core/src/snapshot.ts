// Snapshot writer — shortcuts cold-start replay by materialising the
// reducer's state into the `snapshots` table on a cadence.
//
// Cadence (docs/v0.2-plan.md §2):
//   - On document visibility flipping to 'hidden', write a snapshot if
//     any events have landed since the last one. Covers normal "close
//     the tab / switch apps" flows without explicit save UI.
//   - If the unsnapshotted counter crosses 500, write immediately. A
//     safety net for power users who never close the tab.
//
// Hydrate uses the most recent snapshot as the base state; only events
// with HLC > snapshot.hlc are replayed. The counter is seeded with the
// count of post-snapshot events at hydration time so the next threshold
// check keeps its invariant.

import { getDb } from '@dayrail/db';
import type { HLC } from './hlc';

export interface Snapshot<S> {
  id: string;
  hlc: HLC;
  createdAt: number;
  state: S;
  eventCount: number;
}

interface SnapshotRow {
  id: string;
  hlc_wall: number;
  hlc_logical: number;
  created_at: number;
  state: string;
  event_count: number;
}

const THRESHOLD = 500;

let unsnapshotted = 0;

export function unsnapshottedCount(): number {
  return unsnapshotted;
}

export function resetUnsnapshotted(count = 0): void {
  unsnapshotted = count;
}

export function noteEvent(): void {
  unsnapshotted += 1;
}

export async function loadLatestSnapshot<S>(): Promise<Snapshot<S> | null> {
  const db = await getDb();
  const rows = await db.query<SnapshotRow>({
    sql: `SELECT id, hlc_wall, hlc_logical, created_at, state, event_count
          FROM snapshots ORDER BY hlc_wall DESC, hlc_logical DESC LIMIT 1;`,
  });
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    hlc: { wall: row.hlc_wall, logical: row.hlc_logical },
    createdAt: row.created_at,
    state: JSON.parse(row.state) as S,
    eventCount: row.event_count,
  };
}

export async function writeSnapshot<S>(
  state: S,
  hlc: HLC,
  eventCount: number,
): Promise<Snapshot<S>> {
  const db = await getDb();
  const id = `snap-${hlc.wall.toString(36)}-${hlc.logical.toString(36)}`;
  const createdAt = Date.now();
  const stateJson = JSON.stringify(state);
  // OR IGNORE keeps the call idempotent if two triggers race at the
  // exact same HLC (visibilitychange + threshold, say).
  await db.exec({
    sql: `INSERT OR IGNORE INTO snapshots
            (id, hlc_wall, hlc_logical, created_at, state, event_count)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6);`,
    bind: [id, hlc.wall, hlc.logical, createdAt, stateJson, eventCount],
  });
  unsnapshotted = 0;
  return { id, hlc, createdAt, state, eventCount };
}

/** Wipe every stored snapshot. Called after undoing an edit session
 *  because any surviving snapshot may have baked the undone events
 *  into its state blob. The next cold start pays a full replay until
 *  a fresh snapshot is written. */
export async function clearSnapshots(): Promise<void> {
  const db = await getDb();
  await db.exec({ sql: 'DELETE FROM snapshots;' });
  unsnapshotted = 0;
}

// ------------------------------------------------------------------
// Cadence triggers — the store wires these up once at boot.
// ------------------------------------------------------------------

type WriteFn = () => void | Promise<void>;

/** Call from the mutation path after each appended event. Returns true
 *  if the 500-event threshold was just crossed — the caller should then
 *  kick off `writeSnapshot` with its current state. */
export function shouldSnapshotAfterEvent(): boolean {
  return unsnapshotted >= THRESHOLD;
}

/** Install a visibilitychange handler that fires `onHide` when the tab
 *  is about to be backgrounded AND there is at least one unsnapshotted
 *  event. Returns a cleanup function.
 *
 *  NB: we intentionally don't await `onHide` — the tab may be closing
 *  and the promise may never resolve. SQLite writes go through a
 *  dedicated worker anyway, which survives the page briefly. */
export function armSnapshotOnHide(onHide: WriteFn): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handler = (): void => {
    if (document.visibilityState === 'hidden' && unsnapshotted > 0) {
      void onHide();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
