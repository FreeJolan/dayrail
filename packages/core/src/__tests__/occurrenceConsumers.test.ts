// ERD §10.6 consumer-alignment regressions (audit wave 3). Live-store
// tests for the write paths that still assumed the pre-v0.11 "Task is
// the scheduling atom" model:
//   - archiveTask's D7 cascade used the old slot/percent adoption gate,
//     so archiving a pure-label split task left its pending occurrences
//     surfacing everywhere (deriveTaskStatus kept rolling 'pending').
//   - purgeTask / purgeLine hard-deleted the Task but left its
//     occurrences orphaned in the doc + sync stream until the next
//     hydrate GC.
//   - the subItems→occurrence hydrate migration flipped tasks into
//     managed mode WITHOUT folding the legacy Task.slot, silently
//     dropping the visible schedule from Today/Cycle.
//   - scheduleTaskFreeTime emitted its reschedule Shift outside the
//     caller's Edit Session, so session undo rolled back the schedule
//     but left a ghost Shift record.
// Plus unit coverage for the shared `selectEffectiveTaskSlots` reader
// the UI layers now use instead of raw `task.slot`.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOP_LEVEL_MAPS, entityToYMap } from '@dayrail/db/yjs';
import { getYDoc, selectEffectiveTaskSlots, useStore } from '..';
import { INBOX_LINE_ID, type Task, type TaskOccurrence } from '../types';

vi.mock('@dayrail/db/yjsPersistence', () => ({
  loadYDocBytes: async () => null,
  saveYDocBytes: async () => undefined,
  quarantineYDocBytes: async () => null,
}));

function taskShape(partial: Partial<Task> & { id: string }): Task {
  return {
    lineId: INBOX_LINE_ID,
    title: partial.id,
    order: 0,
    status: 'pending',
    ...partial,
  };
}

function occsOf(taskId: string): TaskOccurrence[] {
  return Object.values(useStore.getState().taskOccurrences).filter(
    (o) => o.taskId === taskId,
  );
}

beforeAll(async () => {
  await useStore.getState().hydrate();
});

beforeEach(async () => {
  const doc = getYDoc();
  doc.transact(() =>
    TOP_LEVEL_MAPS.forEach((name) => doc.getMap(name).clear()),
  );
  useStore.setState({ sessions: {}, pendingShiftPrompt: null });
  await useStore.getState().createLine({
    id: INBOX_LINE_ID,
    name: 'Inbox',
    kind: 'project',
    status: 'active',
    isDefault: true,
    createdAt: 1,
  });
});

describe('archiveTask §10.6 D7 cascade (v0.11.4 managed definition)', () => {
  it('archives pending label-only occurrences — any occurrence means managed', async () => {
    const s = useStore.getState;
    await s().createTask(taskShape({ id: 'task-a', title: '组装电脑' }));
    const occPending = await s().addTaskOccurrence('task-a', { label: '步骤1' });
    const occDone = await s().addTaskOccurrence('task-a', { label: '步骤2' });
    await s().completeTaskOccurrence(occDone);

    await s().archiveTask('task-a');

    expect(s().tasks['task-a']?.status).toBe('archived');
    const byId = Object.fromEntries(occsOf('task-a').map((o) => [o.id, o]));
    // The old slot/percent gate skipped the cascade here: pure-label
    // splits stayed 'pending' and the task kept deriving to 'pending'.
    expect(byId[occPending]?.status).toBe('archived');
    expect(byId[occPending]?.archivedAt).toBeTruthy();
    // 'done' records the user actually did it — never rewritten.
    expect(byId[occDone]?.status).toBe('done');
  });
});

describe('purgeTask / purgeLine occurrence cascade', () => {
  it('purgeTask hard-deletes the task AND its occurrences', async () => {
    const s = useStore.getState;
    await s().createTask(taskShape({ id: 'task-p' }));
    await s().addTaskOccurrence('task-p', { label: 'a' });
    await s().addTaskOccurrence('task-p', { label: 'b' });
    await s().createTask(taskShape({ id: 'task-keep' }));
    const keepOcc = await s().addTaskOccurrence('task-keep', { label: 'keep' });

    await s().purgeTask('task-p');

    expect(s().tasks['task-p']).toBeUndefined();
    expect(occsOf('task-p')).toHaveLength(0);
    // Unrelated occurrences survive.
    expect(s().taskOccurrences[keepOcc]).toBeTruthy();
  });

  it('purgeLine cascades through its tasks to their occurrences', async () => {
    const s = useStore.getState;
    await s().createLine({
      id: 'line-x',
      name: 'Project X',
      kind: 'project',
      status: 'active',
      createdAt: 1,
    });
    await s().createTask(taskShape({ id: 'task-x1', lineId: 'line-x' }));
    await s().addTaskOccurrence('task-x1', { label: 'a' });
    await s().createTask(taskShape({ id: 'task-out' }));
    const outsideOcc = await s().addTaskOccurrence('task-out', { label: 'z' });

    await s().purgeLine('line-x');

    expect(s().tasks['task-x1']).toBeUndefined();
    expect(occsOf('task-x1')).toHaveLength(0);
    expect(s().taskOccurrences[outsideOcc]).toBeTruthy();
  });
});

