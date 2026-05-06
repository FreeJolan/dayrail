// ERD §14 · External event sources.
//
// Three source classes feed into one ExternalEvent stream the render
// layer subscribes to:
//   - holidays (§14.2): read from a region-keyed bundled dataset
//                       picked up via setHolidayDatasets() at app boot
//   - user-defined day notes (§14.3): the userDayNotes Y.Map
//   - ICS subscriptions (§14.4): parked for v0.9+
//
// None of these enter the task pipeline (no materialization / purge /
// revision). They are pure labels on calendar days; the only place
// they intersect downstream logic is the AI reflection prompt's
// `metadata` block (§6.6.2), which reads via the same selectors.

import type {
  ExternalEvent,
  HolidayDataset,
  HolidayDatasetEvent,
  UserDayNote,
  UserProfile,
} from './types';

// ============ Holiday dataset registry ============
//
// The `apps/web` layer registers parsed holiday JSONs at boot via
// `setHolidayDatasets`. The core selectors then look them up by
// `regionCode`. We keep this as a module-level Map (not in zustand)
// because:
//   - the data is read-only and per-build (it's bundled in the app
//     bundle), so it doesn't belong in the sync stream.
//   - selectors need synchronous access during render; threading it
//     through props or context would noise up every component that
//     touches a date cell.

let holidayDatasetRegistry: Map<string, HolidayDataset> = new Map();

/** Called once at boot from `apps/web` after the JSON imports settle. */
export function setHolidayDatasets(datasets: HolidayDataset[]): void {
  const next = new Map<string, HolidayDataset>();
  for (const ds of datasets) {
    next.set(ds.regionCode, ds);
  }
  holidayDatasetRegistry = next;
}

/** All loaded region codes — used by the Settings region picker so it
 *  doesn't hard-code the bundle list. */
export function listHolidayRegions(): string[] {
  return Array.from(holidayDatasetRegistry.keys()).sort();
}

/** UI may want the human-readable region name from outside core. */
export function getHolidayDatasetDisplayName(
  regionCode: string,
  uiLocale: string,
): string | null {
  const ds = holidayDatasetRegistry.get(regionCode);
  if (!ds) return null;
  return ds.displayName[uiLocale] ?? ds.displayName.en ?? regionCode;
}

// ============ ExternalEvent shaping helpers ============

/** ERD §14.3. Map a UserDayNote into the unified `ExternalEvent`
 *  shape rendered by every surface (Cycle View / Calendar / Today
 *  Track / Review). */
export function userNoteToExternal(note: UserDayNote): ExternalEvent {
  const meta: Record<string, unknown> = { createdAt: note.createdAt };
  if (note.color !== undefined) meta.color = note.color;
  return {
    sourceId: `user:note:${note.id}`,
    date: note.date,
    label: note.label,
    kind: 'user-note',
    meta,
  };
}

function holidayEventToExternal(
  ev: HolidayDatasetEvent,
  regionCode: string,
  uiLocale: string,
): ExternalEvent {
  const firstKey = Object.keys(ev.label)[0];
  const fallback = firstKey ? ev.label[firstKey] ?? '' : '';
  return {
    sourceId: `holidays:${regionCode}`,
    date: ev.date,
    label: ev.label[uiLocale] ?? ev.label.en ?? fallback,
    kind: ev.kind,
    regionCode,
  };
}

// ============ Date selectors ============

/** ERD §14.1. The single render-layer entry point. Aggregates all
 *  external sources for `date` and returns them in source-priority
 *  order: holidays → user-notes → (future) ICS. Within a source,
 *  ordering is the source's natural order — holidays by region code
 *  ascending; user-notes by `createdAt` ascending. */
export function selectExternalEventsOn(
  date: string,
  opts: {
    enabledHolidayRegions: string[];
    userDayNotes: Record<string, UserDayNote>;
    uiLocale?: string;
  },
): ExternalEvent[] {
  const out: ExternalEvent[] = [];
  const uiLocale = opts.uiLocale ?? 'zh-CN';

  // 1. Holidays — for each enabled region, every event matching `date`.
  const sortedRegions = [...opts.enabledHolidayRegions].sort();
  for (const regionCode of sortedRegions) {
    const ds = holidayDatasetRegistry.get(regionCode);
    if (!ds) continue;
    for (const ev of ds.events) {
      if (ev.date === date) {
        out.push(holidayEventToExternal(ev, regionCode, uiLocale));
      }
    }
  }

  // 2. User-defined day notes — every note matching `date`, oldest first.
  const matchingNotes: UserDayNote[] = [];
  for (const note of Object.values(opts.userDayNotes)) {
    if (note.date === date) matchingNotes.push(note);
  }
  matchingNotes.sort((a, b) => a.createdAt - b.createdAt);
  for (const note of matchingNotes) out.push(userNoteToExternal(note));

  // 3. ICS subscriptions — v0.9+ (§14.4 parked).

  return out;
}

/** Convenience: just the user notes on a date, sorted createdAt asc.
 *  Used by the Calendar popover's "notes" section where the editor
 *  needs the underlying entities (id / color), not just labels. */
export function selectUserDayNotesOn(
  date: string,
  userDayNotes: Record<string, UserDayNote>,
): UserDayNote[] {
  const out: UserDayNote[] = [];
  for (const note of Object.values(userDayNotes)) {
    if (note.date === date) out.push(note);
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

/** Resolve `userProfile.enabledHolidayRegions` with a sane default of
 *  `[]` so callers don't have to null-check the singleton on first
 *  hydrate. */
export function resolveEnabledHolidayRegions(
  userProfile: UserProfile | null,
): string[] {
  return userProfile?.enabledHolidayRegions ?? [];
}
