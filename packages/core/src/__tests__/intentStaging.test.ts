import { describe, expect, it } from 'vitest';
import {
  commitDraft,
  toggleDraftKind,
  type HabitDraft,
  type StagingWriters,
  type TaskDraft,
} from '../intentStaging';

// Deterministic id minter so tests can assert intra-batch references.
function counterGen(): (prefix: string) => string {
  const counts: Record<string, number> = {};
  return (prefix) => {
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    return `${prefix}-${counts[prefix]}`;
  };
}

interface Call {
  op: string;
  sessionId?: string;
  arg?: unknown;
}

// Recording mock writers — commitDraft only ever calls create/bind/add
// (add-only is structural; there is no update/delete writer).
function recordingWriters(): { writers: StagingWriters; calls: Call[] } {
  const calls: Call[] = [];
  let n = 0;
  const writers: StagingWriters = {
    openSession: async (surface) => {
      n += 1;
      calls.push({ op: 'open', arg: surface });
      return { id: `sess-${n}` };
    },
    closeSession: async (sessionId) => calls.push({ op: 'close', sessionId }) as unknown as void,
    createLine: async (line, sessionId) =>
      calls.push({ op: 'createLine', sessionId, arg: line }) as unknown as void,
    createRail: async (rail, sessionId, ef) =>
      calls.push({ op: 'createRail', sessionId, arg: { rail, ef } }) as unknown as void,
    bindHabit: async (opts, sessionId) =>
      calls.push({ op: 'bindHabit', sessionId, arg: opts }) as unknown as void,
    createTask: async (task, sessionId) =>
      calls.push({ op: 'createTask', sessionId, arg: task }) as unknown as void,
    addOccurrence: async (taskId, occ, sessionId) =>
      calls.push({ op: 'addOccurrence', sessionId, arg: { taskId, occ } }) as unknown as void,
    scheduleTask: async (taskId, slot, sessionId) =>
      calls.push({ op: 'scheduleTask', sessionId, arg: { taskId, slot } }) as unknown as void,
  };
  return { writers, calls };
}

const TASK: TaskDraft = {
  kind: 'task',
  title: '写季度总结初稿',
  lineId: 'line-inbox',
  priority: 'P1',
  note: '先列提纲',
  steps: [{ label: '提纲' }, { label: '初稿', percent: 50 }],
};

const HABIT: HabitDraft = {
  kind: 'habit',
  name: '冥想',
  effectiveFrom: '2026-05-25',
  slots: [
    { mode: 'new', startMinutes: 420, durationMinutes: 5, weekdays: [1, 2, 3, 4, 5] },
    { mode: 'existing', railId: 'rail-evening' },
  ],
};

describe('commitDraft · task', () => {
  it('creates the task + an occurrence per step; one session; add-only', async () => {
    const { writers, calls } = recordingWriters();
    const sid = await commitDraft(TASK, writers, { genId: counterGen() });
    expect(calls.map((c) => c.op)).toEqual([
      'open',
      'createTask',
      'addOccurrence',
      'addOccurrence',
      'close',
    ]);
    const task = calls.find((c) => c.op === 'createTask')?.arg as Record<string, unknown>;
    expect(task).toMatchObject({
      title: '写季度总结初稿',
      lineId: 'line-inbox',
      priority: 'P1',
      note: '先列提纲',
      status: 'pending',
    });
    const occs = calls
      .filter((c) => c.op === 'addOccurrence')
      .map((c) => (c.arg as { occ: { label?: string; percent?: number } }).occ);
    expect(occs.map((o) => o.label)).toEqual(['提纲', '初稿']);
    expect(occs[0]?.percent).toBeUndefined();
    expect(occs[1]?.percent).toBe(50); // milestone carried through
    for (const c of calls.slice(1, -1)) expect(c.sessionId).toBe(sid);
    expect(calls.every((c) => !/update|delete|remove/i.test(c.op))).toBe(true);
  });

  it('skips blank steps', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(
      {
        kind: 'task',
        title: 'x',
        lineId: 'line-inbox',
        steps: [{ label: '' }, { label: '  ' }, { label: '真步骤' }],
      },
      writers,
      { genId: counterGen() },
    );
    expect(calls.filter((c) => c.op === 'addOccurrence')).toHaveLength(1);
  });
});

