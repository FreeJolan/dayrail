// AI intent → native-draft staging model (ERD §6.7).
//
// A pasted / MCP natural-language blob becomes PROPOSAL DRAFTS shaped
// like the things the user already creates by hand — a Task draft, or a
// Habit draft — NOT a parallel "parameter" vocabulary. The review card
// edits these with the app's native fields; `commitDraft` writes them as
// real entities inside ONE Edit Session (add-only, one-click undo).
//
// Deliberately NO user-facing intermediate model: the draft IS the
// native shape (title / note / priority / steps for a task; name + rail
// time-slots + weekdays + effective-from for a habit). Whatever schema
// the AI fills upstream is invisible to the user (see intentParse.ts).

import {
  INBOX_LINE_ID,
  type Line,
  type Rail,
  type RailColor,
  type Task,
  type TaskPriority,
  type TemplateKey,
} from './types';
import { cycleIdOf } from './autoTask';
import { toIsoDate } from './today';

export type ProposalShape = 'task' | 'habit';

/** A task proposal in the user's native task fields. */
/** A 切分 step → a TaskOccurrence (label + optional milestone %). */
export interface TaskStep {
  label: string;
  /** 0–100 milestone position on the parent task (§10.6). */
  percent?: number;
}

/** Optional scheduling of a task onto a Rail (§6.7.8). Omitted ⇒ the
 *  task stays unscheduled in its line / Inbox. Usually binds an existing
 *  Rail; new-rail is rare. A task is one date → one template, so the new
 *  variant takes a single `templateKey`. `date` defaults to today. */
export type TaskScheduleDraft =
  | { mode: 'existing'; railId: string; date?: string }
  | {
      mode: 'new';
      startMinutes: number;
      durationMinutes?: number;
      templateKey?: TemplateKey;
      date?: string;
    };

export interface TaskDraft {
  kind: 'task';
  title: string;
  note?: string;
  priority?: TaskPriority;
  /** Owning line; defaults to Inbox. */
  lineId: string;
  /** §10.6 切分 steps — each becomes a TaskOccurrence. */
  steps: TaskStep[];
  /** §6.7.8 — optional Rail scheduling (sets the task's slot). */
  schedule?: TaskScheduleDraft;
}

/** One time-slot of a habit: bind an EXISTING rail, or create a NEW one
 *  (ERD §6.7 — user choice per slot; binding to existing is exactly how
 *  habits are set up natively).
 *
 *  A Rail lives in ONE day-template, so a "new" slot can target one or
 *  more templates. `templateKeys` omitted/empty ⇒ a rail in EVERY
 *  template = the habit fires every day (§6.7.8); `['workday']` /
 *  `['restday']` narrows it. */
export type HabitSlotDraft =
  | {
      mode: 'new';
      startMinutes: number;
      durationMinutes?: number;
      templateKeys?: TemplateKey[];
      weekdays?: number[];
    }
  | { mode: 'existing'; railId: string; weekdays?: number[] };

/** A habit proposal in the user's native habit-setup fields. */
export interface HabitDraft {
  kind: 'habit';
  name: string;
  note?: string;
  /** ISO YYYY-MM-DD applied as the rail/binding effectiveFrom (§10.5).
   *  Undefined = today (the writer default). */
  effectiveFrom?: string;
  slots: HabitSlotDraft[];
}

export type ProposalDraft = TaskDraft | HabitDraft;

export const DEFAULT_BLOCK_MINUTES = 30;
const DEFAULT_COLOR: RailColor = 'teal';
const DEFAULT_TEMPLATE_KEY: TemplateKey = 'workday';

// ── factories + shape conversion ────────────────────────────────────

export function emptyTaskDraft(title = ''): TaskDraft {
  return { kind: 'task', title, lineId: INBOX_LINE_ID, steps: [] };
}

export function emptyHabitDraft(name = ''): HabitDraft {
  return { kind: 'habit', name, slots: [] };
}

/** The review card's shape toggle (习惯 ↔ 临时任务). Carries over what
 *  maps cleanly (name/title + note); shape-specific detail that doesn't
 *  translate is dropped — expected, they're different things. */
