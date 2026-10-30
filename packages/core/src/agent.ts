// Domain primitives shared by the desktop bridge and future adapters.
import { z } from 'zod';
import {
  getYDoc,
  flushPersistence,
  pickDayTemplate,
  useStore,
  type DayRailState,
} from './store';
import {
  INBOX_LINE_ID,
  deriveTaskStatus,
  isOccurrenceManaged,
  type Rail,
  type Line,
  type Task,
} from './types';
import { isIsoDate } from './expectedWindow';
import { cycleIdOf } from './autoTask';
import { railAtDate, railsActiveOn, habitBindingsActiveOn } from './revisions';
import { selectCalendarAgenda } from './calendarAgenda';
import { selectExternalEventsOn } from './externalEvents';

const id = z.string().trim().min(1).max(200);
const date = z.string().refine(isIsoDate, 'Expected a valid YYYY-MM-DD date');
const text = z.string().trim().min(1).max(2000);
const minute = z.number().int().min(0).max(1439);
const duration = z.number().int().min(1).max(1440);
const color = z.enum([
  'sand',
  'sage',
  'slate',
  'brown',
  'amber',
  'teal',
  'pink',
  'grass',
  'indigo',
  'plum',
]);
const weekdays = z.array(z.number().int().min(0).max(6)).max(7);
const priority = z.enum(['P0', 'P1', 'P2']);
const empty = z.strictObject({});
const byId = z.strictObject({ id });
const effective = { effectiveFrom: date.optional() };
const session = { sessionId: id.optional() };
const windowSchema = z
  .strictObject({
    startDate: date,
    endDate: date,
    precision: z.enum(['day', 'week', 'month', 'range']),
  })
  .refine(
    (v) =>
      v.startDate <= v.endDate &&
      (v.precision !== 'day' || v.startDate === v.endDate),
    'Invalid expected window',
  );
const range = z
  .strictObject({ from: date, to: date })
  .refine((v) => v.from <= v.to, 'from must not follow to')
  .refine(
    (v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 366,
    'Query at most 367 days at a time',
  );

export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export interface AgentRequest {
  id: string;
  method: string;
  params?: unknown;
  ifRevision?: string;
  expiresAt?: number;
}
export interface AgentResponse {
  ok: boolean;
  revision: string;
  runtimeId: string;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
}
export interface AgentOptions {
  persist?: () => Promise<void>;
  confirmDelete?: (label: string, explanation: string) => Promise<boolean>;
}
interface Command {
  description: string;
  schema: z.ZodType;
  write: boolean;
  run: (params: unknown) => Promise<unknown> | unknown;
}
const collections = {
  line: 'lines',
  task: 'tasks',
  occurrence: 'taskOccurrences',
  rail: 'rails',
  template: 'templates',
  binding: 'habitBindings',
  rule: 'calendarRules',
  cycle: 'cycles',
  phase: 'habitPhases',
  reflection: 'reflections',
  note: 'userDayNotes',
  signal: 'signals',
  shift: 'shifts',
  event: 'adhocEvents',
} as const;
type Resource = keyof typeof collections;
const state = () => useStore.getState();
function entity(resource: Resource, entityId: string): Record<string, unknown> {
  const map = state()[collections[resource]] as Record<string, unknown>;
  const found = Object.hasOwn(map, entityId) ? map[entityId] : undefined;
  if (!found)
    throw new AgentError('NOT_FOUND', `${resource} ${entityId} does not exist`);
  return found as Record<string, unknown>;
}
function activeTask(taskId: string): Task {
  const task = entity('task', taskId) as unknown as Task;
  if (task.status === 'deleted' || task.status === 'archived')
    throw new AgentError(
      'INVALID_STATE',
      'Restore the task before modifying it',
    );
  return task;
}
function editableLine(lineId: string): Line {
  const line = entity('line', lineId) as unknown as Line;
  if (line.isDefault)
    throw new AgentError(
      'INVALID_STATE',
      'The built-in Inbox cannot be modified',
    );
  return line;
}
function taskOccurrences(taskId: string) {
  return Object.values(state().taskOccurrences).filter(
    (o) => o.taskId === taskId,
  );
}
function slot(railId: string, day: string) {
  const s = state();
  const rail = railAtDate(s, railId, day);
  if (!rail)
    throw new AgentError(
      'INVALID_REFERENCE',
      'Rail does not exist on that date',
    );
  const template = { templateKey: pickDayTemplate(s, day) };
  if (rail.templateKey !== template.templateKey)
    throw new AgentError(
      'INVALID_REFERENCE',
      "Rail does not belong to the date's resolved template",
      { templateKey: template.templateKey },
    );
  return { railId, date: day, cycleId: cycleIdOf(day) };
}
function profile() {
  const p = state().userProfile;
  return {
    background: p?.background ?? '',
    enabledHolidayRegions: p?.enabledHolidayRegions ?? [],
    calendarRuleOrder: p?.calendarRuleOrder ?? [],
  };
}
function snapshot() {
  const s = state();
  const keys: (keyof DayRailState)[] = [
    ...Object.values(collections),
    'railRevisions',
    'templateRevisions',
    'calendarRuleRevisions',
    'habitBindingRevisions',
    'railTombstones',
    'templateTombstones',
    'calendarRuleTombstones',
    'habitBindingTombstones',
  ];
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    state: {
      ...Object.fromEntries(keys.map((key) => [key, s[key]])),
      userProfile: profile(),
    },
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function patchValues<T extends Record<string, unknown>>(
  patch: T,
): { [K in keyof T]: Exclude<T[K], null> | undefined } {
  return Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v]),
  ) as { [K in keyof T]: Exclude<T[K], null> | undefined };
}

