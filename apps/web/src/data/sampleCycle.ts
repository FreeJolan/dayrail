// Static sample for the Cycle View mockup (ERD §5.3, D-group decisions).
// One 7-day cycle (Mon → Sun) with one override day to exercise the
// per-template stacked-section layout (D1-1B). Slots cover all five
// cell states so the heatmap can be visually proofed in one pass.

import type { RailColor } from './sample';
import type { EditableRail, TemplateKey } from './sampleTemplate';
import { SAMPLE_RAILS_BY_TEMPLATE } from './sampleTemplate';

export interface CycleDay {
  date: string; // ISO "YYYY-MM-DD"
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sun
  templateKey: TemplateKey;
  overridden: boolean; // user changed it from the default weekday rule
}

export type SlotState =
  | 'planned-empty' // future; Rail row exists but no task assigned
  | 'planned-task' // future; a Task is scheduled
  | 'done' // completed in the past
  | 'shifted' // happened but with a postpone / swap / resize
  | 'skipped' // user marked skipped
  | 'na'; // day doesn't apply (unused Rail row for this day)

export interface CycleSlot {
  railId: string;
  date: string;
  state: SlotState;
  taskName?: string;
  /** For shifted/done states that carry a Mono meta (e.g. `→ 20:00`). */
  meta?: string;
}

export interface SampleCycle {
  id: string;
  label: string; // "C1"
  startDate: string;
  endDate: string;
  days: CycleDay[];
  slots: CycleSlot[];
  /** Line-level progress snapshots for the summary strip (D5). */
  topLines: Array<{
    id: string;
    name: string;
    color: RailColor;
    done: number;
    planned: number;
  }>;
}

// --- Cycle C1: 2026-04-13 (Mon) → 2026-04-19 (Sun) ---
// Apr 17 (Fri) overridden from `workday` → `restday` (e.g. personal day).
// Today in the mock is Apr 17 — past days (Mon-Thu) have mixed states;
// future days mostly empty or planned.

const DATES = [
  { date: '2026-04-13', weekday: 1 as const, templateKey: 'workday' as TemplateKey, overridden: false },
  { date: '2026-04-14', weekday: 2 as const, templateKey: 'workday' as TemplateKey, overridden: false },
  { date: '2026-04-15', weekday: 3 as const, templateKey: 'workday' as TemplateKey, overridden: false },
  { date: '2026-04-16', weekday: 4 as const, templateKey: 'workday' as TemplateKey, overridden: false },
  { date: '2026-04-17', weekday: 5 as const, templateKey: 'restday' as TemplateKey, overridden: true },
  { date: '2026-04-18', weekday: 6 as const, templateKey: 'restday' as TemplateKey, overridden: false },
  { date: '2026-04-19', weekday: 0 as const, templateKey: 'restday' as TemplateKey, overridden: false },
];

// -- slot builder helpers --
const slot = (
  railId: string,
  date: string,
  state: SlotState,
  taskName?: string,
  meta?: string,
): CycleSlot => ({ railId, date, state, taskName, meta });

