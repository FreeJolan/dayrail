// Hybrid Logical Clock (HLC) per docs/v0.2-plan.md.
//
//   - wall     : ms since epoch. Preserves "what wall-clock did this
//                happen at?", critical for Pending's >7d query and
//                Review's per-period aggregates.
//   - logical  : counter that disambiguates events within the same ms
//                and survives clock regression across devices.
//
// Sort order: (wall ASC, logical ASC, then event-id tiebreak in the
// event log) gives a total order consistent with causality.
//
// Storage: we persist both columns in `events.hlc_wall` + `events.hlc_logical`
// so a replay simply walks rows in that composite-index order.

export interface HLC {
  wall: number;
  logical: number;
}

/** Fresh clock pinned to real wall time. */
export function initialHLC(now = Date.now()): HLC {
  return { wall: now, logical: 0 };
}

/** Advance the clock locally (used when emitting a new event on THIS
 *  device). If wall-clock time has advanced past `prev.wall`, start a
 *  new logical run at 0; otherwise bump the counter. */
export function nextHLC(prev: HLC, now = Date.now()): HLC {
  if (now > prev.wall) return { wall: now, logical: 0 };
  return { wall: prev.wall, logical: prev.logical + 1 };
}

/** Merge with a remote HLC (used when receiving an event from another
 *  device during sync). Preserves `max(local, remote, now)` wall value
 *  and picks a logical counter that stays monotonic. */
export function mergeHLC(local: HLC, remote: HLC, now = Date.now()): HLC {
  const maxWall = Math.max(local.wall, remote.wall, now);
  if (maxWall === now && maxWall !== local.wall && maxWall !== remote.wall) {
    return { wall: now, logical: 0 };
  }
  if (maxWall === local.wall && maxWall === remote.wall) {
    return { wall: maxWall, logical: Math.max(local.logical, remote.logical) + 1 };
  }
  if (maxWall === local.wall) return { wall: maxWall, logical: local.logical + 1 };
  return { wall: maxWall, logical: remote.logical + 1 };
}

/** Total order comparator. Returns negative if `a < b`, zero for
 *  equality, positive otherwise. */
export function compareHLC(a: HLC, b: HLC): number {
  if (a.wall !== b.wall) return a.wall - b.wall;
  return a.logical - b.logical;
}

/** Human-facing string for debugging: `14:27:00.123/0002`. */
export function formatHLC(h: HLC): string {
  const d = new Date(h.wall);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const log = String(h.logical).padStart(4, '0');
  return `${hh}:${mm}:${ss}.${ms}/${log}`;
}