export function toggleDraftKind(draft: ProposalDraft): ProposalDraft {
  if (draft.kind === 'task') {
    return { kind: 'habit', name: draft.title, ...(draft.note ? { note: draft.note } : {}), slots: [] };
  }
  return {
    kind: 'task',
    title: draft.name,
    ...(draft.note ? { note: draft.note } : {}),
    lineId: INBOX_LINE_ID,
    steps: [],
  };
}

// ── commit (ERD §6.7.4 · add-only · one Edit Session) ───────────────

/** Minimal write surface `commitDraft` drives; each call rides the Edit
 *  Session's id so the batch undoes as one. */
export interface StagingWriters {
  openSession(surface: string): Promise<{ id: string }>;
  closeSession(sessionId: string): Promise<void>;
  createLine(line: Line, sessionId: string): Promise<void>;
  createRail(rail: Rail, sessionId: string, effectiveFrom?: string): Promise<void>;
  bindHabit(
    opts: { habitId: string; railId: string; weekdays?: number[]; effectiveFrom?: string },
    sessionId: string,
  ): Promise<void>;
  createTask(task: Task, sessionId: string): Promise<void>;
  addOccurrence(
    taskId: string,
    occ: { label?: string; percent?: number },
    sessionId: string,
  ): Promise<void>;
  scheduleTask(
    taskId: string,
    slot: { cycleId: string; date: string; railId: string },
    sessionId: string,
  ): Promise<void>;
}

export interface CommitOptions {
  /** Id minter; injectable for deterministic tests. */
  genId?: (prefix: string) => string;
  /** Wall clock for `createdAt` (epoch ms); injectable for tests. */
  now?: number;
  /** All template keys (§6.7.8) — a habit "new" slot with no explicit
   *  template restriction expands to a rail in EVERY one (= every day).
   *  Omitted ⇒ falls back to the single default template. */
  allTemplateKeys?: TemplateKey[];
  /** ISO date used as the default for task scheduling; defaults to today. */
  today?: string;
}

function defaultGenId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** ERD §6.7.4. Apply a proposal draft as ONE Edit Session, add-only.
 *  Task → createTask (+ a TaskOccurrence per step). Habit → createLine,
 *  then per slot either bind an existing rail or createRail + bind.
 *  Returns the sessionId for the post-confirm one-click undo. */