// Helper: compute slot for a given rail×day considering state mix.
const SAMPLE_SLOTS: CycleSlot[] = [
  // --- Mon Apr 13 (workday, past) ---
  slot('er-run', '2026-04-13', 'done'),
  slot('er-408', '2026-04-13', 'done', 'OS · 进程调度'),
  slot('er-deep-am', '2026-04-13', 'done', '技术方案'),
  slot('er-lunch', '2026-04-13', 'done'),
  slot('er-code-pm', '2026-04-13', 'done', 'Today Track'),
  slot('er-oss', '2026-04-13', 'shifted', 'DayRail', '→ Tue 09:00'),
  slot('er-english', '2026-04-13', 'skipped'),
  slot('er-algo', '2026-04-13', 'done', 'LeetCode'),

  // --- Tue Apr 14 (workday, past) ---
  slot('er-run', '2026-04-14', 'skipped'),
  slot('er-408', '2026-04-14', 'done', 'OS · 调度'),
  slot('er-deep-am', '2026-04-14', 'done', 'Figma → 代码'),
  slot('er-lunch', '2026-04-14', 'done'),
  slot('er-code-pm', '2026-04-14', 'done', 'Template Editor'),
  slot('er-oss', '2026-04-14', 'done', 'DayRail', '← Mon 的迁入'),
  slot('er-english', '2026-04-14', 'done'),
  slot('er-algo', '2026-04-14', 'shifted', 'LeetCode', '← 60m → 30m'),

  // --- Wed Apr 15 (workday, past) ---
  slot('er-run', '2026-04-15', 'done'),
  slot('er-408', '2026-04-15', 'done', 'OS · 同步原语'),
  slot('er-deep-am', '2026-04-15', 'done'),
  slot('er-lunch', '2026-04-15', 'done'),
  slot('er-code-pm', '2026-04-15', 'planned-task', 'Cycle View'),
  // er-oss na — skipped slot intentionally
  slot('er-oss', '2026-04-15', 'na'),
  slot('er-english', '2026-04-15', 'done'),
  slot('er-algo', '2026-04-15', 'done'),

  // --- Thu Apr 16 (workday, past) ---
  slot('er-run', '2026-04-16', 'done'),
  slot('er-408', '2026-04-16', 'done'),
  slot('er-deep-am', '2026-04-16', 'shifted', undefined, '→ 13:00'),
  slot('er-lunch', '2026-04-16', 'done'),
  slot('er-code-pm', '2026-04-16', 'done', 'Cycle View'),
  slot('er-oss', '2026-04-16', 'planned-task', 'DayRail · Projects view'),
  slot('er-english', '2026-04-16', 'planned-empty'),
  slot('er-algo', '2026-04-16', 'na'),

  // --- Fri Apr 17 (OVERRIDDEN → restday, today) ---
  slot('er-run-rd', '2026-04-17', 'planned-empty'),
  slot('er-read-rd', '2026-04-17', 'planned-task', '《代码整洁之道》ch 7'),
  slot('er-lunch-rd', '2026-04-17', 'planned-empty'),
  slot('er-oss-rd', '2026-04-17', 'planned-task', 'DayRail · Review 节奏热力图'),
  slot('er-dinner-rd', '2026-04-17', 'planned-empty'),
  slot('er-idle-rd', '2026-04-17', 'planned-empty'),

  // --- Sat Apr 18 (restday, future) ---
  slot('er-run-rd', '2026-04-18', 'planned-empty'),
  slot('er-read-rd', '2026-04-18', 'planned-empty'),
  slot('er-lunch-rd', '2026-04-18', 'planned-empty'),
  slot('er-oss-rd', '2026-04-18', 'planned-task', 'DayRail · Settings'),
  slot('er-dinner-rd', '2026-04-18', 'planned-empty'),
  slot('er-idle-rd', '2026-04-18', 'planned-empty'),

  // --- Sun Apr 19 (restday, future) ---
  slot('er-run-rd', '2026-04-19', 'planned-empty'),
  slot('er-read-rd', '2026-04-19', 'planned-empty'),
  slot('er-lunch-rd', '2026-04-19', 'planned-empty'),
  slot('er-oss-rd', '2026-04-19', 'planned-empty'),
  slot('er-dinner-rd', '2026-04-19', 'planned-empty'),
  slot('er-idle-rd', '2026-04-19', 'planned-empty'),
];

export const SAMPLE_CYCLE: SampleCycle = {
  id: 'cycle-c1-2026-apr',
  label: 'C1',
  startDate: '2026-04-13',
  endDate: '2026-04-19',
  days: DATES,
  slots: SAMPLE_SLOTS,
  topLines: [
    {
      id: 'line-grad-prep',
      name: '考研 408',
      color: 'sand',
      done: 4,
      planned: 5,
    },
    {
      id: 'line-dayrail',
      name: 'DayRail 开发',
      color: 'plum',
      done: 2,
      planned: 5,
    },
    {
      id: 'line-english',
      name: '英语',
      color: 'amber',
      done: 3,
      planned: 5,
    },
  ],
};

