import { describe, expect, it } from 'vitest';
import {
  selectCheckinQueue,
  selectPendingQueue,
  selectTodayTimeline,
  toIsoDateTime,
} from '../today';
import type {
  CalendarRule,
  CalendarRuleRevision,
  CalendarRuleWeekday,
  Rail,
  RailRevision,
  Task,
  TaskOccurrence,
  Template,
} from '../types';
import { REVISION_SENTINEL_DATE } from '../types';

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

/** Build the §10.5 revision tables that match a set of legacy entities,
 *  using `effectiveFrom = '1970-01-01'` so every test date hits them.
 *  Mirrors what the v0.5 sentinel migration would produce. */
function railRevisionsFor(rails: Rail[]): Record<string, RailRevision[]> {
  return Object.fromEntries(
    rails.map((r) => [
      r.id,
      [
        {
          id: `rev-rail-${r.id}-sentinel`,
          railId: r.id,
          effectiveFrom: REVISION_SENTINEL_DATE,
          templateKey: r.templateKey,
          name: r.name,
          ...(r.subtitle != null && { subtitle: r.subtitle }),
          startMinutes: r.startMinutes,
          durationMinutes: r.durationMinutes,
          color: r.color,
          ...(r.icon != null && { icon: r.icon }),
          showInCheckin: r.showInCheckin,
          authoredAt: 0,
        } satisfies RailRevision,
      ],
    ]),
  );
}

function calendarRuleRevisionsFor(
  rules: CalendarRule[],
): Record<string, CalendarRuleRevision[]> {
  return Object.fromEntries(
    rules.map((r) => [
      r.id,
      [
        {
          id: `rev-calrule-${r.id}-sentinel`,
          ruleId: r.id,
          effectiveFrom: REVISION_SENTINEL_DATE,
          priority: r.priority,
          value: r.value,
          authoredAt: 0,
        } satisfies CalendarRuleRevision,
      ],
    ]),
  );
}

/** Augment a legacy-style test fixture with synthesized revision tables
 *  + empty tombstone maps, matching what the v0.5 migration would
 *  produce on existing data. */
function withRevisions<
  S extends {
    rails?: Record<string, Rail>;
    calendarRules?: Record<string, CalendarRule>;
  },
