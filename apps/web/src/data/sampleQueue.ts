// Static sample for the Pending-decisions queue (ERD §5.7 F3).
// Unmarked RailInstances that have ended > 24 h ago. Today in the mock
// is 2026-04-17 — items here are 1-40 days old. The "Let these pass"
// batch action only touches items > 7 days old; the sample includes
// both sides of that boundary so the UI can be proofed in one pass.

import type { RailColor } from './sample';

export interface QueueItem {
  id: string;
  date: string; // ISO; dated day the Rail belonged to
  railName: string;
  railColor: RailColor;
  start: string; // HH:MM
  end: string;
  /** Optional Slot.taskName if the slot had a scheduled Chunk. */
  task?: string;
  /** Which Line it belongs to (for AI Observe downstream; not shown here). */
  lineId?: string;
}

const TODAY_ISO = '2026-04-17';

const item = (
  date: string,
  railName: string,
  railColor: RailColor,
  start: string,
  end: string,
  task?: string,
): QueueItem => ({
  id: `q-${date}-${railName.slice(0, 3)}-${start}`,
  date,
  railName,
  railColor,
  start,
  end,
  task,
});

// Today's rails (Apr 17) still live in the check-in strip, not here.
// Queue starts at yesterday and goes back.
export const SAMPLE_QUEUE: QueueItem[] = [
  // ── Within last 7 days (fresh; user might still want to decide) ──
  // Apr 16 (Thu · 1 day ago)
  item('2026-04-16', '晨跑', 'grass', '06:00', '07:00'),
  item('2026-04-16', '英语 · 口语', 'amber', '19:00', '20:30'),
  // Apr 15 (Wed · 2 days ago)
  item('2026-04-15', '晨跑', 'grass', '06:00', '07:00'),
  item('2026-04-15', '算法', 'pink', '20:30', '21:30', 'LeetCode #198'),
  // Apr 14 (Tue · 3 days ago)
  item('2026-04-14', '开源项目', 'plum', '16:00', '18:00', 'DayRail · Review'),
  // Apr 13 (Mon · 4 days ago)
  item('2026-04-13', '晨跑', 'grass', '06:00', '07:00'),
  item('2026-04-13', '复盘', 'slate', '23:00', '23:30'),
  // Apr 11 (Sat · 6 days ago)
  item('2026-04-11', '阅读', 'sand', '10:00', '12:00', '《代码整洁之道》ch 5'),

  // ── Boundary: exactly 7 days ──
  // Apr 10 (Fri · 7 days ago — NOT yet eligible for "Let these pass")
  item('2026-04-10', '晨跑', 'grass', '06:00', '07:00'),
  item('2026-04-10', '英语 · 口语', 'amber', '19:00', '20:30'),
  item('2026-04-10', '算法', 'pink', '20:30', '21:30'),

  // ── More than 7 days old (ELIGIBLE for "Let these pass") ──
  // Apr 09 (Thu · 8 days ago)
  item('2026-04-09', '晨跑', 'grass', '06:00', '07:00'),
  // Apr 08 (Wed · 9 days ago)
  item('2026-04-08', '开源项目', 'plum', '16:00', '18:00'),
  item('2026-04-08', '英语 · 口语', 'amber', '19:00', '20:30'),
  // Apr 05 (Sun · 12 days ago)
  item('2026-04-05', '晨跑', 'grass', '07:30', '09:00'),
  item('2026-04-05', '阅读', 'sand', '10:00', '12:00'),
  // Apr 03 (Fri · 14 days ago)
  item('2026-04-03', '晨跑', 'grass', '06:00', '07:00'),
  item('2026-04-03', '英语 · 口语', 'amber', '19:00', '20:30'),
  item('2026-04-03', '算法', 'pink', '20:30', '21:30'),
  // Mar 28 (Fri · 20 days ago)
  item('2026-03-28', '晨跑', 'grass', '06:00', '07:00'),
  // Mar 20 (Thu · 28 days ago)
  item('2026-03-20', '英语 · 口语', 'amber', '19:00', '20:30'),
  item('2026-03-20', '开源项目', 'plum', '16:00', '18:00'),
  // Mar 12 (Thu · 36 days ago — oldest)
  item('2026-03-12', '晨跑', 'grass', '06:00', '07:00'),
];

// --- Helpers ---

const daysAgo = (dateISO: string, nowISO = TODAY_ISO): number => {
  const d1 = new Date(dateISO + 'T00:00:00').getTime();
  const d2 = new Date(nowISO + 'T00:00:00').getTime();
  return Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
};

export const isOlderThan7d = (item: QueueItem): boolean => daysAgo(item.date) > 7;

/** Groups queue items by date (descending) and returns presentable groups. */
export function groupByDate(items: QueueItem[]): Array<{
  date: string;
  relative: string;
  weekdayShort: string;
  dayLabel: string;
  items: QueueItem[];
}> {
  const map = new Map<string, QueueItem[]>();
  for (const it of items) {
    if (!map.has(it.date)) map.set(it.date, []);
    map.get(it.date)!.push(it);
  }
  const dates = [...map.keys()].sort((a, b) => b.localeCompare(a));

  return dates.map((date) => {
    const d = new Date(date + 'T00:00:00');
    const weekdayShort = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayLabel = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const age = daysAgo(date);
    const relative =
      age === 1
        ? '昨天'
        : age === 2
          ? '前天'
          : age <= 7
            ? `${age} 天前`
            : age <= 30
              ? `${age} 天前`
              : age <= 60
                ? `约 1 个月前`
                : `约 ${Math.round(age / 30)} 个月前`;
    return {
      date,
      relative,
      weekdayShort,
      dayLabel,
      items: map.get(date)!,
    };
  });
}

export function summary(items: QueueItem[]) {
  const total = items.length;
  const eligible = items.filter(isOlderThan7d).length;
  const oldest = items
    .map((i) => i.date)
    .sort()
    .shift();
  return { total, eligible, oldest };
}
