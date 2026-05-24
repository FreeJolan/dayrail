// AI intent decomposition → staging-tray model (ERD §6.7).
//
// A natural-language intent (from the paste path's internal AI, or from
// Claude Code via MCP) is normalized into an `IntentSpec` — what / when /
// how often — decoupled from DayRail entities. `projectIntent` is a PURE
// function turning (IntentSpec, shape) into a `ProjectedPlan`: a set of
// concrete, ADD-ONLY entities the commit engine later writes inside one
// Edit Session (ERD §6.7.4). Switching shape is a deterministic
// re-projection of the same spec — it never re-calls the AI (§6.7.2).
//
// Scope note: this first slice implements the `habit` and `task` shapes
// (the canonical meditation example projects as a habit; the same spec
// re-projects to an Inbox task). The `adhoc` shape from §6.7.2 — one-off
// items scheduled to specific dates — lands in a follow-up.

import {
  INBOX_LINE_ID,
  type HabitBinding,
  type Line,
  type Rail,
  type RailColor,
  type Task,
  type TaskOccurrence,
  type TemplateKey,
} from './types';

/** A time-of-day the intent occupies. */
export interface IntentTime {
  /** Minutes from local midnight (07:00 = 420). */
  startMinutes: number;
  /** Time-block length. Falls back to the spec's
   *  `perOccurrenceDurationMinutes`, then `DEFAULT_BLOCK_MINUTES`. */
  durationMinutes?: number;
  /** Sub-label for this slot, e.g. "晨间" / "晚间". */
  label?: string;
  /** 0=Sun..6=Sat weekday filter. Undefined = every active day. */
  weekdays?: number[];
}

export type IntentFrequency = 'once' | 'daily' | 'weekly';

/** ERD §6.7.2. Normalized intent, decoupled from DayRail entities. This
 *  is the small, closed schema the AI is responsible for producing
 *  (paste path: `generateObject` + Zod; MCP path: structured tool args).
 *  Everything about "which entities to create" lives in the projector,
 *  not here — so the AI's output stays minimal and stable. */
export interface IntentSpec {
  title: string;
  note?: string;
  /** Per-occurrence activity length; distinct from a block's duration
   *  ("meditate 5 min" inside an "07:00 block"). */
  perOccurrenceDurationMinutes?: number;
  /** Times of day this intent occupies. Empty = an unscheduled task. */
  times: IntentTime[];
  frequency: IntentFrequency;
  /** Specific dates (ISO YYYY-MM-DD) for bounded / one-off intents. */
  dates?: string[];
  /** Preferred rail / line color; projector picks a default when unset. */
  color?: RailColor;
}

/** ERD §6.7.2: which entity graph the same intent projects into. */
export type ProposalShape = 'habit' | 'task';

/** Block length used when neither the time nor the spec specifies one. */
export const DEFAULT_BLOCK_MINUTES = 30;
const DEFAULT_COLOR: RailColor = 'teal';
const DEFAULT_TEMPLATE_KEY: TemplateKey = 'workday';

/** Concrete, add-only entities to create, in commit order. Ids are
 *  already minted (via the injected `genId`) so intra-plan references —
 *  a binding pointing at the just-minted habit line + rail — are wired
 *  up front; the commit engine just hands these to the store writers. */
export interface ProjectedPlan {
  shape: ProposalShape;
  /** kind='habit' Line, present when the shape projects a habit. */
  line?: Line;
  rails: Rail[];
  /** Bindings reference `line.id` / `rails[i].id` minted above. */
  bindings: Array<Pick<HabitBinding, 'habitId' | 'railId' | 'weekdays'>>;
  /** Present when the shape projects a task. */
  task?: Task;
  /** Discrete-step occurrences under `task` (ERD §10.6). */
  occurrences: Array<Pick<TaskOccurrence, 'label' | 'percent'>>;
  /** Human-readable preview lines for the review surface (§6.7). */
  summary: string[];
}

export interface ProjectOptions {
  /** Id minter; injectable for deterministic tests. Defaults to the
   *  store's timestamp+random ULID-lite scheme. */
  genId?: (prefix: string) => string;
  /** Wall clock for `createdAt` (epoch ms); injectable for tests. */
  now?: number;
}

function defaultGenId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function fmtBlock(startMinutes: number, durationMinutes: number): string {
  return `${fmtMinutes(startMinutes)}–${fmtMinutes(startMinutes + durationMinutes)}`;
}

/** ERD §6.7.2. Pure projection of a normalized intent + chosen shape into
 *  a set of add-only entities. Deterministic given the same `genId`;
 *  re-running with a different `shape` is how the review surface lets the
 *  user switch "habit ↔ task" without re-calling the AI. */
export function projectIntent(
  intent: IntentSpec,
  shape: ProposalShape,
  opts: ProjectOptions = {},
): ProjectedPlan {
  const genId = opts.genId ?? defaultGenId;
  const now = opts.now ?? Date.now();
  if (shape === 'habit') {
    return projectHabit(intent, genId, now);
  }
  return projectTask(intent, genId);
}

