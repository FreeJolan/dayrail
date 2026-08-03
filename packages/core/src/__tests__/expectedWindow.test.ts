import { describe, expect, it } from 'vitest';
import {
  effectiveExpectedWindow,
  expectedCycleRelation,
  formatExpectedWindow,
  normalizeExpectedWindow,
  selectAttentionIssues,
  type AdhocEvent,
  type Line,
  type Task,
  type TaskOccurrence,
} from '..';

const project: Line = {
  id: 'project-1',
  name: 'Launch',
  kind: 'project',
  status: 'active',
  plannedStart: '2026-08-10',
  plannedEnd: '2026-08-16',
  plannedPrecision: 'week',
  createdAt: 1,
};

const task = (patch: Partial<Task> = {}): Task => ({
  id: 'task-1',
  lineId: project.id,
  title: 'Prepare launch',
  order: 1,
  status: 'pending',
  ...patch,
});

describe('expected windows', () => {
  it('accepts local date ranges and rejects incomplete or invalid values', () => {
    expect(
      normalizeExpectedWindow({
        startDate: '2026-08-10',
        endDate: '2026-08-16',
        precision: 'week',
      }),
    ).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      precision: 'week',
    });
    expect(
      normalizeExpectedWindow({ startDate: '2026-08-10' }),
    ).toBeNull();
    expect(
      normalizeExpectedWindow({
        startDate: '2026-08-18',
        endDate: '2026-08-16',
        precision: 'range',
      }),
    ).toBeNull();
    expect(
      normalizeExpectedWindow({
        startDate: '2026-02-30',
        endDate: '2026-02-30',
        precision: 'day',
      }),
    ).toBeNull();
  });

  it('uses a Task window before its Project window', () => {
    const inherited = effectiveExpectedWindow(task(), { [project.id]: project });
    expect(inherited).toMatchObject({
      source: 'project',
      ownerId: project.id,
      inherited: true,
    });

    const own = effectiveExpectedWindow(
      task({
        expectedWindow: {
          startDate: '2026-08-20',
          endDate: '2026-08-20',
          precision: 'day',
        },
      }),
      { [project.id]: project },
    );
    expect(own).toMatchObject({
      source: 'task',
      ownerId: 'task-1',
      inherited: false,
    });
  });

  it('classifies overlap, earlier, later, and missing windows', () => {
    const window = normalizeExpectedWindow({
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      precision: 'week',
    });
    expect(expectedCycleRelation(window, '2026-08-10', '2026-08-16')).toBe(
      'current',
    );
    expect(expectedCycleRelation(window, '2026-08-17', '2026-08-23')).toBe(
      'before',
    );
    expect(expectedCycleRelation(window, '2026-08-03', '2026-08-09')).toBe(
      'after',
    );
    expect(expectedCycleRelation(null, '2026-08-03', '2026-08-09')).toBe(
      'none',
    );
  });

  it('keeps the year visible for cross-year ranges', () => {
    expect(
      formatExpectedWindow({
        startDate: '2026-12-28',
        endDate: '2027-01-03',
        precision: 'week',
      }),
    ).toBe('2026年12月28日–2027年1月3日');
  });
});

describe('attention issues', () => {
  it('aggregates inherited occurrences and a coexisting Ad-hoc under one Project', () => {
    const parent = task();
    const occurrences: Record<string, TaskOccurrence> = {
      'occ-1': {
        id: 'occ-1',
        taskId: parent.id,
        status: 'pending',
        order: 0,
        slot: {
          cycleId: 'cycle-2026-08-17',
          date: '2026-08-18',
          railId: 'rail-1',
        },
      },
      'occ-2': {
        id: 'occ-2',
        taskId: parent.id,
        status: 'pending',
        order: 1,
        slot: {
          cycleId: 'cycle-2026-08-17',
          date: '2026-08-19',
          railId: 'rail-2',
        },
      },
    };
    const adhoc: AdhocEvent = {
      id: 'adhoc-task-1',
      taskId: parent.id,
      date: '2026-08-20',
      startMinutes: 600,
      durationMinutes: 60,
      name: parent.title,
      status: 'active',
    };
    const issues = selectAttentionIssues(
      {
        lines: { [project.id]: project },
        tasks: { [parent.id]: parent },
        taskOccurrences: occurrences,
        adhocEvents: { [adhoc.id]: adhoc },
      },
      '2026-08-17',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      subjectType: 'project',
      subjectId: project.id,
      overdueDays: 1,
    });
    expect(issues[0]!.contributors).toHaveLength(3);
    expect(issues[0]!.lateSchedules).toHaveLength(3);
  });

  it('keeps an independently planned child as a separate Task issue', () => {
    const inherited = task({ id: 'task-inherited' });
    const independent = task({
      id: 'task-independent',
      expectedWindow: {
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        precision: 'range',
      },
    });
    const issues = selectAttentionIssues(
      {
        lines: { [project.id]: project },
        tasks: {
          [inherited.id]: inherited,
          [independent.id]: independent,
        },
        taskOccurrences: {},
        adhocEvents: {},
      },
      '2026-08-17',
    );
    expect(issues.map((issue) => `${issue.subjectType}:${issue.subjectId}`)).toEqual(
      ['task:task-independent', 'project:project-1'],
    );
  });

  it('surfaces an overdue Project that still needs decomposition', () => {
    const issues = selectAttentionIssues(
      {
        lines: { [project.id]: project },
        tasks: {},
        taskOccurrences: {},
        adhocEvents: {},
      },
      '2026-08-18',
    );
    expect(issues).toEqual([
      expect.objectContaining({
        subjectType: 'project',
        subjectId: project.id,
        overdueDays: 2,
        contributors: [],
      }),
    ]);
  });
});
