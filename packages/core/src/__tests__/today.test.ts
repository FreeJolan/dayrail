import { describe, expect, it } from 'vitest';
import {
  selectCheckinQueue,
  selectPendingQueue,
  selectTodayTimeline,
} from '../today';
import type {
  CalendarRule,
  CalendarRuleWeekday,
  Rail,
  Task,
  Template,
} from '../types';

// selectTodayTimeline / selectCheckinQueue / selectPendingQueue feed
// three different surfaces (today timeline, top-of-Today-Track strip,
// /pending page). Bugs here manifest as "I see a task on the wrong
// screen" — easy to miss in manual testing until a user reports it.
// Pure selectors, so we exercise every branch without touching the
// real store.

const TODAY_ISO = '2026-04-19'; // Sunday
const NOW = new Date('2026-04-19T12:00:00');

function template(key: string): Template {
  return { key, name: key, isDefault: false };
}

function rail(overrides: Partial<Rail> & { id: string; templateKey: string }): Rail {
  return {
    name: overrides.id,
    startMinutes: 9 * 60,
    durationMinutes: 60,
    color: 'indigo',
    showInCheckin: true,
    ...overrides,
  };
}

interface TaskOpts {
  id: string;
  railId?: string;
  date?: string;
  status?: Task['status'];
}

function task(opts: TaskOpts): Task {
  return {
    id: opts.id,
    lineId: 'line-a',
    title: opts.id,
    order: 0,
    status: opts.status ?? 'pending',
    ...(opts.railId && opts.date && {
      slot: { cycleId: `cycle-${opts.date}`, date: opts.date, railId: opts.railId },
    }),
  };
}

function weekdayRule(templateKey: string, weekdays: number[]): CalendarRule {
  return {
    id: `cr-weekday-${templateKey}`,
    kind: 'weekday',
    priority: 10,
    value: { templateKey, weekdays } as CalendarRuleWeekday,
    createdAt: 0,
  };
}

function mapById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

function byKey<T extends { key: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.key, i]));
}

