import type {
  AdhocEvent,
  ExpectedWindow,
  ExpectedWindowPrecision,
  Line,
  Task,
  TaskOccurrence,
} from './types';
import { deriveTaskStatus, isOccurrenceManaged } from './types';
import { selectOccurrencesForTask, type DayRailState } from './store';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface EffectiveExpectedWindow {
  window: ExpectedWindow;
  source: 'task' | 'project';
  ownerId: string;
  inherited: boolean;
}

export type ExpectedCycleRelation = 'current' | 'before' | 'after' | 'none';

export type AttentionSchedule =
  | {
      kind: 'slot';
      rowId: string;
      taskId: string;
      occurrenceId?: string;
      railId: string;
      scheduledDate: string;
      lateDays: number;
    }
  | {
      kind: 'adhoc';
      rowId: string;
      taskId: string;
      adhocId: string;
      scheduledDate: string;
      lateDays: number;
    };

export interface AttentionContributor {
  taskId: string;
  occurrenceId?: string;
  schedule?: AttentionSchedule;
}

export interface AttentionIssue {
  subjectType: 'project' | 'task';
  subjectId: string;
  expectedEnd: string;
  overdueDays?: number;
  contributors: AttentionContributor[];
  lateSchedules: AttentionSchedule[];
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(year!, month! - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month! - 1 &&
    d.getDate() === day
  );
}

export function normalizeExpectedWindow(
  value: unknown,
): ExpectedWindow | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ExpectedWindow>;
  if (!isIsoDate(raw.startDate) || !isIsoDate(raw.endDate)) return null;
  if (raw.startDate > raw.endDate) return null;
  const precision: ExpectedWindowPrecision =
    raw.precision === 'day' ||
    raw.precision === 'week' ||
    raw.precision === 'month' ||
    raw.precision === 'range'
      ? raw.precision
      : raw.startDate === raw.endDate
        ? 'day'
        : 'range';
  if (precision === 'day' && raw.startDate !== raw.endDate) return null;
  return { startDate: raw.startDate, endDate: raw.endDate, precision };
}

export function projectExpectedWindow(line: Line | undefined): ExpectedWindow | null {
  if (!line || line.kind !== 'project') return null;
  if (!isIsoDate(line.plannedStart) || !isIsoDate(line.plannedEnd)) return null;
  return normalizeExpectedWindow({
    startDate: line.plannedStart,
    endDate: line.plannedEnd,
    precision:
      line.plannedPrecision ??
      (line.plannedStart === line.plannedEnd ? 'day' : 'range'),
  });
}

export function effectiveExpectedWindow(
  task: Task,
  lines: Record<string, Line>,
): EffectiveExpectedWindow | null {
  const own = normalizeExpectedWindow(task.expectedWindow);
  if (own) {
    return {
      window: own,
      source: 'task',
      ownerId: task.id,
      inherited: false,
    };
  }
  const project = lines[task.lineId];
  const inherited = projectExpectedWindow(project);
  if (!inherited || !project) return null;
  return {
    window: inherited,
    source: 'project',
    ownerId: project.id,
    inherited: true,
  };
}

export function expectedCycleRelation(
  value: ExpectedWindow | null,
  cycleStart: string,
  cycleEnd: string,
): ExpectedCycleRelation {
  if (!value || !isIsoDate(cycleStart) || !isIsoDate(cycleEnd)) return 'none';
  if (value.startDate <= cycleEnd && value.endDate >= cycleStart) return 'current';
  if (value.endDate < cycleStart) return 'before';
  return 'after';
}

export function daysBetween(earlier: string, later: string): number {
  if (!isIsoDate(earlier) || !isIsoDate(later)) return 0;
  const [ey, em, ed] = earlier.split('-').map(Number);
  const [ly, lm, ld] = later.split('-').map(Number);
  return Math.max(
    0,
    Math.round(
      (Date.UTC(ly!, lm! - 1, ld!) - Date.UTC(ey!, em! - 1, ed!)) /
        86_400_000,
    ),
  );
}

function activeTaskAdhoc(
  adhocs: Record<string, AdhocEvent>,
  taskId: string,
): AdhocEvent | undefined {
  return Object.values(adhocs).find(
    (event) => event.taskId === taskId && event.status === 'active',
  );
}

function lateSlot(
  task: Task,
  occurrence: TaskOccurrence | undefined,
  expectedEnd: string,
): AttentionSchedule | null {
  const slot = occurrence?.slot ?? task.slot;
  if (!slot || slot.date <= expectedEnd) return null;
  return {
    kind: 'slot',
    rowId: occurrence?.id ?? task.id,
    taskId: task.id,
    ...(occurrence && { occurrenceId: occurrence.id }),
    railId: slot.railId,
    scheduledDate: slot.date,
    lateDays: daysBetween(expectedEnd, slot.date),
  };
}

