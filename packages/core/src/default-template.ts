import type { Rail, Template, TemplateKey } from './types';

// The preset templates a new user lands in on first launch (ERD §5.1).
// Intentionally tweakable in place — not meant as aspirational, just plausible.

export const DEFAULT_WORKDAY_TEMPLATE: Template = {
  id: 'tpl_default_workday',
  name: 'Workday',
  isDefault: true,
};

export const DEFAULT_RESTDAY_TEMPLATE: Template = {
  id: 'tpl_default_restday',
  name: 'Restday',
  isDefault: true,
};

// Backwards-compat export for code that still imports DEFAULT_TEMPLATE singular.
export const DEFAULT_TEMPLATE = DEFAULT_WORKDAY_TEMPLATE;

const t = (hh: number, mm = 0) => hh * 60 + mm;

export const DEFAULT_WORKDAY_RAILS: Rail[] = [
  {
    id: 'rail_wd_morning_study',
    name: '408 复习',
    startMinutes: t(6, 0),
    durationMinutes: 120,
    color: 'sand',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_math',
    name: '数学',
    startMinutes: t(8, 0),
    durationMinutes: 120,
    color: 'sage',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_work_am',
    name: '工作 · 文档',
    startMinutes: t(10, 0),
    durationMinutes: 120,
    color: 'teal',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_work_pm',
    name: '工作 · 编码',
    startMinutes: t(14, 0),
    durationMinutes: 120,
    color: 'teal',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_side_project',
    name: '开源项目',
    startMinutes: t(16, 0),
    durationMinutes: 120,
    color: 'mauve',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_english',
    name: '英语',
    startMinutes: t(19, 0),
    durationMinutes: 90,
    color: 'amber',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_algo',
    name: '算法',
    startMinutes: t(20, 30),
    durationMinutes: 60,
    color: 'pink',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_cardio',
    name: '有氧',
    startMinutes: t(22, 0),
    durationMinutes: 30,
    color: 'olive',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
  {
    id: 'rail_wd_review',
    name: '复盘',
    startMinutes: t(23, 0),
    durationMinutes: 30,
    color: 'slate',
    recurrence: { kind: 'weekdays' },
    signal: { enabled: false },
    templateId: DEFAULT_WORKDAY_TEMPLATE.id,
  },
];

export const DEFAULT_RESTDAY_RAILS: Rail[] = [
  {
    id: 'rail_rd_morning_study',
    name: '408 复习',
    startMinutes: t(6, 0),
    durationMinutes: 120,
    color: 'sand',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_math',
    name: '数学',
    startMinutes: t(8, 0),
    durationMinutes: 120,
    color: 'sage',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_coding',
    name: '刷题 / 编程',
    startMinutes: t(10, 0),
    durationMinutes: 120,
    color: 'teal',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_summary',
    name: '周 / 月复盘',
    startMinutes: t(14, 0),
    durationMinutes: 60,
    color: 'slate',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_english_gl',
    name: '英语 · 语法',
    startMinutes: t(15, 0),
    durationMinutes: 60,
    color: 'amber',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_english_oral',
    name: '英语 · 口语听力',
    startMinutes: t(16, 0),
    durationMinutes: 120,
    color: 'amber',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_english_vocab',
    name: '英语 · 词汇',
    startMinutes: t(19, 0),
    durationMinutes: 60,
    color: 'amber',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_cardio',
    name: '有氧',
    startMinutes: t(22, 0),
    durationMinutes: 30,
    color: 'olive',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
  {
    id: 'rail_rd_review',
    name: '复盘',
    startMinutes: t(22, 30),
    durationMinutes: 30,
    color: 'slate',
    recurrence: { kind: 'custom', weekdays: [0, 6] },
    signal: { enabled: false },
    templateId: DEFAULT_RESTDAY_TEMPLATE.id,
  },
];

// Legacy export name kept to avoid a coordinated rename across the web app.
export const DEFAULT_RAILS = DEFAULT_WORKDAY_RAILS;

export const DEFAULT_TEMPLATES: Record<TemplateKey, Template> = {
  workday: DEFAULT_WORKDAY_TEMPLATE,
  restday: DEFAULT_RESTDAY_TEMPLATE,
};

export const DEFAULT_RAILS_BY_TEMPLATE: Record<TemplateKey, Rail[]> = {
  workday: DEFAULT_WORKDAY_RAILS,
  restday: DEFAULT_RESTDAY_RAILS,
};
