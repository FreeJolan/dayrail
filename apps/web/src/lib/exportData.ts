// Backup export (v0.7).
//
// Two paths:
//   1. Manual JSON download (Settings → 高级 → 下载 JSON) — produces a
//      human-readable JSON snapshot of current state. NOT used by the
//      sync layer in v0.7. Round-trip via "Import from snapshot" is
//      not supported for JSON; the migration script
//      (tools/migrate/migrate-json-to-yjs.ts) converts JSON → .dryj
//      offline if the user wants to restore from a JSON backup.
//   2. .dryj snapshot (Settings → 同步 → "Download snapshot") —
//      binary container produced from the live Y.Doc. Round-trips
//      cleanly via "Import from snapshot".
//
// The sync layer reads/writes its OWN .dryj wire format directly via
// `exportYDocAsUpdate` from @dayrail/core/store + encodeDryj from
// @dayrail/db/dryj — it does not use anything in this file.

import {
  exportYDocAsUpdate,
  useStore,
} from '@dayrail/core';
import { encodeDryj, type DryjMeta } from '@dayrail/db/dryj';

export interface ExportBundle {
  app: 'dayrail';
  version: string;
  gitSha: string;
  exportedAt: string; // ISO
  /** v0.7 export shape — the same `state` map shape v0.6 used. JSON
   *  bundles are inspection-only in v0.7; "Import from snapshot"
   *  expects the .dryj container, not this JSON. */
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

export function buildExportBundle(): ExportBundle {
  const s = useStore.getState();
  return {
    app: 'dayrail',
    version: __APP_VERSION__,
    gitSha: __APP_GIT_SHA__,
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
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
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/** Build a fresh `.dryj` container from the live Y.Doc and trigger a
 *  download. Filename includes a timestamp so consecutive downloads
 *  don't collide. Round-trips through "Import from snapshot". */
export function exportDryjSnapshot(deviceId: string, deviceLabel: string): string {
  const update = exportYDocAsUpdate();
  const meta: DryjMeta = {
    snapshotId: cryptoUUID(),
    deviceId,
    deviceLabel,
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
  };
  const bytes = encodeDryj(meta, update);
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const filename = `dayrail-snapshot-${stamp}.dryj`;
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