describe('commitDraft · habit', () => {
  it('new slot → createRail + bind; existing slot → bind only', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(HABIT, writers, { genId: counterGen(), now: 0 });
    expect(calls.map((c) => c.op)).toEqual([
      'open',
      'createLine',
      'createRail',
      'bindHabit',
      'bindHabit',
      'close',
    ]);
    const railArg = calls.find((c) => c.op === 'createRail')?.arg as {
      rail: { id: string; startMinutes: number; durationMinutes: number; templateKey: string };
      ef?: string;
    };
    expect(railArg.rail).toMatchObject({ startMinutes: 420, durationMinutes: 5, templateKey: 'workday' });
    expect(railArg.ef).toBe('2026-05-25');

    const line = calls.find((c) => c.op === 'createLine')?.arg as { id: string };
    const binds = calls
      .filter((c) => c.op === 'bindHabit')
      .map((c) => c.arg as { habitId: string; railId: string; weekdays?: number[]; effectiveFrom?: string });
    for (const b of binds) expect(b.habitId).toBe(line.id);
    // first bind = the just-created rail (carries weekdays); second = existing
    expect(binds[0]?.railId).toBe(railArg.rail.id);
    expect(binds[0]?.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(binds[1]?.railId).toBe('rail-evening');
    expect(binds.every((b) => b.effectiveFrom === '2026-05-25')).toBe(true);
  });

  it('skips an existing slot with no rail chosen', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(
      { kind: 'habit', name: 'x', slots: [{ mode: 'existing', railId: '' }] },
      writers,
      { genId: counterGen() },
    );
    expect(calls.map((c) => c.op)).toEqual(['open', 'createLine', 'close']);
  });

  it('every-day new slot (no templateKeys) → a rail + bind per template', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(
      { kind: 'habit', name: '冥想', slots: [{ mode: 'new', startMinutes: 420 }] },
      writers,
      { genId: counterGen(), allTemplateKeys: ['workday', 'restday'] },
    );
    const railTemplates = calls
      .filter((c) => c.op === 'createRail')
      .map((c) => (c.arg as { rail: { templateKey: string } }).rail.templateKey);
    expect(railTemplates).toEqual(['workday', 'restday']);
    expect(calls.filter((c) => c.op === 'bindHabit')).toHaveLength(2);
  });

  it('workday-only new slot → exactly one workday rail', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(
      {
        kind: 'habit',
        name: '冥想',
        slots: [{ mode: 'new', startMinutes: 420, templateKeys: ['workday'] }],
      },
      writers,
      { genId: counterGen(), allTemplateKeys: ['workday', 'restday'] },
    );
    const railTemplates = calls
      .filter((c) => c.op === 'createRail')
      .map((c) => (c.arg as { rail: { templateKey: string } }).rail.templateKey);
    expect(railTemplates).toEqual(['workday']);
    expect(calls.filter((c) => c.op === 'bindHabit')).toHaveLength(1);
  });
});

describe('commitDraft · task scheduling', () => {
  it('existing-rail schedule → scheduleTask with the chosen rail + date, no new rail', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(
      {
        kind: 'task',
        title: 'x',
        lineId: 'line-inbox',
        steps: [],
        schedule: { mode: 'existing', railId: 'rail-am', date: '2026-05-25' },
      },
      writers,
      { genId: counterGen() },
    );
    const sched = calls.find((c) => c.op === 'scheduleTask')?.arg as {
      slot: { date: string; railId: string; cycleId: string };
    };
    expect(sched.slot.railId).toBe('rail-am');
    expect(sched.slot.date).toBe('2026-05-25');
    expect(typeof sched.slot.cycleId).toBe('string');
    expect(calls.some((c) => c.op === 'createRail')).toBe(false);
  });

  it('new-rail schedule → createRail then scheduleTask onto it', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(
      {
        kind: 'task',
        title: 'x',
        lineId: 'line-inbox',
        steps: [],
        schedule: { mode: 'new', startMinutes: 540, templateKey: 'workday', date: '2026-05-25' },
      },
      writers,
      { genId: counterGen() },
    );
    const rail = calls.find((c) => c.op === 'createRail')?.arg as {
      rail: { id: string; templateKey: string };
    };
    expect(rail.rail.templateKey).toBe('workday');
    const sched = calls.find((c) => c.op === 'scheduleTask')?.arg as { slot: { railId: string } };
    expect(sched.slot.railId).toBe(rail.rail.id);
  });

  it('defaults the schedule date to today when omitted', async () => {
    const { writers, calls } = recordingWriters();
    await commitDraft(
      {
        kind: 'task',
        title: 'x',
        lineId: 'line-inbox',
        steps: [],
        schedule: { mode: 'existing', railId: 'rail-am' },
      },
      writers,
      { genId: counterGen(), today: '2026-05-25' },
    );
    const sched = calls.find((c) => c.op === 'scheduleTask')?.arg as { slot: { date: string } };
    expect(sched.slot.date).toBe('2026-05-25');
  });
});

describe('toggleDraftKind', () => {
  it('task → habit carries title→name + note', () => {
    const h = toggleDraftKind(TASK);
    expect(h).toMatchObject({ kind: 'habit', name: '写季度总结初稿', note: '先列提纲', slots: [] });
  });
  it('habit → task carries name→title + note, lands in Inbox', () => {
    const t = toggleDraftKind(HABIT);
    expect(t).toMatchObject({ kind: 'task', title: '冥想', lineId: 'line-inbox', steps: [] });
  });
});