/** One dispatcher belongs to one hydrated app runtime, never to a separate CLI copy of the store. */
export function createAgentDispatcher(options: AgentOptions = {}) {
  const runtimeId = crypto.randomUUID();
  let sequence = 0;
  let active = true;
  let currentDeadline: number | undefined;
  const doc = getYDoc();
  const onUpdate = () => {
    sequence++;
  };
  doc.on('update', onUpdate);
  const revision = () => `${runtimeId}:${sequence}`;
  const commands: Record<string, Command> = Object.create(null);
  function define<S extends z.ZodType>(
    method: string,
    description: string,
    schema: S,
    write: boolean,
    run: (p: z.infer<S>) => unknown,
  ) {
    commands[method] = {
      description,
      schema,
      write,
      run: (p) => run(p as z.infer<S>),
    };
  }
  async function confirm(
    label: string,
    explanation = '删除后可在回收站恢复。',
  ) {
    if (!options.confirmDelete)
      throw new AgentError(
        'CONFIRMATION_REQUIRED',
        'Delete must be confirmed inside DayRail',
      );
    const before = revision();
    if (!(await options.confirmDelete(label, explanation)))
      throw new AgentError('CANCELLED', 'Deletion was cancelled');
    if (!active)
      throw new AgentError('NOT_READY', 'Local agent access was stopped');
    if (currentDeadline && Date.now() >= currentDeadline)
      throw new AgentError('EXPIRED', 'The request expired during confirmation');
    if (before !== revision())
      throw new AgentError(
        'REVISION_CONFLICT',
        'Data changed while awaiting confirmation; inspect and retry',
      );
  }

  define(
    'system.status',
    'Read the live app status and counts; no credentials.',
    empty,
    false,
    () => ({
      ready: state().ready,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      counts: Object.fromEntries(
        Object.entries(collections).map(([name, key]) => [
          name,
          Object.keys(state()[key]).length,
        ]),
      ),
    }),
  );
  define(
    'system.describe',
    'Discover domain commands, JSON schemas, and write flags.',
    z.strictObject({ method: z.string().optional() }),
    false,
    (p) => {
      if (
        p.method &&
        !Object.keys(commands).some(
          (name) => name === p.method || name.startsWith(`${p.method}.`),
        )
      )
        throw new AgentError('UNKNOWN_METHOD', `Unknown command ${p.method}`);
      return Object.fromEntries(
        Object.entries(commands)
          .filter(
            ([name]) =>
              !p.method || name === p.method || name.startsWith(`${p.method}.`),
          )
          .map(([name, c]) => [
            name,
            {
              description: c.description,
              write: c.write,
              inputSchema: z.toJSONSchema(c.schema),
            },
          ]),
      );
    },
  );
  define(
    'data.export',
    'Export all business data, history, archived and deleted rows. Excludes credentials and runtime state.',
    empty,
    false,
    snapshot,
  );
  define(
    'profile.get',
    'Read personal background, holiday regions and calendar-rule order.',
    empty,
    false,
    profile,
  );
  define(
    'profile.update',
    'Update personal background or enabled holiday regions.',
    z.strictObject({
      background: z.string().optional(),
      enabledHolidayRegions: z.array(id).optional(),
    }),
    true,
    async (p) => {
      if (p.background !== undefined)
        await state().setUserBackground(p.background);
      if (p.enabledHolidayRegions !== undefined)
        await state().setEnabledHolidayRegions(p.enabledHolidayRegions);
      return profile();
    },
  );

  for (const resource of Object.keys(collections) as Resource[]) {
    define(
      `${resource}.get`,
      `Read one ${resource}, including archived or deleted rows.`,
      byId,
      false,
      (p) => {
        const item = entity(resource, p.id);
        return resource === 'task'
          ? {
              ...item,
              effectiveStatus: deriveTaskStatus(
                item as unknown as Task,
                taskOccurrences(p.id),
              ),
            }
          : item;
      },
    );
    define(
      `${resource}.list`,
      `Read ${resource} rows. All statuses included by default; paginate with offset/limit.`,
      z.strictObject({
        status: z.string().optional(),
        lineId: id.optional(),
        taskId: id.optional(),
        templateKey: id.optional(),
        from: date.optional(),
        to: date.optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(1000).default(100),
      }),
      false,
      (p) => {
        const raw = Object.values(
          state()[collections[resource]],
        ) as unknown as Record<string, unknown>[];
        const rows =
          resource === 'task'
            ? raw.map((row) => ({
                ...row,
                effectiveStatus: deriveTaskStatus(
                  row as unknown as Task,
                  taskOccurrences(String(row.id)),
                ),
              }))
            : raw;
        const filtered = rows
          .filter(
            (row) =>
              (!p.status || (row.effectiveStatus ?? row.status) === p.status) &&
              (!p.lineId || row.lineId === p.lineId) &&
              (!p.taskId || row.taskId === p.taskId) &&
              (!p.templateKey || row.templateKey === p.templateKey) &&
              (!p.from || String(row.date ?? row.startDate ?? '') >= p.from) &&
              (!p.to || String(row.date ?? row.startDate ?? '') <= p.to),
          )
          .sort((a, b) =>
            String(a.id ?? a.key ?? a.date).localeCompare(
              String(b.id ?? b.key ?? b.date),
            ),
          );
        const next = p.offset + p.limit;
        return {
          items: filtered.slice(p.offset, next),
          total: filtered.length,
          nextOffset: next < filtered.length ? next : null,
        };
      },
    );
  }
  define(
    'rail.resolve',
    'Read date-effective Rails for the resolved day template.',
    z.strictObject({ date }),
    false,
    (p) => {
      const s = state();
      const day = { templateKey: pickDayTemplate(s, p.date) };
      return {
        ...day,
        rails: railsActiveOn(s, p.date).filter(
          (r) => r.revision.templateKey === day.templateKey,
        ),
      };
    },
  );
  define(
    'calendar.list',
    'Read deterministic date-resolved agenda, templates, bindings and external events.',
    range,
    false,
    (p) => {
      const s = state();
      const days = [];
      for (let day = p.from; day <= p.to; ) {
        days.push({
          date: day,
          ...{ templateKey: pickDayTemplate(s, day) },
          externalEvents: selectExternalEventsOn(day, {
            enabledHolidayRegions: s.userProfile?.enabledHolidayRegions ?? [],
            userDayNotes: s.userDayNotes,
          }),
          bindings: habitBindingsActiveOn(s, day),
        });
        const d = new Date(`${day}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        day = d.toISOString().slice(0, 10);
      }
      return {
        days,
        agenda: selectCalendarAgenda(s, {
          startDate: p.from,
          endDate: p.to,
          includeTasks: true,
          includeHabits: true,
        }),
      };
    },
  );

  define(
    'line.create',
    'Create a project, habit or group.',
    z.strictObject({
      name: text,
      kind: z.enum(['project', 'habit', 'group']).default('project'),
      color: color.optional(),
      note: z.string().optional(),
      ...session,
    }),
    true,
    async (p) => {
      const { sessionId, ...fields } = p;
      const line: Line = {
        ...fields,
        id: crypto.randomUUID(),
        status: 'active',
        createdAt: Date.now(),
      };
      await state().createLine(line, sessionId);
      return entity('line', line.id);
    },
  );
  const linePatch = z.strictObject({
    name: text.optional(),
    color: color.nullable().optional(),
    note: z.string().nullable().optional(),
    plannedStart: date.nullable().optional(),
    plannedEnd: date.nullable().optional(),
    plannedPrecision: z
      .enum(['day', 'week', 'month', 'range'])
      .nullable()
      .optional(),
  });
  define(
    'line.update',
    'Update project/habit metadata. Null clears an optional field.',
    z.strictObject({ id, patch: linePatch }),
    true,
    async (p) => {
      const line = editableLine(p.id);
      const next = { ...line, ...patchValues(p.patch) };
      if (
        next.plannedStart &&
        next.plannedEnd &&
        next.plannedStart > next.plannedEnd
      )
        throw new AgentError(
          'INVALID_INPUT',
          'plannedStart must not follow plannedEnd',
        );
      await state().updateLine(p.id, patchValues(p.patch));
      return entity('line', p.id);
    },
  );
  define(
    'line.delete',
    'Soft-delete a line after in-app confirmation.',
    byId,
    true,
    async (p) => {
      const line = editableLine(p.id);
      await confirm(line.name);
      await state().deleteLine(p.id);
      return entity('line', p.id);
    },
  );
  define(
    'line.restore',
    'Restore a soft-deleted or archived line.',
    byId,
    true,
    async (p) => {
      editableLine(p.id);
      await state().restoreLine(p.id);
      return entity('line', p.id);
    },
  );

  define(
    'task.create',
    'Create a task in an existing active project (Inbox by default).',
    z.strictObject({
      title: text,
      lineId: id.default(INBOX_LINE_ID),
      note: z.string().optional(),
      priority: priority.optional(),
      expectedWindow: windowSchema.optional(),
      ...session,
    }),
    true,
    async (p) => {
      const line = entity('line', p.lineId);
      if (line.status !== 'active' || line.kind !== 'project')
        throw new AgentError(
          'INVALID_REFERENCE',
          'Choose an active project for a manually-created task',
        );
      const { sessionId, ...fields } = p;
      const task: Task = {
        ...fields,
        id: crypto.randomUUID(),
        order: Date.now(),
        status: 'pending',
      };
      await state().createTask(task, sessionId);
      return entity('task', task.id);
    },
  );
  define(
    'task.update',
    'Update task metadata; use dedicated scheduling/status commands for state transitions.',
    z.strictObject({
      id,
      patch: z.strictObject({
        title: text.optional(),
        lineId: id.optional(),
        note: z.string().nullable().optional(),
        priority: priority.nullable().optional(),
        expectedWindow: windowSchema.nullable().optional(),
      }),
      ...session,
    }),
    true,
    async (p) => {
      activeTask(p.id);
      if (p.patch.lineId) {
        const line = entity('line', p.patch.lineId);
        if (line.status !== 'active' || line.kind !== 'project')
          throw new AgentError('INVALID_REFERENCE', 'Choose an active project');
      }
      await state().updateTask(p.id, patchValues(p.patch), p.sessionId);
      return entity('task', p.id);
    },
  );
  define(
    'task.schedule',
    'Schedule a whole task on a Rail. Tasks with occurrences must schedule the occurrences.',
    z.strictObject({ id, date, railId: id, ...session }),
    true,
    async (p) => {
      activeTask(p.id);
      await state().scheduleTaskToRail(
        p.id,
        slot(p.railId, p.date),
        p.sessionId,
      );
      return entity('task', p.id);
    },
  );
  define(
    'task.schedule-free',
    'Schedule a whole task in a free-time block.',
    z.strictObject({
      id,
      date,
      startMinutes: minute,
      durationMinutes: duration,
      ...session,
    }),
    true,
    async (p) => {
      activeTask(p.id);
      if (isOccurrenceManaged(taskOccurrences(p.id)))
        throw new AgentError(
          'INVALID_STATE',
          'Schedule individual occurrences on Rails',
        );
      const { id: taskId, sessionId, ...opts } = p;
      await state().scheduleTaskFreeTime(taskId, opts, sessionId);
      return entity('task', taskId);
    },
  );
  define(
    'task.unschedule',
    'Clear a whole-task schedule through the normal domain action.',
    z.strictObject({ id, ...session }),
    true,
    async (p) => {
      activeTask(p.id);
      if (isOccurrenceManaged(taskOccurrences(p.id)))
        throw new AgentError(
          'INVALID_STATE',
          'Unschedule individual occurrences',
        );
      await state().unscheduleTask(p.id, p.sessionId);
      return entity('task', p.id);
    },
  );
  define(
    'task.complete',
    'Record task completion. Complete individual occurrences for a split task.',
    byId,
    true,
    async (p) => {
      activeTask(p.id);
      if (isOccurrenceManaged(taskOccurrences(p.id)))
        throw new AgentError(
          'INVALID_STATE',
          'Complete individual occurrences',
        );
      await state().updateTask(p.id, {
        status: 'done',
        doneAt: new Date().toISOString(),
      });
      await state().recordSignal(p.id, 'done', 'check-in-strip');
      return entity('task', p.id);
    },
  );
  define(
    'task.defer',
    'Defer a whole task using the existing check-in action.',
    byId,
    true,
    async (p) => {
      activeTask(p.id);
      if (isOccurrenceManaged(taskOccurrences(p.id)))
        throw new AgentError(
          'INVALID_STATE',
          'Move or unschedule individual occurrences',
        );
      await state().updateTask(p.id, {
        status: 'deferred',
        deferredAt: new Date().toISOString(),
      });
      await state().recordSignal(p.id, 'defer', 'check-in-strip');
      await state().recordShift({
        id: crypto.randomUUID(),
        taskId: p.id,
        type: 'defer',
        at: new Date().toISOString(),
        payload: {},
      });
      return entity('task', p.id);
    },
  );
  for (const action of ['archive', 'restore', 'delete'] as const)
    define(
      `task.${action}`,
      `${action === 'delete' ? 'Soft-delete after in-app confirmation' : action} a task.`,
      byId,
      true,
      async (p) => {
        const task = entity('task', p.id);
        if (action === 'delete') await confirm(String(task.title));
        await state()[
          action === 'archive'
            ? 'archiveTask'
            : action === 'restore'
              ? 'restoreTask'
              : 'deleteTask'
        ](p.id);
        return entity('task', p.id);
      },
    );

  define(
    'occurrence.add',
    'Add a task split. Preserves an existing whole-task schedule during adoption.',
    z.strictObject({
      taskId: id,
      label: text.optional(),
      percent: z.number().min(0).max(100).optional(),
      note: z.string().optional(),
      ...session,
    }),
    true,
    async (p) => {
      activeTask(p.taskId);
      if (
        Object.values(state().adhocEvents).some(
          (e) => e.taskId === p.taskId && e.status === 'active',
        )
      )
        throw new AgentError(
          'INVALID_STATE',
          'Unschedule the free-time block before adding Rail-only occurrences',
        );
      const { taskId, sessionId, ...fields } = p;
      const occurrenceId = await state().addTaskOccurrence(
        taskId,
        fields,
        sessionId,
      );
      return entity('occurrence', occurrenceId);
    },
  );
  define(
    'occurrence.update',
    'Update a split label, note or milestone position (not a work weight).',
    z.strictObject({
      id,
      patch: z.strictObject({
        label: text.nullable().optional(),
        note: z.string().nullable().optional(),
        percent: z.number().min(0).max(100).nullable().optional(),
        order: z.number().optional(),
      }),
      ...session,
    }),
    true,
    async (p) => {
      const occ = entity('occurrence', p.id);
      activeTask(String(occ.taskId));
      await state().updateTaskOccurrence(
        p.id,
        patchValues(p.patch),
        p.sessionId,
      );
      return entity('occurrence', p.id);
    },
  );
  define(
    'occurrence.schedule',
    'Schedule one split on a date-effective Rail.',
    z.strictObject({ id, date, railId: id, ...session }),
    true,
    async (p) => {
      const occ = entity('occurrence', p.id);
      activeTask(String(occ.taskId));
      if (occ.status === 'archived')
        throw new AgentError('INVALID_STATE', 'Reopen the occurrence first');
      await state().scheduleTaskOccurrence(
        p.id,
        slot(p.railId, p.date),
        p.sessionId,
      );
      return entity('occurrence', p.id);
    },
  );
  define(
    'occurrence.unschedule',
    'Clear one split schedule.',
    z.strictObject({ id, ...session }),
    true,
    async (p) => {
      const occ = entity('occurrence', p.id);
      activeTask(String(occ.taskId));
      await state().scheduleTaskOccurrence(p.id, null, p.sessionId);
      return entity('occurrence', p.id);
    },
  );
  for (const action of ['complete', 'reopen', 'archive'] as const)
    define(
      `occurrence.${action}`,
      `${action} a task split.`,
      z.strictObject({ id, ...session }),
      true,
      async (p) => {
        const occ = entity('occurrence', p.id);
        activeTask(String(occ.taskId));
        await state()[
          action === 'complete'
            ? 'completeTaskOccurrence'
            : action === 'reopen'
              ? 'reopenTaskOccurrence'
              : 'archiveTaskOccurrence'
        ](p.id, p.sessionId);
        return entity('occurrence', p.id);
      },
    );

  const railFields = z.strictObject({
    templateKey: id,
    name: text,
    subtitle: z.string().optional(),
    startMinutes: minute,
    durationMinutes: duration,
    color,
    icon: z.string().optional(),
    showInCheckin: z.boolean(),
  });
  define(
    'rail.create',
    'Create a Rail with an explicit effective date.',
    railFields.extend({
      color: color.default('teal'),
      showInCheckin: z.boolean().default(true),
      ...effective,
      ...session,
    }),
    true,
    async (p) => {
      entity('template', p.templateKey);
      const { effectiveFrom, sessionId, ...fields } = p;
      const rail: Rail = { ...fields, id: crypto.randomUUID() };
      await state().createRail(rail, sessionId, effectiveFrom);
      return entity('rail', rail.id);
    },
  );
  define(
    'rail.update',
    'Update a Rail through effective-date revisions.',
    z.strictObject({
      id,
      patch: railFields.partial(),
      ...effective,
      ...session,
    }),
    true,
    async (p) => {
      entity('rail', p.id);
      if (p.patch.templateKey) entity('template', p.patch.templateKey);
      await state().updateRail(p.id, p.patch, p.sessionId, p.effectiveFrom);
      return entity('rail', p.id);
    },
  );
  define(
    'template.set',
    'Create or update a day template using effective-date revisions.',
    z.strictObject({
      key: id,
      name: text,
      color: color.optional(),
      isDefault: z.boolean().default(false),
      ...effective,
      ...session,
    }),
    true,
    async (p) => {
      const { effectiveFrom, sessionId, ...tpl } = p;
      await state().upsertTemplate(tpl, sessionId, effectiveFrom);
      return entity('template', tpl.key);
    },
  );
  define(
    'binding.set',
    'Create/update a habit-to-Rail binding.',
    z.strictObject({
      id: id.optional(),
      habitId: id,
      railId: id,
      weekdays: weekdays.optional(),
      ...effective,
      ...session,
    }),
    true,
    async (p) => {
      const line = entity('line', p.habitId);
      if (line.kind !== 'habit' || line.status !== 'active')
        throw new AgentError('INVALID_REFERENCE', 'Choose an active habit');
      entity('rail', p.railId);
      if (p.id) entity('binding', p.id);
      const { sessionId, ...opts } = p;
      const bindingId = await state().upsertHabitBinding(opts, sessionId);
      return entity('binding', bindingId);
    },
  );
  define(
    'binding.remove',
    'Retire a habit binding from its effective date after in-app confirmation.',
    z.strictObject({ id, ...effective, ...session }),
    true,
    async (p) => {
      entity('binding', p.id);
      await confirm(
        '习惯的时间绑定',
        '移除后，习惯不再按这条绑定安排。需要时可以重新添加。',
      );
      await state().removeHabitBinding(p.id, p.sessionId, p.effectiveFrom);
      return { id: p.id, removed: true };
    },
  );
  define(
    'rule.weekday',
    'Set a template for specified weekdays.',
    z.strictObject({ templateKey: id, weekdays, ...effective }),
    true,
    async (p) => {
      entity('template', p.templateKey);
      await state().upsertWeekdayRule(
        p.templateKey,
        p.weekdays,
        p.effectiveFrom,
      );
      return { updated: true };
    },
  );
  define(
    'rule.range',
    'Set a date-range template rule.',
    z
      .strictObject({
        id: id.optional(),
        from: date,
        to: date,
        templateKey: id,
        label: text.optional(),
        ...effective,
      })
      .refine((p) => p.from <= p.to, 'Invalid range'),
    true,
    async (p) => {
      entity('template', p.templateKey);
      if (p.id) entity('rule', p.id);
      return entity('rule', await state().upsertDateRangeRule(p));
    },
  );
  define(
    'rule.order',
    'Set calendar-rule priority order.',
    z.strictObject({ ids: z.array(id) }),
    true,
    async (p) => {
      p.ids.forEach((ruleId) => entity('rule', ruleId));
      if (new Set(p.ids).size !== p.ids.length)
        throw new AgentError('INVALID_INPUT', 'Duplicate rule ids');
      await state().setCalendarRuleOrder(p.ids);
      return profile();
    },
  );
  define(
    'calendar.override',
    "Override a single day's template.",
    z.strictObject({ date, templateKey: id, ...effective, ...session }),
    true,
    async (p) => {
      entity('template', p.templateKey);
      await state().overrideCycleDay(
        p.date,
        p.templateKey,
        p.sessionId,
        p.effectiveFrom,
      );
      return { updated: true };
    },
  );
  define(
    'calendar.clear-override',
    'Clear a single day template override.',
    z.strictObject({ date, ...effective, ...session }),
    true,
    async (p) => {
      await state().clearCycleDayOverride(p.date, p.sessionId, p.effectiveFrom);
      return { updated: true };
    },
  );
  define(
    'reflection.set',
    'Write the reflection for a date. Empty content clears it.',
    z.strictObject({ date, content: z.string() }),
    true,
    async (p) => {
      await state().setReflection(p.date, p.content);
      return state().reflections[p.date] ?? null;
    },
  );
  define(
    'note.set',
    'Create/update a date note.',
    z.strictObject({
      id: id.optional(),
      date,
      label: text,
      color: color.optional(),
    }),
    true,
    async (p) => {
      if (p.id) entity('note', p.id);
      return entity('note', await state().upsertUserDayNote(p));
    },
  );
  define(
    'phase.set',
    'Create/update a habit phase.',
    z.strictObject({
      id: id.optional(),
      lineId: id,
      name: text,
      description: z.string().optional(),
      startDate: date,
    }),
    true,
    async (p) => {
      const line = entity('line', p.lineId);
      if (line.kind !== 'habit')
        throw new AgentError('INVALID_REFERENCE', 'Choose a habit');
      if (p.id) entity('phase', p.id);
      return entity('phase', await state().upsertHabitPhase(p));
    },
  );
  define(
    'event.create',
    'Create a free-standing calendar event.',
    z.strictObject({
      date,
      name: text,
      startMinutes: minute,
      durationMinutes: duration,
      color: color.optional(),
      lineId: id.optional(),
    }),
    true,
    async (p) => {
      if (p.lineId) entity('line', p.lineId);
      return entity('event', await state().createAdhocEvent(p));
    },
  );
  define(
    'session.open',
    'Open an in-memory edit/undo session; not a transaction.',
    z.strictObject({ label: text.default('agent') }),
    false,
    (p) => state().openEditSession(`cli:${p.label}`),
  );
  define(
    'session.close',
    'Close an edit session. Undo history remains runtime-local.',
    byId,
    false,
    async (p) => {
      if (!state().sessions[p.id])
        throw new AgentError('NOT_FOUND', 'Unknown session');
      await state().closeEditSession(p.id);
      return { closed: true };
    },
  );
  define(
    'session.undo',
    'Undo changes tracked by an edit session.',
    byId,
    true,
    async (p) => {
      if (!state().sessions[p.id])
        throw new AgentError('NOT_FOUND', 'Unknown session');
      return { undone: await state().undoEditSession(p.id) };
    },
  );

  define(
    'line.archive',
    'Archive a project or habit without deleting it.',
    byId,
    true,
    async (p) => {
      editableLine(p.id);
      await state().updateLine(p.id, {
        status: 'archived',
        archivedAt: Date.now(),
      });
      return entity('line', p.id);
    },
  );
  define(
    'task.reopen',
    'Reopen a whole task; split tasks must reopen individual occurrences.',
    byId,
    true,
    async (p) => {
      activeTask(p.id);
      if (isOccurrenceManaged(taskOccurrences(p.id)))
        throw new AgentError('INVALID_STATE', 'Reopen individual occurrences');
      await state().updateTask(p.id, {
        status: 'pending',
        doneAt: undefined,
        deferredAt: undefined,
      });
      return entity('task', p.id);
    },
  );
  define(
    'cycle.set',
    'Create/update a reflection/planning cycle.',
    z
      .strictObject({
        id: id.optional(),
        startDate: date,
        endDate: date.optional(),
        label: text.optional(),
      })
      .refine(
        (p) => !p.endDate || p.startDate <= p.endDate,
        'Invalid cycle range',
      ),
    true,
    async (p) => {
      if (p.id && state().cycles[p.id]) entity('cycle', p.id);
      return entity('cycle', await state().upsertCycle(p));
    },
  );
  define(
    'rule.cycle',
    'Set a repeating template cycle.',
    z
      .strictObject({
        id: id.optional(),
        cycleLength: z.number().int().min(1).max(366),
        anchor: date,
        mapping: z.array(id).min(1).max(366),
        ...effective,
      })
      .refine(
        (p) => p.mapping.length === p.cycleLength,
        'Mapping length must match cycleLength',
      ),
    true,
    async (p) => {
      p.mapping.forEach((key) => entity('template', key));
      if (p.id) entity('rule', p.id);
      return entity('rule', await state().upsertCycleRule(p));
    },
  );
  define(
    'rule.external',
    'Set a rule matching holiday or personal-note attributes.',
    z.strictObject({
      id: id.optional(),
      kinds: z
        .array(z.enum(['holiday', 'observance', 'makeup-workday', 'user-note']))
        .min(1),
      regions: z.array(id).optional(),
      noteLabelFilter: z
        .strictObject({
          mode: z.enum(['contains', 'exact']),
          query: z.string(),
        })
        .optional(),
      templateKey: id,
      label: text.optional(),
      ...effective,
    }),
    true,
    async (p) => {
      entity('template', p.templateKey);
      if (p.id) entity('rule', p.id);
      return entity('rule', await state().upsertExternalEventRule(p));
    },
  );
  for (const resource of [
    'rail',
    'template',
    'rule',
    'note',
    'phase',
    'event',
  ] as const)
    define(
      `${resource}.remove`,
      'Remove this object after in-app confirmation. Versioned objects retain history; notes/phases/events follow their native removal semantics.',
      z.strictObject({ id, ...effective, ...session }),
      true,
      async (p) => {
        const row = entity(resource, p.id);
        await confirm(
          String(row.name ?? row.label ?? p.id),
          resource === 'template'
            ? '对应的时间轨道也会一并删除，历史记录保留。'
            : resource === 'rail' || resource === 'rule'
              ? '将从指定生效日期起移除，历史记录保留。'
              : resource === 'event'
                ? '日历事件将从安排中移除。'
                : '删除后无法直接恢复。',
        );
        const s = state();
        if (resource === 'rail')
          await s.deleteRail(p.id, p.sessionId, p.effectiveFrom);
        if (resource === 'template')
          await s.deleteTemplate(p.id, p.sessionId, p.effectiveFrom);
        if (resource === 'rule')
          await s.removeCalendarRule(p.id, p.effectiveFrom);
        if (resource === 'note') await s.removeUserDayNote(p.id);
        if (resource === 'phase') await s.removeHabitPhase(p.id);
        if (resource === 'event') await s.deleteAdhocEvent(p.id);
        return { id: p.id, removed: true };
      },
    );

  define(
    'occurrence.remove',
    'Remove a task split after in-app confirmation; the parent Task remains.',
    z.strictObject({ id, ...session }),
    true,
    async (p) => {
      const occ = entity('occurrence', p.id);
      activeTask(String(occ.taskId));
      await confirm(
        String(occ.label ?? '任务切分'),
        '删除这条切分后无法直接恢复，父任务保留。',
      );
      await state().removeTaskOccurrence(p.id, p.sessionId);
      return { id: p.id, removed: true };
    },
  );
  define(
    'shift.tag',
    'Add reason tags to an existing Shift.',
    z.strictObject({ id, tags: z.array(text) }),
    true,
    async (p) => {
      entity('shift', p.id);
      await state().setShiftTags(p.id, p.tags);
      return entity('shift', p.id);
    },
  );

  let queue: Promise<unknown> = Promise.resolve();
  const requests = new Map<
    string,
    { signature: string; response: Promise<AgentResponse>; settled: boolean }
  >();
  async function execute(request: AgentRequest): Promise<AgentResponse> {
    let applied = false;
    try {
      currentDeadline = request.expiresAt;
      if (!active)
        throw new AgentError('NOT_READY', 'Local agent access was stopped');
      if (request.expiresAt && Date.now() >= request.expiresAt)
        throw new AgentError('EXPIRED', 'The request expired before execution');
      if (!state().ready)
        throw new AgentError('NOT_READY', 'DayRail has not finished loading');
      const command = commands[request.method];
      if (!command)
        throw new AgentError(
          'UNKNOWN_METHOD',
          `Unknown command ${request.method}; use schema to discover commands`,
        );
      const parsed = command.schema.safeParse(request.params ?? {});
      if (!parsed.success)
        throw new AgentError(
          'INVALID_INPUT',
          'Arguments do not match the command schema',
          parsed.error.issues,
        );
      const params = parsed.data as Record<string, unknown>;
      if (params.sessionId && !state().sessions[String(params.sessionId)])
        throw new AgentError('NOT_FOUND', 'Unknown edit session');
      if (
        command.write &&
        request.ifRevision &&
        request.ifRevision !== revision()
      )
        throw new AgentError(
          'REVISION_CONFLICT',
          'Data changed; read the current state before editing',
        );
      const result = await command.run(parsed.data);
      if (command.write) {
        applied = true;
        await (options.persist ?? flushPersistence)();
      }
      // Snapshot the result now: later UI edits must not mutate cached responses.
      return JSON.parse(
        JSON.stringify({ ok: true, runtimeId, revision: revision(), result }),
      ) as AgentResponse;
    } catch (error) {
      const e = applied
        ? new AgentError(
            'PERSIST_FAILED',
            'The change is visible in memory but local saving failed. Inspect state before retrying.',
            { applied: true, cause: String(error) },
          )
        : error instanceof AgentError
          ? error
          : new AgentError('INVALID_STATE', (error as Error).message);
      return {
        ok: false,
        runtimeId,
        revision: revision(),
        error: { code: e.code, message: e.message, details: e.details },
      };
    }
  }
  return {
    runtimeId,
    revision,
    dispatch(request: AgentRequest): Promise<AgentResponse> {
      if (!request.id || request.id.length > 200)
        return Promise.resolve({
          ok: false,
          runtimeId,
          revision: revision(),
          error: {
            code: 'INVALID_INPUT',
            message: 'A request ID (1-200 characters) is required',
          },
        });
      const signature = canonical({
        method: request.method,
        params: request.params ?? {},
        ifRevision: request.ifRevision,
      });
      const prior = requests.get(request.id);
      if (prior)
        return prior.signature === signature
          ? prior.response
          : Promise.resolve({
              ok: false,
              runtimeId,
              revision: revision(),
              error: {
                code: 'REQUEST_ID_CONFLICT',
                message:
                  'This request ID was already used with different arguments',
              },
            });
      // Evict only completed requests: in-flight IDs must remain deduplicated.
      if (requests.size >= 1000) {
        const completed = [...requests].find(([, entry]) => entry.settled);
        if (completed) requests.delete(completed[0]);
        else
          return Promise.resolve({
            ok: false,
            runtimeId,
            revision: revision(),
            error: { code: 'BUSY', message: 'Too many pending requests' },
          });
      }
      const response = queue.then(() => execute(request));
      queue = response.catch(() => undefined);
      const entry = { signature, response, settled: false };
      requests.set(request.id, entry);
      void response.then(() => {
        entry.settled = true;
      });
      return response;
    },
    dispose() {
      active = false;
      doc.off('update', onUpdate);
    },
  };
}
