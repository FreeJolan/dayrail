// Pure mode inferencer (ERD §7.10.1 · v0.12 P5).
//
// Maps "is this device connected to Drive AND how many other devices
// have written heartbeats" into the three-tier sync mode:
//
//   'local'  — Drive not connected
//   'backup' — connected + no other live peer (single-device sync state)
//   'sync'   — connected + at least one other live peer
//
// "Live peer" = a heartbeat younger than the heartbeatStatus archive
// threshold (30 days). Stale heartbeats don't count — a device the
// user forgot about three months ago shouldn't keep us in sync mode.
//
// Pure leaf module · the IO wrapper in apps/web threads in the
// peer count from `listHeartbeats` + `isDriveConnected`.

export type SyncMode = 'local' | 'backup' | 'sync';

export interface InferModeInputs {
  isConnected: boolean;
  /** Count of *live* peer heartbeats (caller filters out self +
   *  archived). 0 = single-device · ≥1 = multi-device. */
  livePeerCount: number;
}

export function inferModeFromHeartbeats(inp: InferModeInputs): SyncMode {
  if (!inp.isConnected) return 'local';
  if (inp.livePeerCount <= 0) return 'backup';
  return 'sync';
}
