// Per-device sync identity + persistent cursors.
//
// As of ERD §7.9 the keys split two ways:
//
//   1. **Sync-lineage cursors** (lastPulledSnapshotId, lastSyncAt,
//      lastSyncLabel, samplesOnly, dirtyCount, lastPushedCounts,
//      bootSyncChoice) live in the YDocStore — co-resident with the
//      Y.Doc bytes they describe. The public API on this module is
//      still synchronous; reads/writes go through an in-memory cache
//      hydrated at boot, with fire-and-forget async flushes to the
//      store. This way the 20+ call sites in syncController don't
//      need to become async.
//
//   2. **Device identity + session flags** (deviceId, deviceLabel,
//      autoLabel, bootProbeSuppressed) stay in localStorage /
//      sessionStorage. They're not bound to data — keeping them
//      across a `resetLocalData()` is the right semantic ("still the
//      same device after a reset").
//
// `loadSyncMetaCache()` MUST be awaited before any sync-lineage
// getter/setter is called. boot.ts does this early — before hydrate,
// before BootGate, before sync controller wiring.

import {
  DEFAULT_SYNC_META,
  getYDocStore,
  type IdentityPin,
  type LastPushedCounts,
  type SyncAttempt,
  type SyncMeta,
} from '@dayrail/db/yDocStore';

// Re-export for syncController / SettingsSections consumers that
// previously imported the type from here.
export type { IdentityPin, LastPushedCounts, SyncAttempt };

/** Ring-buffer cap for `recentAttempts`. Older entries drop off the
 *  back as new ones append. The full diagnostic view in Settings →
 *  同步 → 故障历史 walks this list. */
const RECENT_ATTEMPTS_MAX = 100;

// ============ device identity / OAuth cache (localStorage) ============

const KEY_DEVICE_ID = 'dayrail.sync.deviceId';
const KEY_DEVICE_LABEL = 'dayrail.sync.deviceLabel';
const KEY_DEVICE_AUTO_LABEL = 'dayrail.device.autoLabel';

// ============ sync-lineage cursors (migrated to YDocStore) ============
//
// Legacy localStorage keys — read once at boot for the §7.9
// migration, then deleted. New writes go to the in-memory cache and
// fire-and-forget into the store.

const LEGACY_KEY_LAST_PULLED = 'dayrail.sync.lastPulledSnapshotId';
const LEGACY_KEY_BOOT_CHOICE = 'dayrail.sync.bootSyncChoice';
const LEGACY_KEY_DIRTY_COUNT = 'dayrail.sync.dirtyCount';
const LEGACY_KEY_LAST_SYNC_AT = 'dayrail.sync.lastSyncAt';
const LEGACY_KEY_LAST_SYNC_LABEL = 'dayrail.sync.lastSyncLabel';
const LEGACY_KEY_SAMPLES_ONLY = 'dayrail.sync.samplesOnly';
const LEGACY_KEY_LAST_PUSHED_COUNTS = 'dayrail.sync.lastPushedCounts';

const LEGACY_KEYS = [
  LEGACY_KEY_LAST_PULLED,
  LEGACY_KEY_BOOT_CHOICE,
  LEGACY_KEY_DIRTY_COUNT,
  LEGACY_KEY_LAST_SYNC_AT,
  LEGACY_KEY_LAST_SYNC_LABEL,
  LEGACY_KEY_SAMPLES_ONLY,
  LEGACY_KEY_LAST_PUSHED_COUNTS,
];

export type BootSyncChoice = 'auto-pull' | 'ask';

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
    /* private browsing / quota — non-fatal; sync just degrades */
  }
}

function safeRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* same fallback rationale */
  }
}

// ============ in-memory cache + lazy load + flush queue ============

let _cache: SyncMeta = { ...DEFAULT_SYNC_META };
let _cacheReady = false;
let _loadPromise: Promise<void> | null = null;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _flushPromise: Promise<void> | null = null;

/** Boot must call this before any sync-lineage getter/setter fires.
 *  Idempotent. Performs the §7.9 one-time localStorage migration
 *  (introduced v0.11, plan to delete v0.14 — see ERD §7.9).
 *
 *  Order of operations:
 *    1. Try the YDocStore — if present, that wins (already migrated
 *       OR fresh install that already wrote through the new path).
 *    2. Otherwise, scan localStorage for legacy keys; populate cache
 *       and persist via store.saveSyncMeta.
 *    3. Either way, delete legacy localStorage keys so subsequent
 *       boots skip step 2. */
