// Static sample for the Template Editor mockup. Shape matches the
// subset of ERD §10 Rail / Template types that the editor touches.
import type { RailColor } from './sample';

/** Widened from the original closed union so Cycle-View code can feed
 *  store-held templates (whose keys are user-defined strings) into the
 *  same prop shapes. The sample defaults (`workday` / `restday` /
 *  `deep` / `travel`) still work as-is. */
export type TemplateKey = string;

export interface SampleTemplate {
  key: TemplateKey;
  label: string;
  /** Template.color — tab under-strip + Cycle View column tint etc. */
  color: RailColor;
  builtIn: boolean;
}

export interface EditableRail {
  id: string;
  name: string;
  subtitle?: string;
  /** Minutes from 00:00. Authoritative ordering key. */
  startMin: number;
  endMin: number;
  color: RailColor;
  /** ERD §5.6 — does this Rail surface on the check-in strip? */
  showInCheckin: boolean;
}

// Default template palette. Chosen for hue contrast: slate / sage
// (the v0.3 defaults) were both desaturated grays and collapsed to
// visually identical tints on the Calendar month grid. indigo +
// amber are strongly opposed in hue even at low step values, so
// workday vs restday reads at a glance.
export const SAMPLE_TEMPLATES: SampleTemplate[] = [
  { key: 'workday', label: 'Workday', color: 'indigo', builtIn: true },
  { key: 'restday', label: 'Restday', color: 'amber', builtIn: true },
  { key: 'deep', label: 'Deep Focus', color: 'teal', builtIn: false },
  { key: 'travel', label: 'Travel', color: 'plum', builtIn: false },
];

const hm = (h: number, m = 0) => h * 60 + m;

export const SAMPLE_RAILS_BY_TEMPLATE: Record<TemplateKey, EditableRail[]> = {
  workday: [
    {
      id: 'er-run',
      name: '晨跑',
      startMin: hm(6),
      endMin: hm(7),
      color: 'sage',
      showInCheckin: true,
    },
    {
      id: 'er-408',
      name: '408 复习',
      subtitle: '操作系统 · 进程调度',
      startMin: hm(7),
      endMin: hm(9),
      color: 'sand',
      showInCheckin: true,
    },
    {
      id: 'er-deep-am',
      name: '工作 · 深度任务',
      startMin: hm(9),
      endMin: hm(12),
      color: 'teal',
      showInCheckin: true,
    },
    {
      id: 'er-lunch',
      name: '午休',
      startMin: hm(12),
      endMin: hm(13),
      color: 'slate',
      showInCheckin: false,
    },
    // gap 13:00 → 14:00
    {
      id: 'er-code-pm',
      name: '工作 · 编码',
      startMin: hm(14),
      endMin: hm(16),
      color: 'teal',
      showInCheckin: true,
    },
    {
      id: 'er-oss',
      name: '开源项目',
      subtitle: 'DayRail',
      startMin: hm(16),
      endMin: hm(18),
      color: 'plum',
      showInCheckin: true,
    },
    // gap 18:00 → 19:00
    {
      id: 'er-english',
      name: '英语 · 口语',
      startMin: hm(19),
      endMin: hm(20, 30),
      color: 'amber',
      showInCheckin: true,
    },
    {
      id: 'er-algo',
      name: '算法',
      subtitle: 'LeetCode Hot 100',
      startMin: hm(20, 30),
      endMin: hm(21, 30),
      color: 'pink',
      showInCheckin: true,
    },
  ],
  restday: [
    {
      id: 'er-run-rd',
      name: '晨跑',
      startMin: hm(7, 30),
      endMin: hm(9),
      color: 'sage',
      showInCheckin: true,
    },
    {
      id: 'er-read-rd',
      name: '阅读',
      startMin: hm(10),
      endMin: hm(12),
      color: 'sand',
      showInCheckin: true,
    },
    {
      id: 'er-lunch-rd',
      name: '午餐',
      startMin: hm(12),
      endMin: hm(13),
      color: 'slate',
      showInCheckin: false,
    },
    {
      id: 'er-oss-rd',
      name: '开源项目',
      startMin: hm(14),
      endMin: hm(17),
      color: 'plum',
      showInCheckin: true,
    },
    {
      id: 'er-dinner-rd',
      name: '晚饭',
      startMin: hm(19),
      endMin: hm(20),
      color: 'brown',
      showInCheckin: false,
    },
    {
      id: 'er-idle-rd',
      name: '放空',
      startMin: hm(20),
      endMin: hm(21, 30),
      color: 'slate',
      showInCheckin: false,
    },
  ],
  deep: [],
  travel: [],
};

// --- derived summary (the strip under the tab bar consumes this) ---

export interface TemplateSummary {
  railCount: number;
  totalMin: number;
  firstMin: number; // start of the earliest Rail
  lastMin: number; // end of the latest Rail
  gaps: Array<{ startMin: number; endMin: number }>;
  gapTotalMin: number;
}

export function computeSummary(rails: EditableRail[]): TemplateSummary {
  if (rails.length === 0) {
    return { railCount: 0, totalMin: 0, firstMin: 0, lastMin: 0, gaps: [], gapTotalMin: 0 };
  }
  const sorted = rails.slice().sort((a, b) => a.startMin - b.startMin);
  const firstMin = sorted[0]!.startMin;
  const lastMin = sorted[sorted.length - 1]!.endMin;
  const totalMin = sorted.reduce((sum, r) => sum + (r.endMin - r.startMin), 0);
  const gaps: TemplateSummary['gaps'] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    if (next.startMin > cur.endMin) {
      gaps.push({ startMin: cur.endMin, endMin: next.startMin });
    }
  }
  const gapTotalMin = gaps.reduce((s, g) => s + (g.endMin - g.startMin), 0);
  return { railCount: rails.length, totalMin, firstMin, lastMin, gaps, gapTotalMin };
}

// --- formatting helpers ---

export const fmtHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const fmtDurationHours = (m: number) => {
  const h = m / 60;
  if (Number.isInteger(h)) return `${h}h`;
  return `${h.toFixed(1)}h`;
};

export const fmtDurationShort = (m: number) => {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h}h`;
  return `${h}h${rem}`;
};