>(
  state: S,
): S & {
  railRevisions: Record<string, RailRevision[]>;
  railTombstones: Record<string, never>;
  calendarRuleRevisions: Record<string, CalendarRuleRevision[]>;
  calendarRuleTombstones: Record<string, never>;
  taskOccurrences: Record<string, never>;
} {
  return {
    ...state,
    railRevisions: railRevisionsFor(Object.values(state.rails ?? {})),
    railTombstones: {},
    calendarRuleRevisions: calendarRuleRevisionsFor(
      Object.values(state.calendarRules ?? {}),
    ),
    calendarRuleTombstones: {},
    // ERD §10.6 v0.11 — selectors now consume `taskOccurrences`. The
    // legacy test suite exercises Task-only paths; default-empty
    // satisfies the type and keeps behavior identical for those tests.
    taskOccurrences: {},
  };
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
    const rows = selectTodayTimeline(withRevisions(state), TODAY_ISO);
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
    const rows = selectTodayTimeline(withRevisions(state), TODAY_ISO);
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
    const rows = selectTodayTimeline(withRevisions(state), TODAY_ISO);
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
    const rows = selectTodayTimeline(withRevisions(state), TODAY_ISO);
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
    const rows = selectTodayTimeline(withRevisions(state), TODAY_ISO);
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
    const rows = selectCheckinQueue(withRevisions(state), NOW);
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
    const rows = selectCheckinQueue(withRevisions(state), NOW);
    expect(rows).toEqual([]);
  });

  it('drops rails ended > 24 h ago (those move to the Pending queue)', () => {
    // Rail was yesterday morning, well beyond the 24 h check-in strip.
    const t = task({ id: 't1', railId: 'r1', date: '2026-04-18' });
    const state = { rails: mapById([r]), tasks: mapById([t]) };
    const rows = selectCheckinQueue(withRevisions(state), NOW);
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
    const rows = selectCheckinQueue(withRevisions(state), NOW);
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
      const rows = selectCheckinQueue(withRevisions(state), NOW);
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
    const rows = selectPendingQueue(withRevisions(state), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task.id).toBe('t1');
  });

  it('drops future-pending tasks (window has not ended)', () => {
    const t = task({ id: 't1', railId: 'r1', date: '2026-04-30' });
    const state = { rails: mapById([r]), tasks: mapById([t]) };
    const rows = selectPendingQueue(withRevisions(state), NOW);
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
    const rows = selectPendingQueue(withRevisions(state), NOW);
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
    const rows = selectPendingQueue(withRevisions(state), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task.id).toBe('inbox-deferred');
    expect(rows[0]?.rail).toBeUndefined();
  });

  it('skips done / archived / deleted', () => {
    const closedStatuses: Task['status'][] = ['done', 'archived', 'deleted'];
    for (const s of closedStatuses) {
      const t = task({ id: 't1', railId: 'r1', date: '2026-04-15', status: s });
      const state = { rails: mapById([r]), tasks: mapById([t]) };
      const rows = selectPendingQueue(withRevisions(state), NOW);
      expect(rows, `status=${s}`).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------
// toIsoDateTime — overnight (past-midnight) windows. Regression for
// the "T24:30" bug: minutes >= 1440 used to produce unparseable
// datetime strings (Date.parse → NaN) that silently dropped overnight
// rail tasks from the check-in strip and the Pending queue.
// ------------------------------------------------------------------

describe('toIsoDateTime', () => {
  it('formats same-day minutes unchanged', () => {
    expect(toIsoDateTime('2026-11-20', 90)).toBe('2026-11-20T01:30');
    expect(toIsoDateTime('2026-11-20', 23 * 60)).toBe('2026-11-20T23:00');
    expect(toIsoDateTime('2026-11-20', 0)).toBe('2026-11-20T00:00');
  });

  it('rolls minutes past midnight into the next calendar day', () => {
    // 23:00 rail + 120 min → ends 01:00 the NEXT day, not "T25:00".
    expect(toIsoDateTime('2026-11-20', 1380 + 120)).toBe('2026-11-21T01:00');
    expect(toIsoDateTime('2026-11-20', 1440)).toBe('2026-11-21T00:00');
  });

  it('rolls across month and year boundaries', () => {
    expect(toIsoDateTime('2026-11-30', 1470)).toBe('2026-12-01T00:30');
    expect(toIsoDateTime('2026-12-31', 1500)).toBe('2027-01-01T01:00');
  });

  it('always produces a Date.parse-able local datetime', () => {
    const s = toIsoDateTime('2026-04-18', 23 * 60 + 120);
    expect(Number.isNaN(Date.parse(s))).toBe(false);
  });
});

describe('overnight rails (start + duration past midnight)', () => {
  // 23:00–01:00 rail: the planned window ends at 01:00 the next day.
  const overnight = rail({
    id: 'r-night',
    templateKey: 'workday',
    startMinutes: 23 * 60,
    durationMinutes: 120,
  });

  it('check-in: surfaces a pending task once the (next-day) window ended', () => {
    // Slot on 2026-04-18 → window ends 2026-04-19T01:00. NOW is
    // 2026-04-19T12:00 → ended 11 h ago, inside the 24 h strip.
    // Before the rollover fix this row was silently dropped (NaN end).
    const t = task({ id: 't-night', railId: 'r-night', date: '2026-04-18' });
    const state = { rails: mapById([overnight]), tasks: mapById([t]) };
    const rows = selectCheckinQueue(withRevisions(state), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.plannedEnd).toBe('2026-04-19T01:00');
  });

  it('check-in: does NOT surface while tonight\'s window is still open', () => {
    // Slot on TODAY (2026-04-19) → ends 2026-04-20T01:00 > NOW.
    const t = task({ id: 't-tonight', railId: 'r-night', date: TODAY_ISO });
    const state = { rails: mapById([overnight]), tasks: mapById([t]) };
    expect(selectCheckinQueue(withRevisions(state), NOW)).toEqual([]);
  });

  it('pending queue: stale overnight task surfaces with a valid window', () => {
    const t = task({ id: 't-old', railId: 'r-night', date: '2026-04-15' });
    const state = { rails: mapById([overnight]), tasks: mapById([t]) };
    const rows = selectPendingQueue(withRevisions(state), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.plannedStart).toBe('2026-04-15T23:00');
    expect(rows[0]?.plannedEnd).toBe('2026-04-16T01:00');
  });
});

// ------------------------------------------------------------------
// Deleted (tombstoned) rails — §5.7 "master list / no hidden rows".
// A pending task whose slot points at a rail that no longer resolves
// on the slot's date must fall back to a rail-less Pending row rather
// than silently disappearing from every scheduling surface.
// ------------------------------------------------------------------

describe('pending tasks on deleted (tombstoned) rails', () => {
  const r = rail({
    id: 'r1',
    templateKey: 'workday',
    startMinutes: 8 * 60,
    durationMinutes: 60,
  });
  const tombstoned = <
    S extends {
      rails?: Record<string, Rail>;
      calendarRules?: Record<string, CalendarRule>;
    },
  >(
    state: S,
  ) => ({
    ...withRevisions(state),
    railTombstones: { r1: { effectiveFrom: '2026-04-01', at: 0 } },
  });

  it('pending queue: surfaces a rail-less row instead of dropping the task', () => {
    const t = task({ id: 't1', railId: 'r1', date: '2026-04-15' });
    const rows = selectPendingQueue(
      tombstoned({ rails: mapById([r]), tasks: mapById([t]) }),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task.id).toBe('t1');
    expect(rows[0]?.rail).toBeUndefined();
    expect(rows[0]?.plannedStart).toBeUndefined();
  });

  it('pending queue: surfaces future-dated slots too (the schedule is void)', () => {
    // With the rail gone there is no window to wait for — the task
    // needs a re-scheduling decision now.
    const t = task({ id: 't-future', railId: 'r1', date: '2026-04-30' });
    const rows = selectPendingQueue(
      tombstoned({ rails: mapById([r]), tasks: mapById([t]) }),
      NOW,
    );
    expect(rows.map((row) => row.task.id)).toEqual(['t-future']);
  });

  it('pending queue: deferred task on a dead rail keeps surfacing (rail-less)', () => {
    const t = task({
      id: 't-def',
      railId: 'r1',
      date: '2026-04-15',
      status: 'deferred',
    });
    const rows = selectPendingQueue(
      tombstoned({ rails: mapById([r]), tasks: mapById([t]) }),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rail).toBeUndefined();
  });

  it('pending queue: occurrence slots on a dead rail surface rail-less rows', () => {
    const host = task({ id: 't-host' });
    const occ: TaskOccurrence = {
      id: 'occ-1',
      taskId: 't-host',
      slot: { cycleId: 'cycle-2026-04-15', date: '2026-04-15', railId: 'r1' },
      status: 'pending',
      order: 0,
    };
    const base = tombstoned({ rails: mapById([r]), tasks: mapById([host]) });
    const rows = selectPendingQueue(
      { ...base, taskOccurrences: mapById([occ]) },
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrence?.id).toBe('occ-1');
    expect(rows[0]?.rail).toBeUndefined();
  });

  it('slots BEFORE the tombstone date still resolve the historical rail', () => {
    // effectiveFrom = 2026-04-01 → a slot on 2026-03-30 predates the
    // deletion; the sentinel revision still resolves and the row stays
    // rail-bound.
    const t = task({ id: 't-old', railId: 'r1', date: '2026-03-30' });
    const rows = selectPendingQueue(
      tombstoned({ rails: mapById([r]), tasks: mapById([t]) }),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rail?.id).toBe('r1');
  });

  it('check-in stays rail-bound: dead-rail tasks go to Pending, not the strip', () => {
    const t = task({ id: 't1', railId: 'r1', date: TODAY_ISO });
    const rows = selectCheckinQueue(
      tombstoned({ rails: mapById([r]), tasks: mapById([t]) }),
      NOW,
    );
    expect(rows).toEqual([]);
  });
});
