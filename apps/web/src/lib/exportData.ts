// Backup export. Pulls the in-memory Zustand snapshot (authoritative
// for the UI) into a JSON blob. Used for two paths:
//   1. Manual download (Settings → 高级 → 下载 JSON) — produces a file
//      via `<a download>`.
//   2. Sync push (lib/sync/syncController) — the same bundle shape is
//      what we upload to Drive `appdata`. The sync layer adds optional
//      lineage metadata (snapshotId / parentSnapshotId / deviceId /
//      deviceLabel) before upload. Manual download omits those fields;
//      they are still optional on read so old bundles round-trip.
//
// Not an event-log dump — the point is "I can eyeball my data" AND the
// matching `importLocalData` can re-hydrate from this bundle (snapshot-
// based restore, not event replay).

import { useStore } from '@dayrail/core';

/** Optional lineage fields stamped by the sync layer. Manual-download
 *  bundles omit them; remote-sourced bundles always carry them. All
 *  optional on read so v0.4 / v0.5 bundles still validate. */
export interface SyncMeta {
  /** UUID identifying THIS bundle. Generated at upload time (sync) or
   *  not present at all (manual download). */
  snapshotId?: string;
  /** UUID of the bundle this one was authored on top of — i.e. the
   *  remote `snapshotId` the device had pulled at the moment writes
   *  began. Diverged-branch detection compares this to remote
   *  `snapshotId`. */
  parentSnapshotId?: string;
  /** Stable per-(browser, OPFS instance) UUID. Generated on first sync
   *  enable; never rotates. */
  deviceId?: string;
  /** Human-readable device tag (UA-derived default, user-renamable in
   *  Settings → 同步). Stamped on upload so other devices' boot gate
   *  can name "the device whose change you're seeing". */
  deviceLabel?: string;
}

export interface ExportBundle extends SyncMeta {
  app: 'dayrail';
  version: string;
  gitSha: string;
  exportedAt: string; // ISO
  /** Schema version of the state payload itself. Bump when the shape
   *  of any map changes so old bundles can be rejected / migrated.
   *  v1 → v1 with v0.5 additive fields: the §10.5 revision tables and
   *  identity-shell tombstones are present when produced by v0.5+;
   *  absent in older bundles. Importer treats them as optional so v0.4
   *  bundles still round-trip cleanly (the v0.5 sentinel migration
   *  will backfill revisions on first boot post-import).
   *
   *  v0.6 sync (§7.6) does NOT bump this version — the sync metadata
   *  fields (snapshotId / parentSnapshotId / deviceId / deviceLabel)
   *  live at the bundle root, not under `state`, and are all `?` on
   *  read. */
  schemaVersion: 1;
  state: {
    templates: unknown;
    rails: unknown;
    lines: unknown;
    tasks: unknown;
    signals: unknown;
    shifts: unknown;
    adhocEvents: unknown;
    calendarRules: unknown;
    cycles: unknown;
    habitPhases: unknown;
    habitBindings: unknown;
    // §10.5 revision tables (v0.5+; optional on read for back-compat).
    railRevisions?: unknown;
    templateRevisions?: unknown;
    calendarRuleRevisions?: unknown;
    habitBindingRevisions?: unknown;
    railTombstones?: unknown;
    templateTombstones?: unknown;
    calendarRuleTombstones?: unknown;
    habitBindingTombstones?: unknown;
    v05MigrationApplied?: unknown;
  };
}

/** Build a bundle in memory without touching the DOM. The sync layer
 *  uses this directly; manual download wraps it in `exportLocalData`
 *  below. */
export function buildExportBundle(meta?: SyncMeta): ExportBundle {
  const s = useStore.getState();
  return {
    app: 'dayrail',
    version: __APP_VERSION__,
    gitSha: __APP_GIT_SHA__,
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    ...(meta?.snapshotId && { snapshotId: meta.snapshotId }),
    ...(meta?.parentSnapshotId && { parentSnapshotId: meta.parentSnapshotId }),
    ...(meta?.deviceId && { deviceId: meta.deviceId }),
    ...(meta?.deviceLabel && { deviceLabel: meta.deviceLabel }),
    state: {
      templates: s.templates,
      rails: s.rails,
      lines: s.lines,
      tasks: s.tasks,
      signals: s.signals,
      shifts: s.shifts,
      adhocEvents: s.adhocEvents,
      calendarRules: s.calendarRules,
      cycles: s.cycles,
      habitPhases: s.habitPhases,
      habitBindings: s.habitBindings,
      // §10.5 — preserve every future-dated revision + tombstone so
      // an export/import round-trip doesn't silently lose them. The
      // sentinel migration would re-build the today-and-back baseline
      // from the legacy mirrors, but it can't recover any forward
      // cutovers the user already authored.
      railRevisions: s.railRevisions,
      templateRevisions: s.templateRevisions,
      calendarRuleRevisions: s.calendarRuleRevisions,
      habitBindingRevisions: s.habitBindingRevisions,
      railTombstones: s.railTombstones,
      templateTombstones: s.templateTombstones,
      calendarRuleTombstones: s.calendarRuleTombstones,
      habitBindingTombstones: s.habitBindingTombstones,
      v05MigrationApplied: s.v05MigrationApplied,
    },
  };
}

export function exportLocalData(): string {
  const bundle = buildExportBundle();
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const filename = `dayrail-backup-${stamp}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL on the next tick — some Safari variants
  // abort the download if we revoke synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/** Trigger a download for an arbitrary bundle (used by the sync
 *  conflict dialog to give the user a one-click reversal copy of the
 *  losing side before it is overwritten). Mirrors `exportLocalData`'s
 *  download mechanics; caller chooses the filename. */
export function downloadBundleAs(bundle: ExportBundle, filename: string): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
