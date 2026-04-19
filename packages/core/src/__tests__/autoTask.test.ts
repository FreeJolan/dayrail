import { describe, expect, it } from 'vitest';
import {
  findAffectedFutureAutoTasks,
  findAffectedFutureAutoTasksForRail,
} from '../autoTask';
import type { HabitBinding, Rail, Task } from '../types';

// §10.3 is the destructive path: it decides which auto-tasks get
// hard-deleted when a rail / binding edit lands. Missing a case means
// user notes on tasks that shouldn't have been purged get lost, or
// stale tasks survive a config change. Pure selectors — easy to cover
// exhaustively without touching the real store.

const NOW = new Date('2026-04-19T12:00:00');

// Helper builders — keep tests readable.
function rail(overrides: Partial<Rail> & { id: string }): Rail {
  return {
    templateKey: 'workday',
    name: overrides.name ?? overrides.id,
    startMinutes: 9 * 60,
    durationMinutes: 60,
    color: 'indigo',
    showInCheckin: true,
    ...overrides,
  };
}

interface TaskBuildOpts {
  id: string;
  lineId: string;
  date: string;
  railId: string;
  status?: Task['status'];
  source?: Task['source'];
}

function task(opts: TaskBuildOpts): Task {
  return {
    id: opts.id,
    lineId: opts.lineId,
    title: opts.id,
    order: 0,
    status: opts.status ?? 'pending',
    slot: { cycleId: `cycle-${opts.date}`, date: opts.date, railId: opts.railId },
    ...(opts.source && { source: opts.source }),
  };
}

function binding(opts: {
  id: string;
  habitId: string;
  railId: string;
  weekdays?: number[];
}): HabitBinding {
  return {
    id: opts.id,
    habitId: opts.habitId,
    railId: opts.railId,
    createdAt: Date.parse('2026-04-01'),
    ...(opts.weekdays && { weekdays: opts.weekdays }),
  };
}

function mapById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

describe('findAffectedFutureAutoTasks', () => {
  const r = rail({ id: 'r1' });
  const rails = mapById([r]);

  it('returns a future pending auto-task for the habit', () => {
    const t = task({
      id: 'task-auto-h1-2026-04-25',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
    });
    const state = { rails, tasks: mapById([t]) };
    const got = findAffectedFutureAutoTasks(state, { habitId: 'h1' }, NOW);
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe(t.id);
  });

  it('skips tasks with plannedStart <= now — the user may already have acted on them', () => {
    const past = task({
      id: 'task-auto-h1-2026-04-10',
      lineId: 'h1',
      date: '2026-04-10',
      railId: 'r1',
      source: 'auto-habit',
    });
    // Same date as NOW — rail fires at 09:00 which is before NOW at 12:00.
    const today = task({
      id: 'task-auto-h1-2026-04-19',
      lineId: 'h1',
      date: '2026-04-19',
      railId: 'r1',
      source: 'auto-habit',
    });
    const state = { rails, tasks: mapById([past, today]) };
    const got = findAffectedFutureAutoTasks(state, { habitId: 'h1' }, NOW);
    expect(got).toHaveLength(0);
  });

  it('skips settled terminal states — done / deferred / archived stay intact', () => {
    const done = task({
      id: 'done',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
      status: 'done',
    });
    const deferred = task({
      id: 'deferred',
      lineId: 'h1',
      date: '2026-04-26',
      railId: 'r1',
      source: 'auto-habit',
      status: 'deferred',
    });
    const archived = task({
      id: 'archived',
      lineId: 'h1',
      date: '2026-04-27',
      railId: 'r1',
      source: 'auto-habit',
      status: 'archived',
    });
    const state = { rails, tasks: mapById([done, deferred, archived]) };
    const got = findAffectedFutureAutoTasks(state, { habitId: 'h1' }, NOW);
    expect(got).toEqual([]);
  });

  it('skips user-authored tasks — only auto-habit source is purge-eligible', () => {
    const handwritten = task({
      id: 'task-manual',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      // no source — user-authored
    });
    const auto = task({
      id: 'task-auto-h1-2026-04-26',
      lineId: 'h1',
      date: '2026-04-26',
      railId: 'r1',
      source: 'auto-habit',
    });
    const state = { rails, tasks: mapById([handwritten, auto]) };
    const got = findAffectedFutureAutoTasks(state, { habitId: 'h1' }, NOW);
    expect(got.map((t) => t.id)).toEqual(['task-auto-h1-2026-04-26']);
  });

  it('filters by habitId — a different habit on the same rail is out of scope', () => {
    const otherHabit = task({
      id: 'task-auto-h2-2026-04-25',
      lineId: 'h2',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
    });
    const ownHabit = task({
      id: 'task-auto-h1-2026-04-25',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
    });
    const state = { rails, tasks: mapById([otherHabit, ownHabit]) };
    const got = findAffectedFutureAutoTasks(state, { habitId: 'h1' }, NOW);
    expect(got.map((t) => t.id)).toEqual(['task-auto-h1-2026-04-25']);
  });

  it('scope.railId narrows further — only tasks on that rail match', () => {
    const railA = rail({ id: 'rA' });
    const railB = rail({ id: 'rB' });
    const onA = task({
      id: 'onA',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'rA',
      source: 'auto-habit',
    });
    const onB = task({
      id: 'onB',
      lineId: 'h1',
      date: '2026-04-26',
      railId: 'rB',
      source: 'auto-habit',
    });
    const state = {
      rails: mapById([railA, railB]),
      tasks: mapById([onA, onB]),
    };
    const got = findAffectedFutureAutoTasks(
      state,
      { habitId: 'h1', railId: 'rA' },
      NOW,
    );
    expect(got.map((t) => t.id)).toEqual(['onA']);
  });

  it('skips tasks missing slot or rail lookup — defensive guards', () => {
    const noSlot: Task = {
      id: 'orphan',
      lineId: 'h1',
      title: 'orphan',
      order: 0,
      status: 'pending',
      source: 'auto-habit',
    };
    const danglingRail = task({
      id: 'dangling',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'does-not-exist',
      source: 'auto-habit',
    });
    const state = { rails, tasks: mapById([noSlot, danglingRail]) };
    const got = findAffectedFutureAutoTasks(state, { habitId: 'h1' }, NOW);
    expect(got).toEqual([]);
  });

  it('deleted tasks are excluded even when source=auto-habit — they were already purged', () => {
    const deleted = task({
      id: 'purged',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
      status: 'deleted',
    });
    const state = { rails, tasks: mapById([deleted]) };
    const got = findAffectedFutureAutoTasks(state, { habitId: 'h1' }, NOW);
    expect(got).toEqual([]);
  });
});