export function loadSyncMetaCache(): Promise<void> {
  if (_cacheReady) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const store = await getYDocStore();
    const stored = await store.loadSyncMeta();
    if (stored !== null) {
      _cache = stored;
    } else {
      const fromLegacy = readLegacySyncMeta();
      if (fromLegacy !== null) {
        _cache = fromLegacy;
        // Persist before deleting legacy so a crash in between doesn't
        // lose the cursors.
        try {
          await store.saveSyncMeta(_cache);
        } catch {
          // Store write failed — skip the legacy delete so a future
          // boot can still find the data and retry the migration.
          _cacheReady = true;
          return;
        }
      }
    }
    deleteLegacySyncMeta();
    _cacheReady = true;
  })();
  return _loadPromise;
}

function readLegacySyncMeta(): SyncMeta | null {
  if (typeof window === 'undefined') return null;
  const lastPulled = safeGet(LEGACY_KEY_LAST_PULLED);
  const lastSyncAt = safeGet(LEGACY_KEY_LAST_SYNC_AT);
  const lastSyncLabel = safeGet(LEGACY_KEY_LAST_SYNC_LABEL);
  const samplesOnly = safeGet(LEGACY_KEY_SAMPLES_ONLY);
  const dirtyCount = safeGet(LEGACY_KEY_DIRTY_COUNT);
  const lastPushedCounts = safeGet(LEGACY_KEY_LAST_PUSHED_COUNTS);
  const bootChoice = safeGet(LEGACY_KEY_BOOT_CHOICE);

  // No legacy presence → fresh install / nothing to migrate.
  const noLegacy =
    lastPulled === null &&
    lastSyncAt === null &&
    lastSyncLabel === null &&
    samplesOnly === null &&
    dirtyCount === null &&
    lastPushedCounts === null &&
    bootChoice === null;
  if (noLegacy) return null;

  const parsedSyncAt = lastSyncAt ? Number.parseInt(lastSyncAt, 10) : NaN;
  const parsedDirty = dirtyCount ? Number.parseInt(dirtyCount, 10) : 0;
  let parsedCounts: LastPushedCounts | null = null;
  if (lastPushedCounts) {
    try {
      const parsed = JSON.parse(lastPushedCounts) as Partial<LastPushedCounts>;
      if (
        typeof parsed.templates === 'number' &&
        typeof parsed.tasks === 'number' &&
        typeof parsed.lines === 'number' &&
        typeof parsed.reflections === 'number' &&
        typeof parsed.at === 'string'
      ) {
        parsedCounts = parsed as LastPushedCounts;
      }
    } catch {
      /* corrupted entry — leave null */
    }
  }
  return {
    lastPulledSnapshotId: lastPulled,
    lastSyncAt: Number.isFinite(parsedSyncAt) ? parsedSyncAt : null,
    lastSyncLabel: lastSyncLabel,
    samplesOnly: samplesOnly === '1',
    dirtyCount: Number.isFinite(parsedDirty) && parsedDirty > 0 ? parsedDirty : 0,
    lastPushedCounts: parsedCounts,
    bootSyncChoice: bootChoice === 'ask' ? 'ask' : 'auto-pull',
    // v0.11.x migration path predates identityPin — initialize as
    // null. The next successful connect/reconnect will populate it
    // via the §7.10.2 verify path.
    identityPin: null,
    // v0.12 P2 additions — start empty; recording begins on next push/pull.
    recentAttempts: [],
    lastSuccessAt: { push: null, pull: null },
    dismissPendingPileUntil: null,
    // v0.12 P4 · last user edit time · null until first activity.
    lastActivityAt: null,
    // v0.12 P5 · mode-upgrade toast cooldown.
    lastModeUpgradeToastAt: null,
    // v0.12 P6 · clean-departure marker.
    pendingDeparture: null,
  };
}

function deleteLegacySyncMeta(): void {
  for (const key of LEGACY_KEYS) safeRemove(key);
}

/** Coalesce burst writes into one async flush. Setters call this
 *  synchronously; the actual store write fires after a microtask
 *  drain so back-to-back setters in the same tick produce one
 *  store.saveSyncMeta call. */
function scheduleFlush(): void {
  if (_flushTimer !== null) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    _flushPromise = doFlush();
  }, 0);
}

