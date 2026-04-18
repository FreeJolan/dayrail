// Backup export. Pulls the in-memory Zustand snapshot (authoritative
// for the UI) into a JSON blob and triggers a download. Not an
// event-log dump — the point is "I can eyeball my data" more than
// "I can do a byte-exact round-trip restore". Import / re-hydrate is
// a separate v0.4 concern.

import { useStore } from '@dayrail/core';

interface ExportBundle {
  app: 'dayrail';
  version: string;
  gitSha: string;
  exportedAt: string; // ISO
  state: {
    templates: unknown;
    rails: unknown;
    lines: unknown;
    tasks: unknown;
    railInstances: unknown;
    signals: unknown;
    shifts: unknown;
    adhocEvents: unknown;
    calendarRules: unknown;
    cycles: unknown;
    habitPhases: unknown;
  };
}

export function exportLocalData(): void {
  const s = useStore.getState();
  const bundle: ExportBundle = {
    app: 'dayrail',
    version: __APP_VERSION__,
    gitSha: __APP_GIT_SHA__,
    exportedAt: new Date().toISOString(),
    state: {
      templates: s.templates,
      rails: s.rails,
      lines: s.lines,
      tasks: s.tasks,
      railInstances: s.railInstances,
      signals: s.signals,
      shifts: s.shifts,
      adhocEvents: s.adhocEvents,
      calendarRules: s.calendarRules,
      cycles: s.cycles,
      habitPhases: s.habitPhases,
    },
  };
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dayrail-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL on the next tick — some Safari variants
  // abort the download if we revoke synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