describe('selectTodayTimeline', () => {
  it('includes rails whose template matches today (no task required)', () => {
    const workdayRail = rail({ id: 'r-work', templateKey: 'workday' });
    const restRail = rail({ id: 'r-rest', templateKey: 'restday' });
    const state = {
      rails: mapById([workdayRail, restRail]),
      tasks: {},
      templates: byKey([template('workday'), template('restday')]),
      calendarRules: mapById([
        weekdayRule('workday', [1, 2, 3, 4, 5]),
        weekdayRule('restday', [0, 6]),
      ]),
    };
    // TODAY_ISO is a Sunday → restday.
    const rows = selectTodayTimeline(state, TODAY_ISO);
    expect(rows.map((r) => r.rail.id)).toEqual(['r-rest']);
    expect(rows[0]?.tasks).toEqual([]); // bare rail, no tasks
  });

  it('also surfaces rails whose template does NOT match but carry a task today', () => {
    // User parked a workday rail task on Sunday — the task's intent
    // should be visible even though the rail wouldn't fire normally.
    const workdayRail = rail({ id: 'r-work', templateKey: 'workday' });
    const parkedTask = task({
      id: 't1',
      railId: 'r-work',
      date: TODAY_ISO,
    });
    const state = {
      rails: mapById([workdayRail]),
      tasks: mapById([parkedTask]),
      templates: byKey([template('workday'), template('restday')]),
      calendarRules: mapById([
        weekdayRule('workday', [1, 2, 3, 4, 5]),
        weekdayRule('restday', [0, 6]),
      ]),
    };
    const rows = selectTodayTimeline(state, TODAY_ISO);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rail.id).toBe('r-work');
    expect(rows[0]?.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('groups multiple tasks on the same (rail, date) and sorts pending-first', () => {
    const r = rail({ id: 'r1', templateKey: 'workday' });
    const done = task({ id: 'done', railId: 'r1', date: TODAY_ISO, status: 'done' });
    const deferred = task({ id: 'deferred', railId: 'r1', date: TODAY_ISO, status: 'deferred' });
    const pending = task({ id: 'pending', railId: 'r1', date: TODAY_ISO });
    const archived = task({ id: 'archived', railId: 'r1', date: TODAY_ISO, status: 'archived' });
    const state = {
      rails: mapById([r]),
      tasks: mapById([done, deferred, pending, archived]),
      templates: byKey([template('workday')]),
      calendarRules: mapById([weekdayRule('workday', [0, 1, 2, 3, 4, 5, 6])]),
    };
    const rows = selectTodayTimeline(state, TODAY_ISO);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tasks.map((t) => t.id)).toEqual([
      'pending',
      'done',
      'deferred',
      'archived',
    ]);
  });

  it('skips deleted tasks', () => {
    const r = rail({ id: 'r1', templateKey: 'workday' });
    const ghost = task({
      id: 'ghost',
      railId: 'r1',
      date: TODAY_ISO,
      status: 'deleted',
    });
    const state = {
      rails: mapById([r]),
      tasks: mapById([ghost]),
      templates: byKey([template('workday')]),
      calendarRules: mapById([weekdayRule('workday', [0, 1, 2, 3, 4, 5, 6])]),
    };
    const rows = selectTodayTimeline(state, TODAY_ISO);
    expect(rows[0]?.tasks).toEqual([]);
  });

  it('sorts rows by planned start time', () => {
    const early = rail({
      id: 'morning',
      templateKey: 'workday',
      startMinutes: 7 * 60,
    });
    const late = rail({
      id: 'evening',
      templateKey: 'workday',
      startMinutes: 20 * 60,
    });
    const state = {
      rails: mapById([late, early]), // deliberately out of order
      tasks: {},
      templates: byKey([template('workday')]),
      calendarRules: mapById([weekdayRule('workday', [0, 1, 2, 3, 4, 5, 6])]),
    };
    const rows = selectTodayTimeline(state, TODAY_ISO);
    expect(rows.map((r) => r.rail.id)).toEqual(['morning', 'evening']);
  });
});

describe('selectCheckinQueue', () => {
  const r = rail({
    id: 'r1',
    templateKey: 'workday',
    startMinutes: 8 * 60,
    durationMinutes: 60,
  });

  it('surfaces a pending rail-bound task whose window ended < 24 h ago', () => {
    // Rail ended at 09:00 today; now is 12:00 → 3h ago.
    const t = task({ id: 't1', railId: 'r1', date: TODAY_ISO });
    const state = { rails: mapById([r]), tasks: mapById([t]) };
    const rows = selectCheckinQueue(state, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task.id).toBe('t1');
  });

  it('drops rails whose window has not yet ended', () => {
    const future = rail({
      id: 'future',
      templateKey: 'workday',
      startMinutes: 20 * 60, // 20:00 today — NOW is 12:00, not ended
      durationMinutes: 30,
    });
    const t = task({ id: 't1', railId: 'future', date: TODAY_ISO });
    const state = { rails: mapById([future]), tasks: mapById([t]) };
    const rows = selectCheckinQueue(state, NOW);
    expect(rows).toEqual([]);
  });

  it('drops rails ended > 24 h ago (those move to the Pending queue)', () => {
    // Rail was yesterday morning, well beyond the 24 h check-in strip.
    const t = task({ id: 't1', railId: 'r1', date: '2026-04-18' });
    const state = { rails: mapById([r]), tasks: mapById([t]) };
    const rows = selectCheckinQueue(state, NOW);
    expect(rows).toEqual([]);
  });

  it('respects rail.showInCheckin=false (silent rail never surfaces)', () => {
    const silent = rail({
      id: 'r1',
      templateKey: 'workday',
      startMinutes: 8 * 60,
      durationMinutes: 60,
      showInCheckin: false,
    });
    const t = task({ id: 't1', railId: 'r1', date: TODAY_ISO });
    const state = { rails: mapById([silent]), tasks: mapById([t]) };
    const rows = selectCheckinQueue(state, NOW);
    expect(rows).toEqual([]);
  });

  it('filters non-pending statuses (done / deferred / archived / deleted)', () => {
    const terminalStatuses: Task['status'][] = [
      'done',
      'deferred',
      'archived',
      'deleted',
    ];
    for (const s of terminalStatuses) {
      const t = task({ id: 't1', railId: 'r1', date: TODAY_ISO, status: s });
      const state = { rails: mapById([r]), tasks: mapById([t]) };
      const rows = selectCheckinQueue(state, NOW);
      expect(rows, `status=${s}`).toEqual([]);
    }
  });
});

describe('selectPendingQueue', () => {
  const r = rail({
    id: 'r1',
    templateKey: 'workday',
    startMinutes: 8 * 60,
    durationMinutes: 60,
  });

  it('includes stale pending rail-bound tasks (any age, window ended)', () => {
    // Yesterday's rail-bound pending task — beyond check-in's 24h but
    // still deserves a decision.
    const t = task({ id: 't1', railId: 'r1', date: '2026-04-15' });
    const state = { rails: mapById([r]), tasks: mapById([t]) };
    const rows = selectPendingQueue(state, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task.id).toBe('t1');
  });

  it('drops future-pending tasks (window has not ended)', () => {
    const t = task({ id: 't1', railId: 'r1', date: '2026-04-30' });
    const state = { rails: mapById([r]), tasks: mapById([t]) };
    const rows = selectPendingQueue(state, NOW);
    expect(rows).toEqual([]);
  });

  it('includes every deferred task regardless of time', () => {
    const futureDeferred = task({
      id: 'future',
      railId: 'r1',
      date: '2026-05-10',
      status: 'deferred',
    });
    const pastDeferred = task({
      id: 'past',
      railId: 'r1',
      date: '2026-03-01',
      status: 'deferred',
    });
    const state = {
      rails: mapById([r]),
      tasks: mapById([futureDeferred, pastDeferred]),
    };
    const rows = selectPendingQueue(state, NOW);
    expect(rows.map((r) => r.task.id).sort()).toEqual(['future', 'past']);
  });

  it('includes slot-less deferred tasks (Inbox items pushed to later)', () => {
    const inboxDeferred: Task = {
      id: 'inbox-deferred',
      lineId: 'line-inbox',
      title: 'buy milk',
      order: 0,
      status: 'deferred',
      // no slot — user deferred an Inbox task without scheduling
    };
    const state = { rails: mapById([r]), tasks: mapById([inboxDeferred]) };
    const rows = selectPendingQueue(state, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task.id).toBe('inbox-deferred');
    expect(rows[0]?.rail).toBeUndefined();
  });

  it('skips done / archived / deleted', () => {
    const closedStatuses: Task['status'][] = ['done', 'archived', 'deleted'];
    for (const s of closedStatuses) {
      const t = task({ id: 't1', railId: 'r1', date: '2026-04-15', status: s });
      const state = { rails: mapById([r]), tasks: mapById([t]) };
      const rows = selectPendingQueue(state, NOW);
      expect(rows, `status=${s}`).toEqual([]);
    }
  });
});
