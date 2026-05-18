// Mode regression detection (ERD §7.10.6 · v0.12 P3).
//
// The "data-layer firewall" against silently dropping the UI from
// backup/sync mode back to Local-only. The scenario this protects:
//
//   1. User has been syncing or backing up for weeks (pin written)
//   2. Software bug / OS-level eviction / OAuth credential loss
//      clears the runtime "drive connected" flag (localStorage)
//   3. Without this guard: UI silently switches to Local-only mode ·
//      heartbeat stops · push stops · other devices think this
//      device went away — user has no idea
//
// With this guard: an inconsistency between `pin.lastKnownMode` and
// runtime-inferred mode surfaces the ModeRegressionModal at boot.
// User picks: reconnect / explicit-downgrade / decide-later.
//
// Pure module — no IO, no time. IO wrapper lives in
// apps/web/src/lib/sync/syncController.ts (`checkModeRegressionAtBoot`).

import type { IdentityPin } from '@dayrail/db/yDocStore';

/** Three coarse user modes (ERD §7.10.1). P3 only uses 'local' vs
 *  {backup, sync} as a yes/no distinction; the heartbeat-based
 *  refinement between backup and sync arrives in P5. */
export type RuntimeMode = 'local' | 'backup' | 'sync';

export type ModeRegressionResult =
  | { kind: 'none' }
  | {
      kind: 'regression';
      /** What mode the pin remembers from the last successful run. */
      pinnedMode: 'backup' | 'sync';
      /** Email under which the pin was written · drives the modal's
       *  "之前在和 X 同步" copy. */
      pinnedAccountEmail: string;
    };

/** Detect a mode regression: pin says "we were syncing/backup-ing"
 *  but runtime says "we're local-only now". Pure function — caller
 *  threads in the pin + the runtime-inferred mode. */
export function detectModeRegression(
  pin: IdentityPin | null,
  runtimeMode: RuntimeMode,
): ModeRegressionResult {
  // No pin = never connected on this device = no regression possible.
  if (pin === null) return { kind: 'none' };
  // Runtime still in a sync-capable mode = no regression.
  if (runtimeMode !== 'local') return { kind: 'none' };
  return {
    kind: 'regression',
    pinnedMode: pin.lastKnownMode,
    pinnedAccountEmail: pin.accountEmail,
  };
}

/** Until P5's heartbeat-based mode inference lands, runtime mode is
 *  a simple binary: connected → 'backup', not connected → 'local'.
 *  P5 will widen this to include 'sync' when ≥ 2 active devices
 *  show in heartbeat list. */
export function runtimeModeFromConnection(isConnected: boolean): RuntimeMode {
  return isConnected ? 'backup' : 'local';
}
