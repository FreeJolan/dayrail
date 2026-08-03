import { describe, expect, it } from 'vitest';
import {
  REVISION_SENTINEL_DATE,
  selectCalendarAgenda,
  type AdhocEvent,
  type CalendarRule,
  type CalendarRuleRevision,
  type HabitBinding,
  type HabitBindingRevision,
  type Line,
  type Rail,
  type RailRevision,
  type Task,
  type TaskOccurrence,
  type Template,
} from '..';

const DATE = '2026-08-03';

const project: Line = {
  id: 'project-1',
  name: 'Launch',
  kind: 'project',
  status: 'active',
  createdAt: 1,
};

const habit: Line = {
  id: 'habit-1',
  name: 'Read',
  kind: 'habit',
  status: 'active',
  createdAt: 1,
};

const rail: Rail = {
  id: 'rail-1',
  templateKey: 'workday',
  name: 'Morning',
  startMinutes: 540,
  durationMinutes: 60,
  color: 'indigo',
  showInCheckin: true,
};

const railRevision: RailRevision = {
  id: 'rail-revision-1',
  railId: rail.id,
  effectiveFrom: REVISION_SENTINEL_DATE,
  templateKey: rail.templateKey,
  name: rail.name,
  startMinutes: rail.startMinutes,
  durationMinutes: rail.durationMinutes,
  color: rail.color,
  showInCheckin: rail.showInCheckin,
  authoredAt: 1,
};

const template: Template = {
  key: 'workday',
  name: 'Workday',
  isDefault: false,
};

const calendarRule: CalendarRule = {
  id: 'rule-1',
  kind: 'weekday',
  priority: 1,
  value: { templateKey: template.key, weekdays: [1] },
  createdAt: 1,
};

const calendarRuleRevision: CalendarRuleRevision = {
  id: 'rule-revision-1',
  ruleId: calendarRule.id,
  effectiveFrom: REVISION_SENTINEL_DATE,
  priority: calendarRule.priority,
  value: calendarRule.value,
  authoredAt: 1,
};

const binding: HabitBinding = {
  id: 'binding-1',
  habitId: habit.id,
  railId: rail.id,
  createdAt: 1,
};

const bindingRevision: HabitBindingRevision = {
  id: 'binding-revision-1',
  bindingId: binding.id,
  effectiveFrom: REVISION_SENTINEL_DATE,
  habitId: habit.id,
  railId: rail.id,
  authoredAt: 1,
};

function task(patch: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    lineId: project.id,
    title: 'Prepare launch',
    order: 1,
    status: 'pending',
    ...patch,
  };
}

function occurrence(patch: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return {
    id: 'occurrence-1',
    taskId: 'task-1',
    status: 'pending',
    order: 0,
    slot: { cycleId: 'cycle-1', date: DATE, railId: rail.id },
    ...patch,
  };
}

function adhoc(patch: Partial<AdhocEvent> = {}): AdhocEvent {
  return {
    id: 'adhoc-1',
    date: DATE,
    startMinutes: 600,
    durationMinutes: 45,
    name: 'Walk',
    status: 'active',
    ...patch,
  };
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    lines: { [project.id]: project, [habit.id]: habit },
    tasks: {},
    taskOccurrences: {},
    adhocEvents: {},
    templates: { [template.key]: template },
    calendarRules: { [calendarRule.id]: calendarRule },
    calendarRuleRevisions: { [calendarRule.id]: [calendarRuleRevision] },
    calendarRuleTombstones: {},
    habitBindings: { [binding.id]: binding },
    habitBindingRevisions: { [binding.id]: [bindingRevision] },
    habitBindingTombstones: {},
    rails: { [rail.id]: rail },
    railRevisions: { [rail.id]: [railRevision] },
    railTombstones: {},
    userDayNotes: {},
    userProfile: null,
    ...overrides,
  };
}

const options = {
  startDate: DATE,
  endDate: DATE,
  includeTasks: true,
  includeHabits: false,
};

describe('selectCalendarAgenda', () => {
  it('projects a regular Task slot with its Rail time', () => {
    const scheduled = task({
      slot: { cycleId: 'cycle-1', date: DATE, railId: rail.id },
    });
    const result = selectCalendarAgenda(
      state({ tasks: { [scheduled.id]: scheduled } }),
      options,
    );
    expect(result).toEqual([
      expect.objectContaining({
        kind: 'task',
        taskId: scheduled.id,
        startMinutes: 540,
        durationMinutes: 60,
        railName: 'Morning',
      }),
    ]);
  });

  it('uses occurrence slots instead of the parent slot and preserves completed rows', () => {
    const parent = task({
      slot: { cycleId: 'cycle-old', date: DATE, railId: rail.id },
    });
    const done = occurrence({ status: 'done', label: 'First pass' });
    const result = selectCalendarAgenda(
      state({
        tasks: { [parent.id]: parent },
        taskOccurrences: { [done.id]: done },
      }),
      options,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'occurrence',
      occurrenceId: done.id,
      title: 'First pass',
      parentTitle: parent.title,
      status: 'done',
    });
  });

  it('keeps a task-backed Ad-hoc beside managed occurrences without duplicating it', () => {
    const parent = task();
    const item = occurrence();
    const taskAdhoc = adhoc({ id: 'task-adhoc', taskId: parent.id });
    const result = selectCalendarAgenda(
      state({
        tasks: { [parent.id]: parent },
        taskOccurrences: { [item.id]: item },
        adhocEvents: { [taskAdhoc.id]: taskAdhoc },
      }),
      options,
    );
    expect(result.map((row) => row.kind)).toEqual(['occurrence', 'task-adhoc']);
    expect(result.filter((row) => row.adhocId === taskAdhoc.id)).toHaveLength(1);
  });

  it('always includes independent Ad-hoc events when both optional layers are off', () => {
    const event = adhoc();
    const result = selectCalendarAgenda(
      state({ adhocEvents: { [event.id]: event } }),
      { ...options, includeTasks: false, includeHabits: false },
    );
    expect(result).toEqual([
      expect.objectContaining({ kind: 'adhoc', adhocId: event.id }),
    ]);
  });

  it('merges planned Habit candidates with stored facts and lets facts win', () => {
    const fact = task({
      id: `task-auto-${habit.id}-${DATE}-${rail.id}`,
      lineId: habit.id,
      title: habit.name,
      source: 'auto-habit',
      status: 'done',
      slot: { cycleId: 'auto', date: DATE, railId: rail.id },
    });
    const result = selectCalendarAgenda(
      state({ tasks: { [fact.id]: fact } }),
      { ...options, includeTasks: false, includeHabits: true },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'habit',
      taskId: fact.id,
      status: 'done',
    });
    expect(result[0]?.virtual).toBeUndefined();
  });

  it('is a pure read and does not materialize planned Habit rows', () => {
    const input = state();
    const before = JSON.stringify(input);
    const result = selectCalendarAgenda(input, {
      ...options,
      includeTasks: false,
      includeHabits: true,
    });
    expect(result).toEqual([
      expect.objectContaining({ kind: 'habit', virtual: true }),
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });
});