describe('subItems→occurrence migration folds the legacy Task.slot', () => {
  const SLOT = { cycleId: 'cycle-2026-11-16', date: '2026-11-21', railId: 'am' };

  /** Simulate an older client's write: raw task with subItems + slot
   *  placed straight into the Y.Doc, bypassing the store actions. */
  function seedRawTask(id: string, extra: Record<string, unknown> = {}): void {
    const doc = getYDoc();
    doc.transact(() => {
      doc.getMap('tasks').set(
        id,
        entityToYMap({
          id,
          lineId: INBOX_LINE_ID,
          title: '报税',
          order: 0,
          status: 'pending',
          slot: SLOT,
          subItems: [{ id: 's1', title: '整理发票', done: false }],
          ...extra,
        }),
      );
    });
  }

  it('converts the slot into a deterministic sibling occurrence and clears Task.slot', async () => {
    seedRawTask('task-m');

    await useStore.getState().hydrate();

    const occs = occsOf('task-m');
    expect(occs.map((o) => o.id).sort()).toEqual([
      'occ-task-m-legacy-slot',
      'occ-task-m-s1',
    ]);
    const folded = useStore.getState().taskOccurrences['occ-task-m-legacy-slot'];
    expect(folded).toMatchObject({ taskId: 'task-m', status: 'pending', slot: SLOT });
    // The schedule visible before the hydrate survives the managed-mode
    // flip (previously task.slot stayed but every read path ignored it:
    // the task silently vanished from Today/Cycle).
    expect(useStore.getState().tasks['task-m']?.slot).toBeUndefined();
    expect(
      selectEffectiveTaskSlots(useStore.getState(), useStore.getState().tasks['task-m']!).map(
        (e) => e.slot,
      ),
    ).toEqual([SLOT]);
  });

  it('is idempotent across re-runs', async () => {
    seedRawTask('task-m');
    await useStore.getState().hydrate();
    const first = occsOf('task-m').map((o) => o.id).sort();

    await useStore.getState().hydrate();
    await useStore.getState().hydrate();

    expect(occsOf('task-m').map((o) => o.id).sort()).toEqual(first);
  });

  it('leaves the slot alone when a sibling occurrence already carries slot/percent', async () => {
    // Already-managed task (concurrent-merge shape): its dangling
    // Task.slot is the documented "selectors ignore it" case — the
    // migration must not graft it into a new occurrence.
    seedRawTask('task-n');
    const doc = getYDoc();
    doc.transact(() => {
      doc.getMap('taskOccurrences').set(
        'occ-task-n-existing',
        entityToYMap({
          id: 'occ-task-n-existing',
          taskId: 'task-n',
          status: 'pending',
          order: 0,
          slot: { cycleId: 'cycle-x', date: '2026-11-30', railId: 'pm' },
        }),
      );
    });

    await useStore.getState().hydrate();

    expect(useStore.getState().taskOccurrences['occ-task-n-legacy-slot']).toBeUndefined();
    expect(useStore.getState().tasks['task-n']?.slot).toEqual(SLOT);
  });
});

describe('scheduleTaskFreeTime reschedule Shift joins the Edit Session', () => {
  it('session undo rolls the Shift back together with the schedule', async () => {
    const s = useStore.getState;
    // Overdue rail slot → moving it to free time emits a reschedule
    // Shift (§5.5.6: priorDate <= today, date changed).
    await s().createTask(
      taskShape({
        id: 'task-ft',
        slot: { cycleId: 'cycle-2020-01-01', date: '2020-01-01', railId: 'am' },
      }),
    );
    const session = await s().openEditSession('test');

    await s().scheduleTaskFreeTime(
      'task-ft',
      { date: '2026-12-01', startMinutes: 540, durationMinutes: 60 },
      session.id,
    );

    const shifts = Object.values(s().shifts);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      taskId: 'task-ft',
      type: 'reschedule',
      payload: { fromDate: '2020-01-01', toDate: '2026-12-01' },
    });

    await s().undoEditSession(session.id);

    // Previously the Shift's transact ran under the default origin, so
    // the session UndoManager never tracked it: the schedule rolled
    // back but a ghost "reschedule that never happened" stayed behind.
    expect(Object.values(s().shifts)).toHaveLength(0);
    expect(s().tasks['task-ft']?.slot?.date).toBe('2020-01-01');
    expect(
      Object.values(s().adhocEvents).filter(
        (a) => a.taskId === 'task-ft' && a.status === 'active',
      ),
    ).toHaveLength(0);
  });
});

describe('selectEffectiveTaskSlots', () => {
  it('returns the legacy Task.slot for unmanaged tasks', () => {
    const slot = { cycleId: 'c', date: '2026-11-21', railId: 'am' };
    const t = taskShape({ id: 't', slot });
    expect(selectEffectiveTaskSlots({ taskOccurrences: {} }, t)).toEqual([
      { slot },
    ]);
    expect(
      selectEffectiveTaskSlots({ taskOccurrences: {} }, taskShape({ id: 'u' })),
    ).toEqual([]);
  });

  it('returns occurrence slots and ignores Task.slot in managed mode', () => {
    const danglingSlot = { cycleId: 'c', date: '2026-11-01', railId: 'am' };
    const occSlot = { cycleId: 'c', date: '2026-11-22', railId: 'pm' };
    const t = taskShape({ id: 't', slot: danglingSlot });
    const occurrences: Record<string, TaskOccurrence> = {
      o1: { id: 'o1', taskId: 't', status: 'pending', order: 0, slot: occSlot },
      o2: { id: 'o2', taskId: 't', status: 'pending', order: 1 }, // slot-less
    };
    const entries = selectEffectiveTaskSlots({ taskOccurrences: occurrences }, t);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ slot: occSlot });
    expect(entries[0]?.occurrence?.id).toBe('o1');
  });
});
