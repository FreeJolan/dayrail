// Pure heartbeat reconcile classifier (ERD §7.10.4 · v0.12 P4).
//
// Boot-time reconcile reads peer heartbeats from Drive appdata,
// hands them in here. Output drives the ✓ / ⚠ / ✕ banner:
//
//   ✓ healthy     — every peer's lastActivityAt <= lastPushedAt + 1h
//   ⚠ peer-stale  — at least one peer was active but didn't push
//                   recently (gap > STALE_THRESHOLD)
//   ✕ offline     — the list query failed (Drive unreachable)
//
// Pure module — no IO. The IO wrapper sits in
// apps/web/src/lib/sync/syncController.ts.

// DeviceHeartbeat lives in apps/web/src/lib/sync/driveBackend (IO
// layer). This module is a pure leaf — it defines its own
// ReconcileHeartbeat shape with just the fields the classifier
// needs, so packages/core stays decoupled from the network layer.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A peer is considered "stale" when its last activity is more than
 *  this many ms ahead of its last successful push — i.e., the peer
 *  was busy but its changes haven't reached Drive yet. */
export const STALE_THRESHOLD_MS = HOUR_MS;

/** Heartbeats older than this are treated as archive-eligible · they
 *  don't participate in banner judgment. P5 will surface a device-
 *  list UI to let the user manually archive earlier. */
export const ARCHIVE_THRESHOLD_MS = 30 * DAY_MS;

export interface ReconcileHeartbeat {
  deviceId: string;
  deviceName: string;
  lastActivityAt: string;
  lastPushedAt: string;
}

export interface PeerSummary {
  deviceName: string;
  lastActivityAt: string;
  lastPushedAt: string;
}

export type ReconcileResult =
  | { kind: 'offline' }
  | { kind: 'no-peers' }
  | { kind: 'healthy'; peers: PeerSummary[] }
  | {
      kind: 'peer-stale';
      stalePeers: PeerSummary[];
      healthyPeers: PeerSummary[];
    };

export interface ReconcileInputs {
  /** Wall clock, epoch ms. */
  nowMs: number;
  /** Heartbeats from Drive · self already filtered out. */
  peerHeartbeats: ReconcileHeartbeat[];
  /** True when the list query succeeded · false when Drive was
   *  unreachable. */
  driveReachable: boolean;
}

export function classifyReconcile(inp: ReconcileInputs): ReconcileResult {
  if (!inp.driveReachable) return { kind: 'offline' };

  // Filter archived peers (no activity within 30 days). They might
  // be a device the user sold / wiped · don't drag the banner into
  // ⚠ on their behalf.
  const live = inp.peerHeartbeats.filter((hb) => {
    const lastActivityMs = Date.parse(hb.lastActivityAt);
    if (Number.isNaN(lastActivityMs)) return false;
    return inp.nowMs - lastActivityMs < ARCHIVE_THRESHOLD_MS;
  });
  if (live.length === 0) return { kind: 'no-peers' };

  const stale: PeerSummary[] = [];
  const healthy: PeerSummary[] = [];
  for (const hb of live) {
    const summary: PeerSummary = {
      deviceName: hb.deviceName,
      lastActivityAt: hb.lastActivityAt,
      lastPushedAt: hb.lastPushedAt,
    };
    const activityMs = Date.parse(hb.lastActivityAt);
    const pushedMs = Date.parse(hb.lastPushedAt);
    if (Number.isNaN(activityMs) || Number.isNaN(pushedMs)) {
      // Corrupted heartbeat · treat as healthy (don't add noise);
      // surfacing it as stale would over-trigger ⚠.
      healthy.push(summary);
      continue;
    }
    if (activityMs > pushedMs + STALE_THRESHOLD_MS) {
      stale.push(summary);
    } else {
      healthy.push(summary);
    }
  }

  if (stale.length > 0) {
    return { kind: 'peer-stale', stalePeers: stale, healthyPeers: healthy };
  }
  return { kind: 'healthy', peers: healthy };
}
