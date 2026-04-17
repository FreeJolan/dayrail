// Static sample for the Calendar month view (ERD §5.4 Calendar + F4).
// April 2026 is the focal month (today = Apr 17). Includes:
//   - default weekday rule (Mon-Fri → workday, Sat-Sun → restday)
//   - one single-day override (Fri Apr 17 → restday)
//   - one cycle-range override (Apr 20 → 24: `deep` template, meant
//     as a "deep-focus week" custom template)
//   - two Ad-hoc events sprinkled across the month

import type { TemplateKey } from './sampleTemplate';
import type { RailColor } from './sample';

export interface AdhocEvent {
  id: string;
  date: string; // ISO
  start: string; // HH:MM
  end: string;
  name: string;
  color: RailColor;
}

// --- Calendar rules ---

export type CalendarRule =
  | { kind: 'weekday'; weekday: number; templateKey: TemplateKey } // 0 = Sunday
  | { kind: 'single-date'; date: string; templateKey: TemplateKey }
  | {
      kind: 'date-range';
      start: string;
      end: string;
      templateKey: TemplateKey;
      label: string;
    }
  | {
      kind: 'cycle';
      cycleLength: number;
      anchor: string;
      mapping: TemplateKey[];
      label: string;
    };

export const SAMPLE_RULES: CalendarRule[] = [
  // MVP defaults (shipped; editable in drawer)
  { kind: 'weekday', weekday: 1, templateKey: 'workday' },
  { kind: 'weekday', weekday: 2, templateKey: 'workday' },
  { kind: 'weekday', weekday: 3, templateKey: 'workday' },
  { kind: 'weekday', weekday: 4, templateKey: 'workday' },
  { kind: 'weekday', weekday: 5, templateKey: 'workday' },
  { kind: 'weekday', weekday: 0, templateKey: 'restday' },
  { kind: 'weekday', weekday: 6, templateKey: 'restday' },
  // Single-day override: Fri Apr 17 pulled to restday
  { kind: 'single-date', date: '2026-04-17', templateKey: 'restday' },
  // Range override: a deep-focus week
  {
    kind: 'date-range',
    start: '2026-04-20',
    end: '2026-04-24',
    templateKey: 'deep',
    label: 'Deep-focus sprint',
  },
];

// --- Ad-hoc events ---

export const SAMPLE_ADHOC: AdhocEvent[] = [
  {
    id: 'adhoc-1',
    date: '2026-04-08',
    start: '14:00',
    end: '16:00',
    name: '牙医复诊',
    color: 'amber',
  },
  {
    id: 'adhoc-2',
    date: '2026-04-23',
    start: '19:00',
    end: '21:30',
    name: '朋友聚餐',
    color: 'pink',
  },
  {
    id: 'adhoc-3',
    date: '2026-04-29',
    start: '10:00',
    end: '11:30',
    name: '例会 · 工程周会',
    color: 'teal',
  },
];

// --- Helpers ---

/** Resolve the effective Template for a date, applying ERD §5.4
 *  precedence: single-date > date-range > cycle > weekday > default. */
export function resolveTemplate(
  date: string,
  rules: CalendarRule[] = SAMPLE_RULES,
): { templateKey: TemplateKey; fromRule: CalendarRule['kind'] | 'default' } {
  const single = rules.find(
    (r): r is Extract<CalendarRule, { kind: 'single-date' }> =>
      r.kind === 'single-date' && r.date === date,
  );
  if (single) return { templateKey: single.templateKey, fromRule: 'single-date' };

  const range = rules.find(
    (r): r is Extract<CalendarRule, { kind: 'date-range' }> =>
      r.kind === 'date-range' && date >= r.start && date <= r.end,
  );
  if (range) return { templateKey: range.templateKey, fromRule: 'date-range' };

  // Cycle rules (not sampled but logic stub)
  const cycle = rules.find(
    (r): r is Extract<CalendarRule, { kind: 'cycle' }> => r.kind === 'cycle',
  );
  if (cycle) {
    const diff = Math.floor(
      (new Date(date).getTime() - new Date(cycle.anchor).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    if (diff >= 0) {
      const idx = diff % cycle.cycleLength;
      return { templateKey: cycle.mapping[idx] ?? 'workday', fromRule: 'cycle' };
    }
  }

  const weekday = new Date(date + 'T00:00:00').getDay();
  const wd = rules.find(
    (r): r is Extract<CalendarRule, { kind: 'weekday' }> =>
      r.kind === 'weekday' && r.weekday === weekday,
  );
  if (wd) return { templateKey: wd.templateKey, fromRule: 'weekday' };

  return { templateKey: 'workday', fromRule: 'default' };
}

export function isOverridden(date: string, rules: CalendarRule[] = SAMPLE_RULES): boolean {
  const { fromRule } = resolveTemplate(date, rules);
  return fromRule === 'single-date' || fromRule === 'date-range';
}

/** Build the cell grid for a month: includes leading cells from prev
 *  month + trailing cells from next month to fill full weeks. Starts
 *  on Monday (ISO locale common case); can be adjusted via locale. */
export function buildMonthGrid(
  year: number,
  month: number /* 1-12 */,
): Array<{ date: string; inMonth: boolean; weekday: number; dayNum: number }> {
  const firstOfMonth = new Date(year, month - 1, 1);
  const firstWeekday = firstOfMonth.getDay(); // 0 = Sun

  // Start grid on Monday — compute how many days to back up
  const daysToMonday = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const gridStart = new Date(year, month - 1, 1 - daysToMonday);

  const cells: ReturnType<typeof buildMonthGrid> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + i,
    );
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    cells.push({
      date: `${yy}-${mm}-${dd}`,
      inMonth: d.getMonth() === month - 1,
      weekday: d.getDay(),
      dayNum: d.getDate(),
    });
    if (i >= 34 && d.getMonth() !== month - 1) break;
  }
  // Ensure we include exactly 5 or 6 week rows
  return cells;
}

export function monthLabel(year: number, month: number, locale = 'en-US'): string {
  return new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
}

export function adhocOn(
  date: string,
  events: AdhocEvent[] = SAMPLE_ADHOC,
): AdhocEvent[] {
  return events.filter((e) => e.date === date);
}