// Additional mock cycles for pager popover (D4)
export const SAMPLE_CYCLES: SampleCycle[] = [
  { ...SAMPLE_CYCLE, id: 'cycle-b1', label: 'C-2', startDate: '2026-04-06', endDate: '2026-04-12' },
  { ...SAMPLE_CYCLE, id: 'cycle-b0', label: 'C-1', startDate: '2026-03-30', endDate: '2026-04-05' },
  SAMPLE_CYCLE,
  { ...SAMPLE_CYCLE, id: 'cycle-c2', label: 'C+1', startDate: '2026-04-20', endDate: '2026-04-26' },
];

// -- Backlog (D8) --

export interface BacklogItem {
  id: string;
  name: string;
  lineId?: string;
  lineColor?: RailColor;
  pinned: boolean;
}

export const SAMPLE_BACKLOG: BacklogItem[] = [
  { id: 'bk-1', name: 'Shift 标签 sheet 组件', lineId: 'line-dayrail', lineColor: 'plum', pinned: true },
  { id: 'bk-2', name: 'Review 节奏热力图可视化', lineId: 'line-dayrail', lineColor: 'plum', pinned: false },
  { id: 'bk-3', name: 'OS 中断与异常复习', lineId: 'line-grad-prep', lineColor: 'sand', pinned: true },
  { id: 'bk-4', name: '计网第 3 章笔记整理', lineId: 'line-grad-prep', lineColor: 'sand', pinned: false },
  { id: 'bk-5', name: '英语口语 · 模拟面试', lineId: 'line-english', lineColor: 'amber', pinned: false },
  { id: 'bk-6', name: '年度体检预约', pinned: false },
];

// -- Helpers --

/** Returns the Rails that apply to a given day (based on its template). */
export function railsForDay(day: CycleDay): EditableRail[] {
  const list = SAMPLE_RAILS_BY_TEMPLATE[day.templateKey] ?? [];
  return list.slice().sort((a, b) => a.startMin - b.startMin);
}

/** Groups cycle days by their effective template. */
export function groupDaysByTemplate(
  cycle: SampleCycle,
): Array<{ templateKey: TemplateKey; days: CycleDay[] }> {
  const seen = new Map<TemplateKey, CycleDay[]>();
  for (const d of cycle.days) {
    if (!seen.has(d.templateKey)) seen.set(d.templateKey, []);
    seen.get(d.templateKey)!.push(d);
  }
  // Preserve insertion order of first appearance
  return [...seen.entries()].map(([templateKey, days]) => ({
    templateKey,
    days,
  }));
}

/** O(1)ish slot lookup — backed by a Map built per call for the mock. */
export function buildSlotMap(cycle: SampleCycle) {
  const m = new Map<string, CycleSlot>();
  for (const s of cycle.slots) m.set(`${s.railId}|${s.date}`, s);
  return m;
}

export const formatDayLabel = (
  day: CycleDay,
  locale = 'en-US',
): { weekday: string; dayNum: string; monthAbbr: string } => {
  const dt = new Date(day.date + 'T00:00:00');
  const weekday = dt.toLocaleDateString(locale, { weekday: 'short' });
  const monthAbbr = dt.toLocaleDateString(locale, { month: 'short' });
  const dayNum = String(dt.getDate()).padStart(2, '0');
  return { weekday, dayNum, monthAbbr };
};

export const formatCycleRange = (
  cycle: Pick<SampleCycle, 'startDate' | 'endDate'>,
): string => {
  const sd = new Date(cycle.startDate + 'T00:00:00');
  const ed = new Date(cycle.endDate + 'T00:00:00');
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  return `${fmt(sd)} – ${fmt(ed)}`;
};