function lateAdhoc(
  task: Task,
  adhoc: AdhocEvent | undefined,
  expectedEnd: string,
): AttentionSchedule | null {
  if (!adhoc || adhoc.date <= expectedEnd) return null;
  return {
    kind: 'adhoc',
    rowId: adhoc.id,
    taskId: task.id,
    adhocId: adhoc.id,
    scheduledDate: adhoc.date,
    lateDays: daysBetween(expectedEnd, adhoc.date),
  };
}

/** Derive unresolved expectation problems without writing to the Y.Doc.
 *  Inherited Project windows aggregate child contributors under one
 *  Project issue; Task-owned windows aggregate under the Task. */
export function selectAttentionIssues(
  state: Pick<
    DayRailState,
    'lines' | 'tasks' | 'taskOccurrences' | 'adhocEvents'
  >,
  today: string,
): AttentionIssue[] {
  const bySubject = new Map<string, AttentionIssue>();
  const ensureIssue = (
    effective: EffectiveExpectedWindow,
  ): AttentionIssue => {
    const subjectType = effective.source === 'project' ? 'project' : 'task';
    const key = `${subjectType}:${effective.ownerId}`;
    let issue = bySubject.get(key);
    if (!issue) {
      const overdue = today > effective.window.endDate;
      issue = {
        subjectType,
        subjectId: effective.ownerId,
        expectedEnd: effective.window.endDate,
        ...(overdue && {
          overdueDays: daysBetween(effective.window.endDate, today),
        }),
        contributors: [],
        lateSchedules: [],
      };
      bySubject.set(key, issue);
    }
    return issue;
  };

  for (const task of Object.values(state.tasks)) {
    const occurrences = selectOccurrencesForTask(state, task.id);
    const status = deriveTaskStatus(task, occurrences);
    if (status === 'done' || status === 'archived' || status === 'deleted') {
      continue;
    }
    const effective = effectiveExpectedWindow(task, state.lines);
    if (!effective) continue;
    const issue = ensureIssue(effective);
    const adhoc = activeTaskAdhoc(state.adhocEvents, task.id);

    if (isOccurrenceManaged(occurrences)) {
      for (const occurrence of occurrences) {
        if (occurrence.status !== 'pending') continue;
        const schedule = lateSlot(task, occurrence, effective.window.endDate);
        issue.contributors.push({
          taskId: task.id,
          occurrenceId: occurrence.id,
          ...(schedule && { schedule }),
        });
        if (schedule) issue.lateSchedules.push(schedule);
      }
      const adhocSchedule = lateAdhoc(task, adhoc, effective.window.endDate);
      if (adhoc) {
        issue.contributors.push({
          taskId: task.id,
          ...(adhocSchedule && { schedule: adhocSchedule }),
        });
      }
      if (adhocSchedule) issue.lateSchedules.push(adhocSchedule);
    } else {
      const adhocSchedule = lateAdhoc(task, adhoc, effective.window.endDate);
      const slotSchedule = adhoc
        ? null
        : lateSlot(task, undefined, effective.window.endDate);
      const schedule = adhocSchedule ?? slotSchedule;
      issue.contributors.push({ taskId: task.id, ...(schedule && { schedule }) });
      if (schedule) issue.lateSchedules.push(schedule);
    }
  }

  // An active, explicitly planned Project with no Tasks is still an
  // actionable "needs structuring" subject once its window is due.
  for (const line of Object.values(state.lines)) {
    if (line.kind !== 'project' || line.status !== 'active') continue;
    if (Object.values(state.tasks).some((task) => task.lineId === line.id)) continue;
    const window = projectExpectedWindow(line);
    if (!window || today <= window.endDate) continue;
    const key = `project:${line.id}`;
    if (!bySubject.has(key)) {
      bySubject.set(key, {
        subjectType: 'project',
        subjectId: line.id,
        expectedEnd: window.endDate,
        overdueDays: daysBetween(window.endDate, today),
        contributors: [],
        lateSchedules: [],
      });
    }
  }

  return [...bySubject.values()]
    .filter((issue) => issue.overdueDays != null || issue.lateSchedules.length > 0)
    .sort((a, b) => {
      const aOverdue = a.overdueDays != null;
      const bOverdue = b.overdueDays != null;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      if (aOverdue && bOverdue && a.overdueDays !== b.overdueDays) {
        return b.overdueDays! - a.overdueDays!;
      }
      return a.expectedEnd.localeCompare(b.expectedEnd);
    });
}

export function formatExpectedWindow(window: ExpectedWindow): string {
  const [sy, sm, sd] = window.startDate.split('-').map(Number);
  const [ey, em, ed] = window.endDate.split('-').map(Number);
  if (window.precision === 'month' && sy === ey && sm === em) {
    return `${sy}年${sm}月`;
  }
  if (window.precision === 'day') return `${sm}月${sd}日`;
  if (sy !== ey) return `${sy}年${sm}月${sd}日–${ey}年${em}月${ed}日`;
  if (sm === em) return `${sm}月${sd}日–${ed}日`;
  return `${sm}月${sd}日–${em}月${ed}日`;
}
