import { isAutoTask, selectAutoTaskCandidates } from './autoTask';
import { railAtDate } from './revisions';
import { selectOccurrencesForTask, type DayRailState } from './store';
import { deriveTaskStatus, isOccurrenceManaged } from './types';
import type { AdhocEvent, Task, TaskOccurrence } from './types';

export type CalendarAgendaStatus =
  | 'pending'
  | 'in-progress'
  | 'deferred'
  | 'done'
  | 'archived'
  | 'event';

export type CalendarAgendaKind =
  | 'task'
  | 'occurrence'
  | 'habit'
  | 'task-adhoc'
  | 'adhoc';

export interface CalendarAgendaItem {
  id: string;
  kind: CalendarAgendaKind;
  date: string;
  title: string;
  parentTitle?: string;
  taskId?: string;
  occurrenceId?: string;
  adhocId?: string;
  lineId?: string;
  railId?: string;
  railName?: string;
  startMinutes: number | null;
  durationMinutes: number | null;
  slotOrder?: number;
  status: CalendarAgendaStatus;
  virtual?: boolean;
}

export interface CalendarAgendaOptions {
  startDate: string;
  endDate: string;
  includeTasks: boolean;
  includeHabits: boolean;
}

type CalendarAgendaState = Pick<
  DayRailState,
  | 'lines'
  | 'tasks'
  | 'taskOccurrences'
  | 'adhocEvents'
  | 'templates'
  | 'calendarRules'
  | 'calendarRuleRevisions'
  | 'calendarRuleTombstones'
  | 'habitBindings'
  | 'habitBindingRevisions'
  | 'habitBindingTombstones'
  | 'rails'
  | 'railRevisions'
  | 'railTombstones'
  | 'userDayNotes'
  | 'userProfile'
>;

function calendarStatus(status: Task['status']): CalendarAgendaStatus {
  return status === 'deleted' ? 'archived' : status;
}

function slotTime(
  state: Pick<DayRailState, 'railRevisions' | 'railTombstones'>,
  date: string,
  railId: string,
): { startMinutes: number | null; durationMinutes: number | null; railName?: string } {
  const revision = railAtDate(state, railId, date);
  if (!revision) return { startMinutes: null, durationMinutes: null };
  return {
    startMinutes: revision.startMinutes,
    durationMinutes: revision.durationMinutes,
    railName: revision.name,
  };
}

function occurrenceAgendaItem(
  state: CalendarAgendaState,
  task: Task,
  occurrence: TaskOccurrence,
): CalendarAgendaItem | null {
  if (!occurrence.slot) return null;
  const time = slotTime(
    state,
    occurrence.slot.date,
    occurrence.slot.railId,
  );
  const label = occurrence.label?.trim();
  return {
    id: `occurrence:${occurrence.id}`,
    kind: 'occurrence',
    date: occurrence.slot.date,
    title: label || task.title,
    ...(label && label !== task.title && { parentTitle: task.title }),
    taskId: task.id,
    occurrenceId: occurrence.id,
    lineId: task.lineId,
    railId: occurrence.slot.railId,
    ...(time.railName && { railName: time.railName }),
    startMinutes: time.startMinutes,
    durationMinutes: time.durationMinutes,
    ...(occurrence.slotOrder != null && { slotOrder: occurrence.slotOrder }),
    status: occurrence.status,
  };
}

function taskSlotAgendaItem(
  state: CalendarAgendaState,
  task: Task,
): CalendarAgendaItem | null {
  if (!task.slot) return null;
  const time = slotTime(state, task.slot.date, task.slot.railId);
  return {
    id: `task:${task.id}`,
    kind: 'task',
    date: task.slot.date,
    title: task.title,
    taskId: task.id,
    lineId: task.lineId,
    railId: task.slot.railId,
    ...(time.railName && { railName: time.railName }),
    startMinutes: time.startMinutes,
    durationMinutes: time.durationMinutes,
    ...(task.slotOrder != null && { slotOrder: task.slotOrder }),
    status: calendarStatus(task.status),
  };
}

function adhocAgendaItem(
  event: AdhocEvent,
  task: Task | undefined,
  taskStatus: CalendarAgendaStatus | undefined,
): CalendarAgendaItem {
  return {
    id: event.taskId ? `task-adhoc:${event.id}` : `adhoc:${event.id}`,
    kind: event.taskId ? 'task-adhoc' : 'adhoc',
    date: event.date,
    title: task?.title ?? event.name,
    ...(task && { taskId: task.id, lineId: task.lineId }),
    adhocId: event.id,
    startMinutes: event.startMinutes,
    durationMinutes: event.durationMinutes,
    status: taskStatus ?? 'event',
  };
}

