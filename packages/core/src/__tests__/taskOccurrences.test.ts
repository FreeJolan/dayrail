// ERD §10.6 v0.11 — Task occurrences. Pure-function tests covering
// the derivation helpers and the legacy/managed adoption gate. The
// store-action behavior (slot conversion edge case, GC, subItems
// migration) is exercised separately in yjs.test.ts roundtrips and
// won't be re-tested here — those paths already pass via the existing
// 227-test baseline.

import { describe, expect, it } from 'vitest';
import {
  deriveTaskProgress,
  deriveTaskStatus,
  isOccurrenceManaged,
  type Task,
  type TaskOccurrence,
} from '../types';

const TASK: Task = {
  id: 'task-x',
  lineId: 'line-x',
  title: 'Write the chapter',
  order: 0,
  status: 'pending',
};

function occ(partial: Partial<TaskOccurrence> & { id: string }): TaskOccurrence {
  return {
    taskId: TASK.id,
    status: 'pending',
    ...partial,
  };
}

describe('isOccurrenceManaged', () => {
  it('false for empty occurrence list', () => {
    expect(isOccurrenceManaged([])).toBe(false);
  });

  it('false for label-only / pure checklist occurrences', () => {
    expect(
      isOccurrenceManaged([
        occ({ id: 'o1', label: 'outline' }),
        occ({ id: 'o2', label: 'draft' }),
      ]),
    ).toBe(false);
  });

  it('true when any occurrence carries a slot', () => {
    expect(
      isOccurrenceManaged([
        occ({ id: 'o1', label: 'outline' }),
        occ({
          id: 'o2',
          slot: { cycleId: 'cycle-2026-05-14', date: '2026-05-14', railId: 'r1' },
        }),
      ]),
    ).toBe(true);
  });

  it('true when any occurrence carries a percent', () => {
    expect(
      isOccurrenceManaged([occ({ id: 'o1', label: 'half done', percent: 50 })]),
    ).toBe(true);
  });
});

describe('deriveTaskStatus', () => {
  it('returns task.status verbatim when not occurrence-managed', () => {
    expect(deriveTaskStatus({ ...TASK, status: 'done' }, [])).toBe('done');
    expect(
      deriveTaskStatus({ ...TASK, status: 'archived' }, [
        occ({ id: 'o', label: 'pure checklist' }),
      ]),
    ).toBe('archived');
  });

  it('derives done when every managed occurrence is done', () => {
    expect(
      deriveTaskStatus(TASK, [
        occ({ id: 'o1', percent: 50, status: 'done' }),
        occ({ id: 'o2', percent: 100, status: 'done' }),
      ]),
    ).toBe('done');
  });

  it('does NOT treat percent=100 as done — percent is a milestone marker only', () => {
    // ERD §10.6 — percent and status are decoupled. A pending occurrence
    // with percent=100 means "the 100% milestone, not yet completed",
    // not "auto-completed because it hit 100".
    expect(
      deriveTaskStatus(TASK, [
        occ({ id: 'o1', percent: 100, status: 'pending' }),
      ]),
    ).toBe('pending');
  });

  it('derives in-progress when there is a mix of done + pending', () => {
    expect(
      deriveTaskStatus(TASK, [
        occ({ id: 'o1', percent: 50, status: 'done' }),
        occ({ id: 'o2', percent: 70, status: 'pending' }),
      ]),
    ).toBe('in-progress');
  });

  it('derives pending when all managed occurrences are pending', () => {
    expect(
      deriveTaskStatus(TASK, [
        occ({
          id: 'o1',
          slot: { cycleId: 'c', date: '2026-05-14', railId: 'r' },
        }),
      ]),
    ).toBe('pending');
  });

  it('archived occurrences are excluded from rollup', () => {
    expect(
      deriveTaskStatus(TASK, [
        occ({ id: 'o1', percent: 50, status: 'archived' }),
        occ({ id: 'o2', percent: 100, status: 'done' }),
      ]),
    ).toBe('done');
  });

  it('keeps `deleted` task status terminal regardless of occurrences', () => {
    expect(
      deriveTaskStatus({ ...TASK, status: 'deleted' }, [
        occ({ id: 'o1', percent: 100, status: 'done' }),
      ]),
    ).toBe('deleted');
  });
});

describe('deriveTaskProgress', () => {
  it('falls back to task.milestonePercent when not managed', () => {
    expect(
      deriveTaskProgress({ ...TASK, milestonePercent: 30 }, []),
    ).toBe(30);
  });

  it('returns max-of-done-occurrence percent (high-water mark)', () => {
    expect(
      deriveTaskProgress(TASK, [
        occ({ id: 'o1', percent: 50, status: 'done' }),
        occ({ id: 'o2', percent: 100, status: 'done' }),
        occ({ id: 'o3', percent: 70, status: 'pending' }),
      ]),
    ).toBe(100);
  });

  it('ignores pending occurrences when computing progress', () => {
    expect(
      deriveTaskProgress(TASK, [
        occ({ id: 'o1', percent: 30, status: 'done' }),
        occ({ id: 'o2', percent: 90, status: 'pending' }),
      ]),
    ).toBe(30);
  });

  it('falls back to task.milestonePercent when no done occurrence carries percent', () => {
    expect(
      deriveTaskProgress(
        { ...TASK, milestonePercent: 25 },
        [
          occ({ id: 'o1', label: 'no percent', status: 'done' }),
          occ({
            id: 'o2',
            slot: { cycleId: 'c', date: '2026-05-14', railId: 'r' },
            status: 'pending',
          }),
        ],
      ),
    ).toBe(25);
  });
});

describe('migration safety', () => {
  it('label-only occurrences leave Task.status authoritative (subItems migration shape)', () => {
    // Simulates the v0.11 hydrate-time migration: pre-existing
    // subItems mapped one-shot to label-only / unscheduled occurrences.
    // The user's prior `Task.status` MUST stay authoritative — flipping
    // it to derived would create surprise regressions.
    const migrated: TaskOccurrence[] = [
      occ({ id: 'occ-task-x-s1', label: '步骤 1', status: 'done', order: 0 }),
      occ({ id: 'occ-task-x-s2', label: '步骤 2', status: 'pending', order: 1 }),
    ];
    expect(isOccurrenceManaged(migrated)).toBe(false);
    expect(
      deriveTaskStatus({ ...TASK, status: 'pending' }, migrated),
    ).toBe('pending');
    expect(
      deriveTaskStatus({ ...TASK, status: 'done' }, migrated),
    ).toBe('done');
  });

  it('adopting one occurrence (gives it a slot) flips into managed mode', () => {
    const occs: TaskOccurrence[] = [
      occ({ id: 'a', label: '步骤 1' }),
      occ({
        id: 'b',
        label: '步骤 2',
        slot: { cycleId: 'c', date: '2026-05-14', railId: 'r' },
      }),
    ];
    expect(isOccurrenceManaged(occs)).toBe(true);
    // a is pending (no slot, no done), b is pending (slot set, status pending)
    // → all pending, archived path doesn't apply → derived = pending.
    expect(deriveTaskStatus(TASK, occs)).toBe('pending');
  });
});
