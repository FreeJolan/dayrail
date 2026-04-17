// Static sample for the Projects / Lines view (ERD §5.5).
// MVP delivers only the "Project" Line kind — Habit + Group render in
// the tab row but their sub-tabs are disabled with a v0.4 roadmap note.

import type { RailColor } from './sample';

export type LineKind = 'project' | 'habit' | 'group';
export type LineStatus = 'active' | 'archived';

export type ChunkStatus = 'pending' | 'in-progress' | 'done';

export interface SubItem {
  id: string;
  title: string;
  done: boolean;
}

export interface Chunk {
  id: string;
  lineId: string;
  title: string;
  order: number;
  status: ChunkStatus;
  /** Present on milestones only; 0–100. Determines the Line's main progress. */
  milestonePercent?: number;
  subItems?: SubItem[];
  /** Present when this Chunk has been scheduled into a Cycle Slot. */
  slot?: { date: string; railName: string };
  note?: string;
}

export interface ProjectLine {
  id: string;
  kind: LineKind;
  name: string;
  color: RailColor;
  status: LineStatus;
  plannedStart?: string; // ISO
  plannedEnd?: string; // ISO
  createdAt: string;
  chunks: Chunk[];
  /** Optional short description under the name. */
  subtitle?: string;
}

// --- Projects ---

const DAYRAIL: ProjectLine = {
  id: 'line-dayrail',
  kind: 'project',
  name: 'DayRail 开发',
  subtitle: 'v0.1 静态视觉 → v0.2 SQLite + 事件日志',
  color: 'plum',
  status: 'active',
  plannedStart: '2026-03-16',
  plannedEnd: '2026-07-31',
  createdAt: '2026-03-12',
  chunks: [
    {
      id: 'c-dr-1',
      lineId: 'line-dayrail',
      title: 'Today Track 静态页',
      order: 1,
      status: 'done',
      milestonePercent: 10,
      slot: { date: '2026-04-14', railName: '工作 · 编码' },
    },
    {
      id: 'c-dr-2',
      lineId: 'line-dayrail',
      title: 'Template Editor 静态页',
      order: 2,
      status: 'done',
      milestonePercent: 25,
      slot: { date: '2026-04-14', railName: '工作 · 编码' },
    },
    {
      id: 'c-dr-3',
      lineId: 'line-dayrail',
      title: 'Cycle View 静态页',
      order: 3,
      status: 'done',
      milestonePercent: 40,
      slot: { date: '2026-04-16', railName: '工作 · 编码' },
    },
    {
      id: 'c-dr-4',
      lineId: 'line-dayrail',
      title: 'Review 节奏热力图',
      order: 4,
      status: 'done',
      milestonePercent: 50,
    },
    {
      id: 'c-dr-5',
      lineId: 'line-dayrail',
      title: 'Projects / Lines 视图',
      order: 5,
      status: 'in-progress',
      slot: { date: '2026-04-17', railName: '开源项目' },
      subItems: [
        { id: 'si-5-1', title: 'Sample data + types', done: true },
        { id: 'si-5-2', title: 'ProjectsList 左栏', done: true },
        { id: 'si-5-3', title: 'ProjectDetail 右栏', done: false },
        { id: 'si-5-4', title: 'Empty state', done: false },
      ],
    },
    {
      id: 'c-dr-6',
      lineId: 'line-dayrail',
      title: 'Pending 队列页',
      order: 6,
      status: 'pending',
    },
    {
      id: 'c-dr-7',
      lineId: 'line-dayrail',
      title: 'Calendar 月视图 + 规则 drawer',
      order: 7,
      status: 'pending',
    },
    {
      id: 'c-dr-8',
      lineId: 'line-dayrail',
      title: 'Settings 页（5 section）',
      order: 8,
      status: 'pending',
      milestonePercent: 70,
    },
    {
      id: 'c-dr-9',
      lineId: 'line-dayrail',
      title: '数据层：SQLite (wa-sqlite) + Drizzle schema',
      order: 9,
      status: 'pending',
      milestonePercent: 85,
    },
    {
      id: 'c-dr-10',
      lineId: 'line-dayrail',
      title: 'v0.2 发布',
      order: 10,
      status: 'pending',
      milestonePercent: 100,
    },
  ],
};