function habitFactKey(task: Task): string | null {
  if (!task.slot) return null;
  return `${task.lineId}|${task.slot.date}|${task.slot.railId}`;
}

function habitAgendaItem(
  state: CalendarAgendaState,
  task: Task,
  virtual: boolean,
): CalendarAgendaItem | null {
  if (!task.slot || task.status === 'deleted') return null;
  const time = slotTime(state, task.slot.date, task.slot.railId);
  return {
    id: `habit:${task.id}`,
    kind: 'habit',
    date: task.slot.date,
    title: task.title,
    taskId: task.id,
    lineId: task.lineId,
    railId: task.slot.railId,
    ...(time.railName && { railName: time.railName }),
    startMinutes: time.startMinutes,
    durationMinutes: time.durationMinutes,
    status: calendarStatus(task.status),
    ...(virtual && { virtual: true }),
  };
}

/** Read-only Calendar projection. It never invokes a store action or
 *  materializes Habit Tasks. ExternalEvents remain on their existing
 *  independent display path and are intentionally absent here. */
export function selectCalendarAgenda(
  state: CalendarAgendaState,
  options: CalendarAgendaOptions,
): CalendarAgendaItem[] {
  const out: CalendarAgendaItem[] = [];
  const inRange = (date: string) =>
    date >= options.startDate && date <= options.endDate;

  const activeAdhocByTask = new Map<string, AdhocEvent>();
  for (const event of Object.values(state.adhocEvents)) {
    if (event.status !== 'active') continue;
    if (event.taskId) activeAdhocByTask.set(event.taskId, event);
    if (!event.taskId && inRange(event.date)) {
      out.push(adhocAgendaItem(event, undefined, undefined));
    }
  }

  if (options.includeTasks) {
    for (const task of Object.values(state.tasks)) {
      if (isAutoTask(task) || task.status === 'deleted') continue;
      const occurrences = selectOccurrencesForTask(state, task.id);
      const derivedStatus = deriveTaskStatus(task, occurrences);
      const taskAdhoc = activeAdhocByTask.get(task.id);

      if (isOccurrenceManaged(occurrences)) {
        for (const occurrence of occurrences) {
          if (!occurrence.slot || !inRange(occurrence.slot.date)) continue;
          const item = occurrenceAgendaItem(state, task, occurrence);
          if (item) out.push(item);
        }
        if (taskAdhoc && inRange(taskAdhoc.date)) {
          out.push(adhocAgendaItem(taskAdhoc, task, calendarStatus(derivedStatus)));
        }
        continue;
      }

      if (taskAdhoc && inRange(taskAdhoc.date)) {
        out.push(adhocAgendaItem(taskAdhoc, task, calendarStatus(derivedStatus)));
      } else if (task.slot && inRange(task.slot.date)) {
        const item = taskSlotAgendaItem(state, task);
        if (item) out.push(item);
      }
    }
  }

  if (options.includeHabits) {
    const facts = new Map<string, Task>();
    for (const task of Object.values(state.tasks)) {
      if (!isAutoTask(task) || !task.slot || task.status === 'deleted') continue;
      if (!inRange(task.slot.date)) continue;
      const key = habitFactKey(task);
      if (key) facts.set(key, task);
    }
    const candidates = selectAutoTaskCandidates(
      state,
      { startDate: options.startDate, endDate: options.endDate },
    );
    const merged = new Map<string, { task: Task; virtual: boolean }>();
    for (const candidate of candidates) {
      const key = habitFactKey(candidate);
      if (key) merged.set(key, { task: candidate, virtual: true });
    }
    for (const [key, fact] of facts) merged.set(key, { task: fact, virtual: false });
    for (const { task, virtual } of merged.values()) {
      const item = habitAgendaItem(state, task, virtual);
      if (item) out.push(item);
    }
  }

  const kindRank: Record<CalendarAgendaKind, number> = {
    task: 0,
    occurrence: 0,
    habit: 0,
    'task-adhoc': 0,
    adhoc: 1,
  };
  out.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const at = a.startMinutes ?? Number.POSITIVE_INFINITY;
    const bt = b.startMinutes ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    const byKind = kindRank[a.kind] - kindRank[b.kind];
    if (byKind !== 0) return byKind;
    const ao = a.slotOrder ?? Number.POSITIVE_INFINITY;
    const bo = b.slotOrder ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.id.localeCompare(b.id);
  });
  return out;
}