export async function commitDraft(
  draft: ProposalDraft,
  w: StagingWriters,
  opts: CommitOptions = {},
): Promise<string> {
  const genId = opts.genId ?? defaultGenId;
  const now = opts.now ?? Date.now();
  const today = opts.today ?? toIsoDate(new Date(now));
  const { id: sessionId } = await w.openSession('staging-commit');

  if (draft.kind === 'task') {
    const task: Task = {
      id: genId('task'),
      lineId: draft.lineId,
      title: draft.title,
      order: 0,
      status: 'pending',
      ...(draft.note ? { note: draft.note } : {}),
      ...(draft.priority ? { priority: draft.priority } : {}),
    };
    await w.createTask(task, sessionId);
    for (const step of draft.steps) {
      const label = step.label.trim();
      if (!label) continue;
      await w.addOccurrence(
        task.id,
        { label, ...(step.percent !== undefined ? { percent: step.percent } : {}) },
        sessionId,
      );
    }
    // §6.7.8 — optional scheduling onto a Rail. Usually an existing rail;
    // a new rail (rare) goes in one template (a task is a single date).
    if (draft.schedule) {
      const sched = draft.schedule;
      const date = sched.date ?? today;
      if (sched.mode === 'existing') {
        if (sched.railId) {
          await w.scheduleTask(
            task.id,
            { cycleId: cycleIdOf(date), date, railId: sched.railId },
            sessionId,
          );
        }
      } else {
        const rail: Rail = {
          id: genId('rail'),
          templateKey: sched.templateKey ?? DEFAULT_TEMPLATE_KEY,
          name: draft.title,
          startMinutes: sched.startMinutes,
          durationMinutes: sched.durationMinutes ?? DEFAULT_BLOCK_MINUTES,
          color: DEFAULT_COLOR,
          showInCheckin: true,
        };
        await w.createRail(rail, sessionId, date);
        await w.scheduleTask(
          task.id,
          { cycleId: cycleIdOf(date), date, railId: rail.id },
          sessionId,
        );
      }
    }
  } else {
    const line: Line = {
      id: genId('line'),
      name: draft.name,
      kind: 'habit',
      status: 'active',
      color: DEFAULT_COLOR,
      createdAt: now,
      ...(draft.note ? { note: draft.note } : {}),
    };
    await w.createLine(line, sessionId);
    const ef = draft.effectiveFrom;
    for (const slot of draft.slots) {
      const weekdaysOpt =
        slot.weekdays && slot.weekdays.length > 0 ? { weekdays: slot.weekdays } : {};
      const efOpt = ef ? { effectiveFrom: ef } : {};

      if (slot.mode === 'existing') {
        if (!slot.railId) continue; // no rail chosen yet — skip defensively
        await w.bindHabit({ habitId: line.id, railId: slot.railId, ...weekdaysOpt, ...efOpt }, sessionId);
        continue;
      }

      // New rail per target template. No explicit template restriction ⇒
      // a rail in EVERY template, so the habit fires every day (§6.7.8).
      const targetTemplates =
        slot.templateKeys && slot.templateKeys.length > 0
          ? slot.templateKeys
          : opts.allTemplateKeys && opts.allTemplateKeys.length > 0
            ? opts.allTemplateKeys
            : [DEFAULT_TEMPLATE_KEY];
      for (const templateKey of targetTemplates) {
        const rail: Rail = {
          id: genId('rail'),
          templateKey,
          name: draft.name,
          startMinutes: slot.startMinutes,
          durationMinutes: slot.durationMinutes ?? DEFAULT_BLOCK_MINUTES,
          color: DEFAULT_COLOR,
          showInCheckin: true,
        };
        await w.createRail(rail, sessionId, ef);
        await w.bindHabit({ habitId: line.id, railId: rail.id, ...weekdaysOpt, ...efOpt }, sessionId);
      }
    }
  }

  await w.closeSession(sessionId);
  return sessionId;
}

// ── store binding ───────────────────────────────────────────────────

/** The DayRail store-action subset `storeStagingWriters` adapts — a
 *  structural type so this module needs no import of the store.
 *  `useStore.getState()` satisfies it. */
export interface StoreStagingActions {
  openEditSession(surface: string): Promise<{ id: string }>;
  closeEditSession(sessionId: string): Promise<void>;
  createLine(line: Line, sessionId?: string): Promise<void>;
  createRail(rail: Rail, sessionId?: string, effectiveFrom?: string): Promise<void>;
  upsertHabitBinding(
    opts: { id?: string; habitId: string; railId: string; weekdays?: number[]; effectiveFrom?: string },
    sessionId?: string,
  ): Promise<string>;
  createTask(task: Task, sessionId?: string): Promise<void>;
  addTaskOccurrence(
    taskId: string,
    partial?: { label?: string; percent?: number },
    sessionId?: string,
  ): Promise<string>;
  scheduleTaskToRail(
    taskId: string,
    slot: { cycleId: string; date: string; railId: string },
    sessionId?: string,
  ): Promise<void>;
}

/** Bind `commitDraft`'s writers to the live store. The app calls
 *  `commitDraft(draft, storeStagingWriters(useStore.getState()))`. */
export function storeStagingWriters(a: StoreStagingActions): StagingWriters {
  return {
    openSession: (surface) => a.openEditSession(surface),
    closeSession: (sessionId) => a.closeEditSession(sessionId),
    createLine: (line, sessionId) => a.createLine(line, sessionId),
    createRail: (rail, sessionId, effectiveFrom) => a.createRail(rail, sessionId, effectiveFrom),
    bindHabit: (opts, sessionId) => a.upsertHabitBinding(opts, sessionId).then(() => undefined),
    createTask: (task, sessionId) => a.createTask(task, sessionId),
    addOccurrence: (taskId, occ, sessionId) =>
      a.addTaskOccurrence(taskId, occ, sessionId).then(() => undefined),
    scheduleTask: (taskId, slot, sessionId) => a.scheduleTaskToRail(taskId, slot, sessionId),
  };
}