const GRAD_PREP: ProjectLine = {
  id: 'line-grad-prep',
  kind: 'project',
  name: '408 考研复习',
  subtitle: '数据结构 / 操作系统 / 计算机网络 / 组成原理',
  color: 'sand',
  status: 'active',
  plannedStart: '2026-03-01',
  plannedEnd: '2026-12-22',
  createdAt: '2026-02-20',
  chunks: [
    {
      id: 'c-gp-1',
      lineId: 'line-grad-prep',
      title: '数据结构一轮',
      order: 1,
      status: 'done',
      milestonePercent: 15,
    },
    {
      id: 'c-gp-2',
      lineId: 'line-grad-prep',
      title: '操作系统一轮',
      order: 2,
      status: 'in-progress',
      milestonePercent: 35,
      subItems: [
        { id: 'si-os-1', title: 'Ch1 概论', done: true },
        { id: 'si-os-2', title: 'Ch2 进程与线程', done: true },
        { id: 'si-os-3', title: 'Ch3 内存管理', done: true },
        { id: 'si-os-4', title: 'Ch4 文件系统', done: false },
        { id: 'si-os-5', title: 'Ch5 IO 管理', done: false },
      ],
      slot: { date: '2026-04-17', railName: '408 复习' },
    },
    {
      id: 'c-gp-3',
      lineId: 'line-grad-prep',
      title: '计网一轮',
      order: 3,
      status: 'pending',
      milestonePercent: 55,
    },
    {
      id: 'c-gp-4',
      lineId: 'line-grad-prep',
      title: '组成原理一轮',
      order: 4,
      status: 'pending',
      milestonePercent: 75,
    },
    {
      id: 'c-gp-5',
      lineId: 'line-grad-prep',
      title: '二轮 + 真题',
      order: 5,
      status: 'pending',
      milestonePercent: 95,
    },
    {
      id: 'c-gp-6',
      lineId: 'line-grad-prep',
      title: '考前冲刺',
      order: 6,
      status: 'pending',
      milestonePercent: 100,
    },
  ],
};

const ENGLISH: ProjectLine = {
  id: 'line-english',
  kind: 'project',
  name: '英语学习',
  subtitle: 'B2 → C1 · 口语 + 阅读双线',
  color: 'amber',
  status: 'active',
  plannedEnd: '2026-09-30',
  createdAt: '2026-03-01',
  chunks: [
    {
      id: 'c-en-1',
      lineId: 'line-english',
      title: 'IELTS 阅读真题 1-5',
      order: 1,
      status: 'done',
    },
    {
      id: 'c-en-2',
      lineId: 'line-english',
      title: '口语 · 每周一次模拟面试',
      order: 2,
      status: 'in-progress',
      subItems: [
        { id: 'si-en-1', title: 'Week 1 · 家庭 / 工作', done: true },
        { id: 'si-en-2', title: 'Week 2 · 科技', done: true },
        { id: 'si-en-3', title: 'Week 3 · 环境', done: false },
      ],
    },
    {
      id: 'c-en-3',
      lineId: 'line-english',
      title: '词汇 · 雅思核心 6000',
      order: 3,
      status: 'pending',
    },
  ],
};

// --- Archived project (done thesis) ---
const THESIS: ProjectLine = {
  id: 'line-thesis',
  kind: 'project',
  name: '硕士毕业论文',
  subtitle: '分布式系统下的一致性协议优化',
  color: 'slate',
  status: 'archived',
  plannedEnd: '2025-12-20',
  createdAt: '2025-06-01',
  chunks: [
    { id: 'c-th-1', lineId: 'line-thesis', title: '开题报告', order: 1, status: 'done', milestonePercent: 10 },
    { id: 'c-th-2', lineId: 'line-thesis', title: '文献综述', order: 2, status: 'done', milestonePercent: 25 },
    { id: 'c-th-3', lineId: 'line-thesis', title: '初稿', order: 3, status: 'done', milestonePercent: 60 },
    { id: 'c-th-4', lineId: 'line-thesis', title: '导师修改', order: 4, status: 'done', milestonePercent: 80 },
    { id: 'c-th-5', lineId: 'line-thesis', title: '答辩', order: 5, status: 'done', milestonePercent: 100 },
  ],
};

export const SAMPLE_PROJECTS: ProjectLine[] = [DAYRAIL, GRAD_PREP, ENGLISH, THESIS];

// --- Helpers ---

/** Max milestonePercent among done Chunks = Line's primary progress. */
export function computeProjectProgress(line: ProjectLine): number {
  const doneMilestones = line.chunks.filter(
    (c) => c.status === 'done' && c.milestonePercent != null,
  );
  if (doneMilestones.length === 0) return 0;
  return Math.max(...doneMilestones.map((c) => c.milestonePercent ?? 0));
}

export function countDoneChunks(line: ProjectLine): { done: number; total: number } {
  const total = line.chunks.length;
  const done = line.chunks.filter((c) => c.status === 'done').length;
  return { done, total };
}

export function isOverdue(line: ProjectLine, todayISO = '2026-04-17'): boolean {
  if (!line.plannedEnd) return false;
  if (line.status !== 'active') return false;
  const today = new Date(todayISO + 'T00:00:00').getTime();
  const end = new Date(line.plannedEnd + 'T00:00:00').getTime();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  return today - end > SEVEN_DAYS_MS;
}
