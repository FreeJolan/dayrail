// Static sample for the Today Track mockup (no persistence; no real state).
// Shape roughly matches ERD §10 `Rail` / `RailInstance` but trimmed to what
// the page needs to render.

export type RailColor =
  | 'sand'
  | 'sage'
  | 'olive'
  | 'slate'
  | 'mauve'
  | 'brown'
  | 'amber'
  | 'teal'
  | 'pink'
  | 'gray';

export type RailState =
  | 'pending' // future Rail, not yet started
  | 'current' // active right now — only one per day
  | 'done' // user marked done
  | 'skipped' // user explicitly skipped
  | 'unmarked'; // ended without a decision; lives in §5.7 queue

export interface SampleRail {
  id: string;
  name: string; // §10 Rail.name
  subtitle?: string; // Slot.taskName or similar — optional per-day overlay
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  color: RailColor;
  state: RailState;
  /** When false, this Rail never hits the §5.6 check-in strip and
   *  never sits in the §5.7 pending queue (ERD: "showInCheckin"). */
  showInCheckin: boolean;
}

// 2026-04-17 (Friday). Clock in the mock renders as 14:27 —
// user has just returned to the app after a quiet morning.
export const MOCK_NOW = {
  hh: 14,
  mm: 27,
  dateISO: '2026-04-17',
  weekdayShort: 'Fri',
  dayLabel: '17 Apr 2026',
};

export const SAMPLE_RAILS: SampleRail[] = [
  {
    id: 'rail-morning-run',
    name: '晨跑',
    start: '06:00',
    end: '07:00',
    color: 'sage',
    state: 'unmarked',
    showInCheckin: true,
  },
  {
    id: 'rail-408',
    name: '408 复习',
    subtitle: '操作系统 · 进程调度',
    start: '07:00',
    end: '09:00',
    color: 'sand',
    state: 'unmarked',
    showInCheckin: true,
  },
  {
    id: 'rail-deep-am',
    name: '工作 · 深度任务',
    subtitle: '审技术方案 · DayRail 静态页',
    start: '09:00',
    end: '12:00',
    color: 'teal',
    state: 'done',
    showInCheckin: true,
  },
  {
    id: 'rail-lunch',
    name: '午休',
    start: '12:00',
    end: '13:00',
    color: 'gray',
    state: 'done',
    showInCheckin: false,
  },
  {
    id: 'rail-code-pm',
    name: '工作 · 编码',
    subtitle: 'DayRail Today Track 静态页',
    start: '14:00',
    end: '16:00',
    color: 'teal',
    state: 'current',
    showInCheckin: true,
  },
  {
    id: 'rail-oss',
    name: '开源项目',
    start: '16:00',
    end: '18:00',
    color: 'mauve',
    state: 'pending',
    showInCheckin: true,
  },
  {
    id: 'rail-english',
    name: '英语 · 口语',
    start: '19:00',
    end: '20:30',
    color: 'amber',
    state: 'pending',
    showInCheckin: true,
  },
  {
    id: 'rail-algo',
    name: '算法',
    subtitle: 'LeetCode Hot 100 · 动态规划',
    start: '20:30',
    end: '21:30',
    color: 'pink',
    state: 'pending',
    showInCheckin: true,
  },
  {
    id: 'rail-cardio',
    name: '有氧',
    start: '22:00',
    end: '22:30',
    color: 'olive',
    state: 'pending',
    showInCheckin: true,
  },
  {
    id: 'rail-review',
    name: '复盘',
    start: '23:00',
    end: '23:30',
    color: 'slate',
    state: 'pending',
    showInCheckin: true,
  },
];

// Rails that ended unmarked and are eligible for the §5.6 check-in strip
// (opened within the last 24h, showInCheckin=true).
export const CHECKIN_QUEUE = SAMPLE_RAILS.filter(
  (r) => r.state === 'unmarked' && r.showInCheckin,
);
