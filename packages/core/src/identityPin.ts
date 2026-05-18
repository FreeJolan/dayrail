// Pure identity-pin comparison (ERD §7.10.2 · v0.12 P1).
//
// Side-effect-free shared by:
//   - apps/web (IO wrapper in apps/web/src/lib/sync/identityPin.ts)
//   - packages/core tests (direct call · no Drive mock needed)

import type { IdentityPin } from '@dayrail/db/yDocStore';

export type IdentityCheckResult =
  | { kind: 'match' }
  | { kind: 'first-connect'; currentEmail: string }
  | { kind: 'mismatch'; stored: string; current: string }
  | { kind: 'failed'; error: Error };

/** Compare a freshly-fetched account email against a stored pin.
 *  Pure — no IO, no time, no side effects · trivially testable. */
export function compareIdentity(
  currentEmail: string,
  pin: IdentityPin | null,
): IdentityCheckResult {
  if (pin === null) return { kind: 'first-connect', currentEmail };
  if (pin.accountEmail === currentEmail) return { kind: 'match' };
  return { kind: 'mismatch', stored: pin.accountEmail, current: currentEmail };
}
