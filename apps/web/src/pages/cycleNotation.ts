// Cycle notation (ERD §9.7 "C1 scheme"). Pure derivation — no stored
// Cycle records. Every Cycle is a 7-day Monday-anchored window; the
// `C{n}` label is the ordinal of this Monday within its own month
// (startDate's month wins for cross-month weeks).

import { startOfWeekMonday, toIsoDate } from './cycleFromStore';

const DAY_MS = 24 * 60 * 60 * 1000;

/** First Monday on or after the 1st of `year`/`month` (1-12). */
function firstMondayOfMonth(year: number, month: number): Date {
  const first = new Date(year, month - 1, 1);
  const dow = first.getDay(); // 0 Sun .. 6 Sat
  const delta = dow === 0 ? 1 : (8 - dow) % 7; // days until next Monday (0 if already Mon)
  const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + delta);
  return d;
}

/** Derive the `C{n}` ordinal for a Monday within its startDate's month.
 *  The first Monday on or after the 1st of that month is C1. */
export function cycleNumberOfMonday(monday: Date): number {
  const firstMon = firstMondayOfMonth(monday.getFullYear(), monday.getMonth() + 1);
  const diff = Math.floor((monday.getTime() - firstMon.getTime()) / DAY_MS);
  return Math.floor(diff / 7) + 1;
}

/** Short label for a date's cycle: "4月 C2" in zh / "Apr C2" in en. */
export function cycleLabel(monday: Date, locale = 'zh-CN'): string {
  const month = monday.toLocaleDateString(locale, { month: locale === 'zh-CN' ? 'long' : 'short' });
  return `${month} C${cycleNumberOfMonday(monday)}`;
}

/** Short range label: `Apr 13 – Apr 19`. */
export function cycleRangeLabel(monday: Date, locale = 'en-US'): string {
  const end = new Date(monday.getTime() + 6 * DAY_MS);
  const fmt = (d: Date) =>
    d.toLocaleDateString(locale, { month: 'short', day: '2-digit' });
  return `${fmt(monday)} – ${fmt(end)}`;
}

/** Month-grouped list of Cycles centered on `anchor`.
 *  Range: `past` weeks before + the anchor's Cycle + `future` weeks after.
 *  Output preserves calendar order and groups by (year, month) of each
 *  Cycle's startDate (matching §9.7 "month wins for cross-month" rule). */
export interface CycleEntry {
  monday: Date;
  startIso: string; // YYYY-MM-DD
  endIso: string;
  cycleLabel: string; // "4月 C2"
  rangeLabel: string; // "Apr 13 – Apr 19"
  isCurrent: boolean;
}

export interface CycleMonthGroup {
  year: number;
  month: number; // 1-12
  label: string; // "2026年4月" / "Apr 2026"
  entries: CycleEntry[];
}

export function enumerateCycles(
  anchor: Date,
  { past = 8, future = 8 }: { past?: number; future?: number } = {},
): CycleMonthGroup[] {
  const anchorMonday = startOfWeekMonday(anchor);
  const todayMonday = startOfWeekMonday(new Date());
  const todayMondayIso = toIsoDate(todayMonday);

  const entries: CycleEntry[] = [];
  for (let i = -past; i <= future; i++) {
    const m = new Date(anchorMonday.getTime() + i * 7 * DAY_MS);
    const startIso = toIsoDate(m);
    const endIso = toIsoDate(new Date(m.getTime() + 6 * DAY_MS));
    entries.push({
      monday: m,
      startIso,
      endIso,
      cycleLabel: cycleLabel(m),
      rangeLabel: cycleRangeLabel(m),
      isCurrent: startIso === todayMondayIso,
    });
  }

  // Group by (year, month) of the Monday (startDate's month per §9.7).
  const groups: CycleMonthGroup[] = [];
  for (const e of entries) {
    const year = e.monday.getFullYear();
    const month = e.monday.getMonth() + 1;
    const last = groups[groups.length - 1];
    if (last && last.year === year && last.month === month) {
      last.entries.push(e);
    } else {
      groups.push({
        year,
        month,
        label: e.monday.toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: 'long',
        }),
        entries: [e],
      });
    }
  }
  return groups;
}