async function doFlush(): Promise<void> {
  try {
    const store = await getYDocStore();
    await store.saveSyncMeta(_cache);
  } catch {
    /* persistence failed — cache stays valid, next setter retries */
  }
}

/** Force an immediate flush. Called by sync controller before push
 *  triggers (Tauri blur, pagehide, etc.) so in-flight setter writes
 *  hit disk before the push starts. Safe to call before
 *  loadSyncMetaCache resolves — degenerates to a no-op. */
export async function flushSyncMeta(): Promise<void> {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
    _flushPromise = doFlush();
  }
  if (_flushPromise) {
    try {
      await _flushPromise;
    } catch {
      /* ignored — same fallback as doFlush */
    }
  }
}

// ============ device identity (localStorage; unchanged behavior) ============

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

// ============ sync-lineage cursors (cache-backed) ============

export function getLastPulledSnapshotId(): string | null {
  return _cache.lastPulledSnapshotId;
}

export function setLastPulledSnapshotId(id: string): void {
  _cache.lastPulledSnapshotId = id;
  scheduleFlush();
}

export function clearLastPulledSnapshotId(): void {
  _cache.lastPulledSnapshotId = null;
  scheduleFlush();
}

export function getBootSyncChoice(): BootSyncChoice {
  return _cache.bootSyncChoice;
}

export function setBootSyncChoice(next: BootSyncChoice): void {
  _cache.bootSyncChoice = next;
  scheduleFlush();
}

export function getDirtyCount(): number {
  return _cache.dirtyCount;
}

export function setDirtyCount(n: number): void {
  _cache.dirtyCount = n > 0 ? n : 0;
  scheduleFlush();
}

export function bumpDirtyCount(): number {
  _cache.dirtyCount = _cache.dirtyCount + 1;
  scheduleFlush();
  return _cache.dirtyCount;
}

export function clearDirtyCount(): void {
  _cache.dirtyCount = 0;
  scheduleFlush();
}

export interface LastSyncInfo {
  at: number;
  label: string;
}

export function getLastSyncInfo(): LastSyncInfo | null {
  if (_cache.lastSyncAt === null) return null;
  return { at: _cache.lastSyncAt, label: _cache.lastSyncLabel ?? 'this device' };
}

export function setLastSyncInfo(info: LastSyncInfo): void {
  _cache.lastSyncAt = info.at;
  _cache.lastSyncLabel = info.label;
  scheduleFlush();
}

export function getLastPushedCounts(): LastPushedCounts | null {
  return _cache.lastPushedCounts;
}

export function setLastPushedCounts(counts: Omit<LastPushedCounts, 'at'>): void {
  _cache.lastPushedCounts = { ...counts, at: new Date().toISOString() };
  scheduleFlush();
}

export function setLocalIsSamplesOnly(): void {
  _cache.samplesOnly = true;
  scheduleFlush();
}

export function clearLocalIsSamplesOnly(): void {
  _cache.samplesOnly = false;
  scheduleFlush();
}

export function isLocalSamplesOnly(): boolean {
  return _cache.samplesOnly;
}

// ============ identity pin (ERD §7.10.2 · v0.12 P1) ============
//
// Stored inside SyncMeta — co-resident with the Y.Doc bytes so it
// shares lifecycle with the data it identifies. Wiped together when
// resetLocalData() runs (which is correct: a wiped store is logically
// a "first connect" again).

export function getIdentityPin(): IdentityPin | null {
  return _cache.identityPin;
}

/** Write a fresh pin. Called from the connect / reconnect path when
 *  verifyAccountIdentity returns 'first-connect', and from the
 *  IdentityMismatchModal's "switch to this account" branch (which
 *  also resets other sync cursors — caller handles that). */
export function setIdentityPin(pin: IdentityPin): void {
  _cache.identityPin = pin;
  scheduleFlush();
}

export function clearIdentityPin(): void {
  _cache.identityPin = null;
  scheduleFlush();
}

/** Update the `lastKnownMode` field on the existing pin. Idempotent —
 *  no-op when value is unchanged so we don't churn the store on
 *  every push. Used by §7.10.1 mode inference; read by §7.10.6
 *  regression guard (which lands in P3). */