describe('findAffectedFutureAutoTasksForRail', () => {
  const r1 = rail({ id: 'r1' });
  const r2 = rail({ id: 'r2' });
  const rails = mapById([r1, r2]);

  it('fans out across every habit bound to the rail', () => {
    const h1OnR1 = task({
      id: 'h1OnR1',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
    });
    const h2OnR1 = task({
      id: 'h2OnR1',
      lineId: 'h2',
      date: '2026-04-26',
      railId: 'r1',
      source: 'auto-habit',
    });
    const h3OnR2 = task({
      id: 'h3OnR2',
      lineId: 'h3',
      date: '2026-04-27',
      railId: 'r2',
      source: 'auto-habit',
    });
    const habitBindings = mapById([
      binding({ id: 'b1', habitId: 'h1', railId: 'r1' }),
      binding({ id: 'b2', habitId: 'h2', railId: 'r1' }),
      binding({ id: 'b3', habitId: 'h3', railId: 'r2' }),
    ]);
    const state = {
      rails,
      tasks: mapById([h1OnR1, h2OnR1, h3OnR2]),
      habitBindings,
    };
    const got = findAffectedFutureAutoTasksForRail(state, 'r1', NOW);
    expect(got.map((t) => t.id).sort()).toEqual(['h1OnR1', 'h2OnR1']);
  });

  it('returns empty when the rail has no bindings', () => {
    const t = task({
      id: 't',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
    });
    const state = {
      rails,
      tasks: mapById([t]),
      habitBindings: {},
    };
    const got = findAffectedFutureAutoTasksForRail(state, 'r1', NOW);
    expect(got).toEqual([]);
  });

  it('deduplicates via the (habitId, railId) scope — each habit contributes once', () => {
    // Two bindings for the same habit on the same rail (weekday-split
    // bindings are a normal shape). findAffectedFor should not
    // double-count the auto-tasks on that rail.
    const t = task({
      id: 'task-auto-h1-2026-04-25',
      lineId: 'h1',
      date: '2026-04-25',
      railId: 'r1',
      source: 'auto-habit',
    });
    const habitBindings = mapById([
      binding({ id: 'b1', habitId: 'h1', railId: 'r1', weekdays: [1] }),
      binding({ id: 'b2', habitId: 'h1', railId: 'r1', weekdays: [5] }),
    ]);
    const state = {
      rails,
      tasks: mapById([t]),
      habitBindings,
    };
    const got = findAffectedFutureAutoTasksForRail(state, 'r1', NOW);
    // The Set-based habitId collapse dedupes h1, so the task is
    // returned exactly once even though two bindings point here.
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe(t.id);
  });
});