function projectHabit(
  intent: IntentSpec,
  genId: (prefix: string) => string,
  now: number,
): ProjectedPlan {
  const color = intent.color ?? DEFAULT_COLOR;
  const line: Line = {
    id: genId('line'),
    name: intent.title,
    kind: 'habit',
    status: 'active',
    color,
    createdAt: now,
    ...(intent.note ? { note: intent.note } : {}),
  };

  const rails: Rail[] = [];
  const bindings: ProjectedPlan['bindings'] = [];
  const summary: string[] = [`新建习惯「${intent.title}」`];

  for (const t of intent.times) {
    const duration =
      t.durationMinutes ?? intent.perOccurrenceDurationMinutes ?? DEFAULT_BLOCK_MINUTES;
    const rail: Rail = {
      id: genId('rail'),
      templateKey: DEFAULT_TEMPLATE_KEY,
      name: intent.title,
      startMinutes: t.startMinutes,
      durationMinutes: duration,
      color,
      showInCheckin: true,
      ...(t.label ? { subtitle: t.label } : {}),
    };
    rails.push(rail);
    bindings.push({
      habitId: line.id,
      railId: rail.id,
      ...(t.weekdays ? { weekdays: t.weekdays } : {}),
    });
    const labelPart = t.label ? `${t.label} ` : '';
    summary.push(`${labelPart}${fmtBlock(t.startMinutes, duration)} ${intent.title}`);
  }

  return { shape: 'habit', line, rails, bindings, occurrences: [], summary };
}

function projectTask(intent: IntentSpec, genId: (prefix: string) => string): ProjectedPlan {
  const task: Task = {
    id: genId('task'),
    lineId: INBOX_LINE_ID,
    title: intent.title,
    order: 0,
    status: 'pending',
    ...(intent.note ? { note: intent.note } : {}),
  };
  // Each *named* time becomes a discrete-step occurrence; an unnamed or
  // empty time list leaves the task as a single unscheduled item.
  const occurrences: ProjectedPlan['occurrences'] = intent.times
    .filter((t) => t.label)
    .map((t) => ({ label: t.label }));

  const summary = [`新建任务「${intent.title}」`];
  if (occurrences.length > 0) {
    summary.push(`含 ${occurrences.length} 个切分步骤`);
  }

  return { shape: 'task', task, rails: [], bindings: [], occurrences, summary };
}

// ── Commit engine (ERD §6.7.4) ──────────────────────────────────────
//
// `commitPlan` is the deterministic, ADD-ONLY commit: it opens ONE Edit
// Session and rides every write on that session's id, so a single
// `undoEditSession` rolls back the whole bundle (the post-confirm "Undo"
// toast). It only ever creates — never updates or deletes (§6.7.4). The
// `StagingWriters` seam keeps this unit-testable without a live Y.Doc:
// tests pass mock writers; the app passes `storeStagingWriters(...)`.

/** The minimal write surface `commitPlan` drives. Each call rides the
 *  Edit Session's `sessionId` so the batch undoes as one. */
export interface StagingWriters {
  openSession(surface: string): Promise<{ id: string }>;
  closeSession(sessionId: string): Promise<void>;
  createLine(line: Line, sessionId: string): Promise<void>;
  createRail(rail: Rail, sessionId: string): Promise<void>;
  bindHabit(
    opts: { habitId: string; railId: string; weekdays?: number[] },
    sessionId: string,
  ): Promise<void>;
  createTask(task: Task, sessionId: string): Promise<void>;
  addOccurrence(
    taskId: string,
    occ: { label?: string; percent?: number },
    sessionId: string,
  ): Promise<void>;
}

/** ERD §6.7.4. Apply a projected plan as one Edit Session. Writes in
 *  dependency order (line → rails → bindings, or task → occurrences) so
 *  intra-plan references resolve, and returns the `sessionId` so the UI
 *  can offer a one-click undo of the whole bundle. Add-only: no writer
 *  here updates or deletes. */
export async function commitPlan(plan: ProjectedPlan, w: StagingWriters): Promise<string> {
  const { id: sessionId } = await w.openSession('staging-commit');

  if (plan.line) {
    await w.createLine(plan.line, sessionId);
  }
  for (const rail of plan.rails) {
    await w.createRail(rail, sessionId);
  }
  for (const b of plan.bindings) {
    await w.bindHabit(
      { habitId: b.habitId, railId: b.railId, ...(b.weekdays ? { weekdays: b.weekdays } : {}) },
      sessionId,
    );
  }
  if (plan.task) {
    await w.createTask(plan.task, sessionId);
    for (const occ of plan.occurrences) {
      await w.addOccurrence(
        plan.task.id,
        {
          ...(occ.label !== undefined ? { label: occ.label } : {}),
          ...(occ.percent !== undefined ? { percent: occ.percent } : {}),
        },
        sessionId,
      );
    }
  }

  await w.closeSession(sessionId);
  return sessionId;
}

/** The DayRail store-action subset `storeStagingWriters` adapts — a
 *  structural type so this module needs no import of the store itself.
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
}

/** Bind `commitPlan`'s writers to the live store. The app calls
 *  `commitPlan(plan, storeStagingWriters(useStore.getState()))`. */
export function storeStagingWriters(a: StoreStagingActions): StagingWriters {
  return {
    openSession: (surface) => a.openEditSession(surface),
    closeSession: (sessionId) => a.closeEditSession(sessionId),
    createLine: (line, sessionId) => a.createLine(line, sessionId),
    createRail: (rail, sessionId) => a.createRail(rail, sessionId),
    bindHabit: (opts, sessionId) => a.upsertHabitBinding(opts, sessionId).then(() => undefined),
    createTask: (task, sessionId) => a.createTask(task, sessionId),
    addOccurrence: (taskId, occ, sessionId) =>
      a.addTaskOccurrence(taskId, occ, sessionId).then(() => undefined),
  };
}
