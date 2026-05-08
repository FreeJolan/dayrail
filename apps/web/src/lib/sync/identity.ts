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
const KEY_SAMPLES_ONLY = 'dayrail.sync.samplesOnly';
// Sanity-check baseline (added 2026-05-08 after data-loss incident).
// Counts of key entities at the moment of the last successful push.
// runPush compares the current state's counts against this and warns
// the user via window.confirm when a major drop is detected (e.g.
// templates went from 2 → 0 because OPFS was wiped between v0.9.0
// and v0.9.1). Empty / null when no successful push has happened yet
// on this device.
const KEY_LAST_PUSHED_COUNTS = 'dayrail.sync.lastPushedCounts';

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

/** Cached host info populated at boot on Tauri runtime (see
 *  `populateAutoDeviceLabel` in boot.ts). On PWA / before boot
 *  fills it, returns null and getDeviceLabel falls back to the
 *  UA-derived label. */
const KEY_DEVICE_AUTO_LABEL = 'dayrail.device.autoLabel';

export function getAutoDetectedDeviceLabel(): string | null {
  return safeGet(KEY_DEVICE_AUTO_LABEL);
}

export function setAutoDetectedDeviceLabel(label: string): void {
  if (label.trim().length === 0) return;
  safeSet(KEY_DEVICE_AUTO_LABEL, label.trim());
}

/** Resolution order:
 *    1. user-set override (Settings → 同步 → 本设备名)
 *    2. auto-detected hostname (Tauri side, populated at boot)
 *    3. UA-derived "Browser on macOS" fallback
 *  The first non-empty wins. The user override stays sticky across
 *  device-name changes — no clobbering by re-detection. */
export function getDeviceLabel(): string {
  const stored = safeGet(KEY_DEVICE_LABEL);
  if (stored && stored.trim().length > 0) return stored;
  const auto = getAutoDetectedDeviceLabel();
  if (auto && auto.trim().length > 0) return auto;
  return uaDerivedLabel();
}

// Sanity-check counts at last successful push. Used by runPush to
// detect "the local Y.Doc looks suspiciously empty compared to what
// we last pushed" before overwriting Drive.
export interface LastPushedCounts {
  templates: number;
  tasks: number;
  lines: number;
  reflections: number;
  /** ISO timestamp of when these counts were captured. */
  at: string;
}

export function getLastPushedCounts(): LastPushedCounts | null {
  const raw = safeGet(KEY_LAST_PUSHED_COUNTS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastPushedCounts>;
    if (
      typeof parsed.templates === 'number' &&
      typeof parsed.tasks === 'number' &&
      typeof parsed.lines === 'number' &&
      typeof parsed.reflections === 'number' &&
      typeof parsed.at === 'string'
    ) {
      return parsed as LastPushedCounts;
    }
  } catch {
    // corrupted entry — drop it
  }
  return null;
}

export function setLastPushedCounts(counts: Omit<LastPushedCounts, 'at'>): void {
  const payload: LastPushedCounts = { ...counts, at: new Date().toISOString() };
  safeSet(KEY_LAST_PUSHED_COUNTS, JSON.stringify(payload));
}

/** The user's explicit override only — ignores auto / UA fallbacks.
 *  The Settings input binds to this so clearing the field clears the
 *  override visibly (placeholder takes over showing the resolved
 *  default). */
export function getDeviceLabelOverride(): string {
  return safeGet(KEY_DEVICE_LABEL) ?? '';
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

/** "Local Y.Doc holds only the v0.7 first-run sample seed; nothing
 *  the user has authored sits on this device." Used to gate the
 *  destructive "first-connect / first-pull" replace-from-remote
 *  flow against the migration scenario, where the user has just
 *  imported real data via tools/migrate + Settings → "Import from
 *  snapshot" and `lastPulledSnapshotId === null` is true even
 *  though local data is precious.
 *
 *  Set by `boot.ts.seedFromSamples` after the seed completes.
 *  Cleared by:
 *    - `importLocalData` (the user just brought in data they care
 *      about — definitely NOT samples-only).
 *    - `syncController.startSyncBackgroundLoop`'s afterTransaction
 *      listener on the first user-authored transact (any non-
 *      REMOTE_ORIGIN / OPFS_ORIGIN write means we have authored
 *      content beyond the seed).
 *    - The first successful pull / push (after the device has
 *      synced, lastPulledSnapshotId is no longer null and the
 *      gate the flag protects no longer fires anyway). */
export function setLocalIsSamplesOnly(): void {
  safeSet(KEY_SAMPLES_ONLY, '1');
}

export function clearLocalIsSamplesOnly(): void {
  safeRemove(KEY_SAMPLES_ONLY);
}

export function isLocalSamplesOnly(): boolean {
  return safeGet(KEY_SAMPLES_ONLY) === '1';
}

// ============ Session-scoped sync probe suppression ============
//
// When the user has connected Drive in a prior browser session
// (`KEY_CONNECTED='1'` persisted) but explicitly chooses "continue
// local" on the BootGate offline / needs-reconnect panel, we don't
// want to keep probing — every 5-minute periodic tick + every
// visibility/online event would otherwise re-attempt silent token
// refresh and surface another Google popup.
//
// The flag lives in **sessionStorage** so it scopes to the current
// browser tab/session. Refreshing the tab clears it (deliberate: the
// user might want sync to resume after a fresh start). For permanent
// disconnect the user goes through Settings → 同步 → 断开连接, which
// calls `disconnectDrive()` and clears `KEY_CONNECTED` outright.

const KEY_PROBE_SUPPRESSED = 'dayrail.sync.bootProbeSuppressed';

function safeSetSession(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* private mode / storage full — non-fatal */
  }
}

function safeGetSession(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True when the user dismissed an auto-sync prompt in this session.
 *  All sync-touching code paths (BootGate auto-probe, RuntimeSyncDialog
 *  periodic probe, syncController push) skip when this is true. */
export function isSyncProbeSuppressed(): boolean {
  return safeGetSession(KEY_PROBE_SUPPRESSED) === '1';
}

/** Called when the user clicks "继续使用本地" on the BootGate offline
 *  panel. Effective for the current session only. */
export function setSyncProbeSuppressed(): void {
  safeSetSession(KEY_PROBE_SUPPRESSED, '1');
}
