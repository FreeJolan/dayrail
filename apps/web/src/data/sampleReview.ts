// Static sample for the Review screen (ERD §5.8 F2). Week-scope snapshot
// covering all heatmap states so the visual can be proofed in one pass.

import type { RailColor } from './sample';

export type HeatmapState =
  | 'done' // completed
  | 'shifted' // happened with a postpone / swap / resize
  | 'skipped' // explicitly skipped
  | 'unmarked' // ended with no decision (§5.7 queue)
  | 'empty'; // Rail didn't apply this day (not counted)

export interface HeatmapRow {
  railId: string;
  railName: string;
  color: RailColor;
  /** Date (ISO) → status. Dates not present render as `empty`. */
  byDate: Record<string, HeatmapState>;
}

export interface ShiftTagStat {
  name: string;
  count: number;
}

export interface AdhocHint {
  eventName: string;
  weekdayLabel: string;
  occurrences: number;
}

export interface ReviewScopeData {
  scope: 'day' | 'week' | 'month';
  label: string;
  dates: string[]; // ISO dates that form the columns
  rows: HeatmapRow[];
  shiftTags: ShiftTagStat[];
  adhocHint?: AdhocHint;
  totalDone: number;
  totalSlots: number;
  /** Rhythm match % (`done` / total slots that had a plan). */
  rhythmMatchPct: number;
}

// Week: Apr 13 (Mon) → Apr 19 (Sun). Reuses the Cycle sample dates.
const WEEK_DATES = [
  '2026-04-13',
  '2026-04-14',
  '2026-04-15',
  '2026-04-16',
  '2026-04-17',
  '2026-04-18',
  '2026-04-19',
];

// Helper: assemble a status row quickly with positional notation.
// order = [Mon, Tue, Wed, Thu, Fri, Sat, Sun]; use 'd' | 's' | 'k' | 'u' | '-'.
const row = (
  railId: string,
  railName: string,
  color: RailColor,
  code: string,
): HeatmapRow => {
  if (code.length !== 7) throw new Error(`row code must be length 7, got ${code.length}`);
  const map: Record<string, HeatmapState> = {};
  const KEYS: Record<string, HeatmapState> = {
    d: 'done',
    s: 'shifted',
    k: 'skipped',
    u: 'unmarked',
    '-': 'empty',
  };
  for (let i = 0; i < 7; i++) {
    const ch = code[i]!;
    const state = KEYS[ch];
    if (!state) throw new Error(`unknown state code ${ch}`);
    if (state !== 'empty') map[WEEK_DATES[i]!] = state;
  }
  return { railId, railName, color, byDate: map };
};

// Week-scope rows. Sorted by frequency-of-appearance descending.
const WEEK_ROWS: HeatmapRow[] = [
  // Rails that appear every weekday (5/7 or 7/7 frequency come first)
  row('er-408', '408 复习', 'sand', 'ddddd--'),
  row('er-deep-am', '工作 · 深度任务', 'teal', 'dddsu--'),
  row('er-code-pm', '工作 · 编码', 'teal', 'dddd---'),
  row('er-lunch', '午休', 'gray', 'dddd---'),
  row('er-run', '晨跑', 'sage', 'dkdd---'),
  row('er-oss', '开源项目', 'mauve', 'sddu---'),
  row('er-english', '英语 · 口语', 'amber', 'kdddu--'),
  row('er-algo', '算法', 'pink', 'dsdk---'),
  // Restday rails
  row('er-run-rd', '晨跑 (restday)', 'sage', '----u-u'),
  row('er-read-rd', '阅读', 'sand', '----u-u'),
  row('er-oss-rd', '开源项目 (restday)', 'mauve', '----u-u'),
];

export const SAMPLE_WEEK_REVIEW: ReviewScopeData = {
  scope: 'week',
  label: 'Apr 13 – Apr 19',
  dates: WEEK_DATES,
  rows: WEEK_ROWS,
  shiftTags: [
    { name: '会议冲突', count: 5 },
    { name: '状态不在', count: 3 },
    { name: '临时变动', count: 2 },
    { name: '累了', count: 2 },
    { name: '换块时段', count: 1 },
  ],
  adhocHint: {
    eventName: '例会 · 工程周会',
    weekdayLabel: 'Wed',
    occurrences: 3,
  },
  totalDone: 23,
  totalSlots: 37,
  rhythmMatchPct: 62,
};

// Abbreviated placeholders for other scopes — the static mock focuses
// on week view. Day/Month are selectable but render a small placeholder.

export const SAMPLE_DAY_REVIEW: ReviewScopeData = {
  scope: 'day',
  label: 'Thu · 16 Apr 2026',
  dates: ['2026-04-16'],
  rows: WEEK_ROWS.slice(0, 8).map((r) => {
    const s = r.byDate['2026-04-16'];
    const byDate: Record<string, HeatmapState> = s ? { '2026-04-16': s } : {};
    return { ...r, byDate };
  }),
  shiftTags: [
    { name: '临时变动', count: 2 },
    { name: '会议冲突', count: 1 },
  ],
  totalDone: 5,
  totalSlots: 8,
  rhythmMatchPct: 62,
};

export const SAMPLE_MONTH_REVIEW: ReviewScopeData = {
  scope: 'month',
  label: 'April 2026',
  // for month scope the sample is intentionally sparse — real impl
  // would emit one column per week, not per day.
  dates: ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27'],
  rows: WEEK_ROWS.slice(0, 6).map((r) => ({
    ...r,
    byDate: {
      '2026-04-06': 'done',
      '2026-04-13': r.byDate['2026-04-13'] ?? 'done',
      '2026-04-20': 'done',
      '2026-04-27': 'unmarked',
    },
  })),
  shiftTags: [
    { name: '会议冲突', count: 14 },
    { name: '累了', count: 9 },
    { name: '临时变动', count: 7 },
    { name: '换块时段', count: 5 },
    { name: '状态不在', count: 4 },
  ],
  totalDone: 98,
  totalSlots: 160,
  rhythmMatchPct: 61,
};
