// Backup export. Pulls the in-memory Zustand snapshot (authoritative
// for the UI) into a JSON blob and triggers a download. Not an
// event-log dump — the point is "I can eyeball my data" AND the
// matching `importLocalData` can re-hydrate from this bundle
// (snapshot-based restore, not event replay).

import { useStore } from '@dayrail/core';

export interface ExportBundle {
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
   *  will backfill revisions on first boot post-import). */
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

export function exportLocalData(): string {
  const s = useStore.getState();
  const bundle: ExportBundle = {
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
