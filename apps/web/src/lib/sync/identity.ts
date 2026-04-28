// Per-device sync identity + persistent cursors. All values live in
// localStorage so they survive the OPFS reset triggered by an apply-
// remote-bundle pull (resetLocalData wipes OPFS but leaves
// localStorage intact — see lib/resetLocalData.ts).
//
// Why localStorage and not the Zustand store: any value here would
// otherwise leak into the export bundle (and from there into the
// remote `dayrail-snapshot.json`), where it would be wrong on every
// other device that pulls. The set { deviceId, deviceLabel,
// lastPulledSnapshotId, bootSyncChoice, dirtyCount } is strictly
// device-scoped — same rationale as upgradePref.ts.

const KEY_DEVICE_ID = 'dayrail.sync.deviceId';
const KEY_DEVICE_LABEL = 'dayrail.sync.deviceLabel';
const KEY_LAST_PULLED = 'dayrail.sync.lastPulledSnapshotId';
const KEY_BOOT_CHOICE = 'dayrail.sync.bootSyncChoice';
const KEY_DIRTY_COUNT = 'dayrail.sync.dirtyCount';
const KEY_LAST_SYNC_AT = 'dayrail.sync.lastSyncAt';
const KEY_LAST_SYNC_LABEL = 'dayrail.sync.lastSyncLabel';

export type BootSyncChoice = 'auto-pull' | 'ask';
const DEFAULT_BOOT_CHOICE: BootSyncChoice = 'auto-pull';

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing / quota — non-fatal; sync just degrades.
  }
}

function safeRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Same fallback rationale as safeSet.
  }
}

/** Stable per-(browser, OPFS instance) UUID. Generated lazily on the
 *  first read; never rotated. Two devices on the same Google account
 *  but different browsers each produce their own deviceId. */
export function getDeviceId(): string {
  const existing = safeGet(KEY_DEVICE_ID);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  safeSet(KEY_DEVICE_ID, fresh);
  return fresh;
}

/** UA-derived default device label. Best-effort heuristic; users can
 *  override via Settings → 同步. The default never lies on purpose —
 *  if we can't tell, we say "Unknown device". */
function uaDerivedLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const browser = (() => {
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua)) return 'Opera';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Chrome\//i.test(ua)) return 'Chrome';
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
    return 'Browser';
  })();
  const os = (() => {
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
    if (/Windows NT/i.test(ua)) return 'Windows';
    if (/Android/i.test(ua)) return 'Android';
    if (/(iPhone|iPad|iPod)/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown OS';
  })();
  return `${browser} on ${os}`;
}

export function getDeviceLabel(): string {
  const stored = safeGet(KEY_DEVICE_LABEL);
  if (stored && stored.trim().length > 0) return stored;
  return uaDerivedLabel();
}

export function setDeviceLabel(next: string): void {
  const trimmed = next.trim();
  if (trimmed.length === 0) {
    safeRemove(KEY_DEVICE_LABEL);
    return;
  }
  safeSet(KEY_DEVICE_LABEL, trimmed);
}

/** The remote `snapshotId` we last successfully applied (pull) or
 *  produced (push). Diverged-branch detection compares this to the
 *  remote `snapshotId` discovered by the boot-gate probe. */
export function getLastPulledSnapshotId(): string | null {
  return safeGet(KEY_LAST_PULLED);
}

export function setLastPulledSnapshotId(id: string): void {
  safeSet(KEY_LAST_PULLED, id);
}

export function clearLastPulledSnapshotId(): void {
  safeRemove(KEY_LAST_PULLED);
}

/** Remembered boot-sync choice (radio in the linear-lead confirm
 *  card). 'auto-pull' silently pulls and replaces; 'ask' shows the
 *  card every time. The "prefer local once" radio is intentionally
 *  non-memoizable (see ERD §7.6). */
export function getBootSyncChoice(): BootSyncChoice {
  const raw = safeGet(KEY_BOOT_CHOICE);
  return raw === 'auto-pull' || raw === 'ask' ? raw : DEFAULT_BOOT_CHOICE;
}

export function setBootSyncChoice(next: BootSyncChoice): void {
  safeSet(KEY_BOOT_CHOICE, next);
}

/** Counter of local writes since the last successful push or pull.
 *  When > 0 we treat the local DB as "ahead of remote" — the boot
 *  gate uses this to decide between linear-lead and diverged
 *  branches. Bumped from syncController via a Zustand subscription;
 *  cleared on push/pull success. */
export function getDirtyCount(): number {
  const raw = safeGet(KEY_DIRTY_COUNT);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setDirtyCount(n: number): void {
  if (n <= 0) {
    safeRemove(KEY_DIRTY_COUNT);
    return;
  }
  safeSet(KEY_DIRTY_COUNT, String(n));
}

export function bumpDirtyCount(): number {
  const next = getDirtyCount() + 1;
  setDirtyCount(next);
  return next;
}

export function clearDirtyCount(): void {
  safeRemove(KEY_DIRTY_COUNT);
}

/** Timestamp + device label of the last successful sync round-trip.
 *  Used by the top-bar indicator and Settings → 同步. */
export interface LastSyncInfo {
  at: number; // epoch ms
  label: string;
}

export function getLastSyncInfo(): LastSyncInfo | null {
  const at = safeGet(KEY_LAST_SYNC_AT);
  const label = safeGet(KEY_LAST_SYNC_LABEL);
  if (!at) return null;
  const n = Number.parseInt(at, 10);
  if (!Number.isFinite(n)) return null;
  return { at: n, label: label ?? 'this device' };
}

export function setLastSyncInfo(info: LastSyncInfo): void {
  safeSet(KEY_LAST_SYNC_AT, String(info.at));
  safeSet(KEY_LAST_SYNC_LABEL, info.label);
}
