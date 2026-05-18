// Identity pinning verification + first-connect / overwrite helpers
// (ERD §7.10.2 · v0.12 P1).
//
// The pin itself lives in SyncMeta (see identity.ts + yDocStore.ts).
// This module wraps the IO (Drive /about) and the pure comparison
// logic. Three callers:
//
//   1. `connectDrive()` success path (BootGate + SettingsSections)
//      → check after every consent / reconnect.
//   2. `runPush()` start (syncController) → re-check before any
//      upload, blocks push on mismatch.
//   3. tests → call `compareIdentity` directly with mocked email.

import { compareIdentity, type IdentityCheckResult } from '@dayrail/core';
import { getCurrentAccountEmail } from './driveBackend';
import { getIdentityPin, setIdentityPin } from './identity';

export type { IdentityCheckResult };

/** Fetch the current Drive account email and classify against the
 *  stored pin. 'failed' is a soft outcome — caller treats it as
 *  transient and lets the next push / reconnect retry. */
export async function checkAccountIdentity(): Promise<IdentityCheckResult> {
  let currentEmail: string | null;
  try {
    currentEmail = await getCurrentAccountEmail();
  } catch (err) {
    return {
      kind: 'failed',
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
  if (currentEmail === null) {
    return {
      kind: 'failed',
      error: new Error('Drive /about returned no email'),
    };
  }
  return compareIdentity(currentEmail, getIdentityPin());
}

/** Write the initial pin on first-connect. `lastKnownMode` defaults
 *  to 'backup' (single active device) — the heartbeat layer (P4) is
 *  what later promotes a pin's mode to 'sync'. */
export function recordFirstConnect(
  email: string,
  appdataFileId: string | null,
): void {
  setIdentityPin({
    accountEmail: email,
    appdataFileId,
    lastKnownMode: 'backup',
    pinnedAt: new Date().toISOString(),
  });
}

/** Overwrite the pin to a new account ("switch to this account"
 *  branch of the mismatch modal). Other sync cursors (lastPulled,
 *  samplesOnly, etc.) are reset by the caller — that lives outside
 *  this module's concern. */
export function pinNewAccount(email: string): void {
  setIdentityPin({
    accountEmail: email,
    appdataFileId: null,
    lastKnownMode: 'backup',
    pinnedAt: new Date().toISOString(),
  });
}