export function setLastKnownMode(mode: 'backup' | 'sync'): void {
  const pin = _cache.identityPin;
  if (pin === null) return;
  if (pin.lastKnownMode === mode) return;
  _cache.identityPin = { ...pin, lastKnownMode: mode };
  scheduleFlush();
}

// ============ failure history (ERD §7.10.5 · v0.12 P2) ============

export function getRecentAttempts(): SyncAttempt[] {
  return _cache.recentAttempts;
}

/** Append a sync attempt record · ring buffer cap. Newest at end ·
 *  oldest dropped first. */
export function appendSyncAttempt(attempt: SyncAttempt): void {
  const next = _cache.recentAttempts.concat(attempt);
  _cache.recentAttempts =
    next.length > RECENT_ATTEMPTS_MAX
      ? next.slice(next.length - RECENT_ATTEMPTS_MAX)
      : next;
  scheduleFlush();
}

export function getLastSuccessAt(
  direction: 'push' | 'pull',
): string | null {
  return _cache.lastSuccessAt[direction];
}

export function setLastSuccessAt(
  direction: 'push' | 'pull',
  iso: string,
): void {
  _cache.lastSuccessAt = { ..._cache.lastSuccessAt, [direction]: iso };
  scheduleFlush();
}

export function getDismissPendingPileUntil(): string | null {
  return _cache.dismissPendingPileUntil;
}

export function setDismissPendingPileUntil(iso: string | null): void {
  _cache.dismissPendingPileUntil = iso;
  scheduleFlush();
}

// ============ user-activity timestamp (ERD §7.10.4 · v0.12 P4) ============

export function getLastActivityAt(): string | null {
  return _cache.lastActivityAt;
}

/** Bump on every user-initiated Y.Doc transaction (the doc observer
 *  in syncController already filters REMOTE_ORIGIN / OPFS_ORIGIN out
 *  · the same site that calls bumpDirtyCount). Heartbeats read this
 *  on push success to populate `lastActivityAt`. */
export function markLastActivityNow(): void {
  _cache.lastActivityAt = new Date().toISOString();
  scheduleFlush();
}

// ============ mode-upgrade toast cooldown (ERD §7.10.1 · v0.12 P5) ============

export function getLastModeUpgradeToastAt(): string | null {
  return _cache.lastModeUpgradeToastAt;
}

export function setLastModeUpgradeToastAt(iso: string | null): void {
  _cache.lastModeUpgradeToastAt = iso;
  scheduleFlush();
}

// ============ departure marker (ERD §7.10.3 · v0.12 P6) ============

export type PendingDeparture = { count: number; at: string };

export function getPendingDeparture(): PendingDeparture | null {
  return _cache.pendingDeparture;
}

/** Write the marker when the user opts to "leave anyway" through the
 *  DepartureGateModal failure branch. Carries the pending count so
 *  the next launch's ReconcileBanner can echo it back ("上次离开时
 *  有 N 个改动没传上去"). */
export function setPendingDeparture(p: PendingDeparture | null): void {
  _cache.pendingDeparture = p;
  scheduleFlush();
}

// ============ session-scoped sync probe suppression (sessionStorage) ============

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
 *  All sync-touching code paths skip when this is true. */
export function isSyncProbeSuppressed(): boolean {
  return safeGetSession(KEY_PROBE_SUPPRESSED) === '1';
}

export function setSyncProbeSuppressed(): void {
  safeSetSession(KEY_PROBE_SUPPRESSED, '1');
}

// ============ session-scoped "this session has had a successful round-trip" ============
//
// Drives the SideNav "已同步" semantic (ERD §7.9 decision 5). After
// cold boot the indicator reads "未确认" until a push or pull
// completes within the current session. Surviving across reloads is
// explicitly NOT desired — stale lastSync alone shouldn't claim
// in-sync after a wipe.

let _sessionRoundTripDone = false;
const _roundTripListeners = new Set<() => void>();

export function hasSessionRoundTrip(): boolean {
  return _sessionRoundTripDone;
}

export function markSessionRoundTrip(): void {
  if (_sessionRoundTripDone) return;
  _sessionRoundTripDone = true;
  for (const fn of _roundTripListeners) {
    try {
      fn();
    } catch {
      /* listener errors don't break the chain */
    }
  }
}

export function subscribeSessionRoundTrip(fn: () => void): () => void {
  _roundTripListeners.add(fn);
  return () => {
    _roundTripListeners.delete(fn);
  };
}
