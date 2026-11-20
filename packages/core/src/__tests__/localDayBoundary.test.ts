// Local-day-boundary regression tests. `todayIso()` (store.ts) must
// return the LOCAL calendar day, not the UTC day — slot dates,
// effectiveFrom and tombstone dates are all local wall-clock strings
// (today.ts conventions). With the UTC implementation, every non-UTC
// timezone had a daily |UTC-offset|-hour window around local midnight
// where:
//   - the §5.5.6 reschedule/unschedule "today or overdue" gate
//     compared a local slot date against the UTC day and judged it a
//     day off (swallowing or fabricating Shifts), and
//   - no-effectiveFrom tombstones/revisions landed on the wrong day
//     (deleting a rail at 00:30 UTC+8 erased *yesterday's* history).
//
// Timezone control: `process.env.TZ` reassignment re-reads the zone on
// macOS/Linux Node (what CI runs); instants are pinned with
// `vi.setSystemTime` using explicit `Z` timestamps so the tests are
// deterministic regardless of the host zone.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { TOP_LEVEL_MAPS } from '@dayrail/db/yjs';
import { getYDoc, useStore } from '../store';
import { railAtDate } from '../revisions';
import type { Task } from '../types';

vi.mock('@dayrail/db/yjsPersistence', () => ({
  loadYDocBytes: async () => null,
  saveYDocBytes: async () => {},
}));

const ORIGINAL_TZ = process.env.TZ;

function setClock(tz: string, instantIso: string): void {
  process.env.TZ = tz;
  vi.setSystemTime(new Date(instantIso));
}

function pendingTask(id: string, slotDate: string): Task {
  return {
    id,
    lineId: 'line-inbox',
    title: id,
    order: 0,
    status: 'pending',
    slot: { cycleId: `cycle-${slotDate}`, date: slotDate, railId: 'am' },
  };
}

function shiftsFor(taskId: string) {
  return Object.values(useStore.getState().shifts).filter(
    (s) => s.taskId === taskId,
  );
}

beforeAll(async () => {
  await useStore.getState().hydrate();
});

beforeEach(() => {
  vi.useFakeTimers();
  const doc = getYDoc();
  doc.transact(() =>
    TOP_LEVEL_MAPS.forEach((name) => doc.getMap(name).clear()),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('§5.5.6 gate uses the local day, not the UTC day', () => {
  it('UTC+8 00:30: rescheduling TODAY\'s task emits a reschedule Shift', async () => {
    // 2026-11-20T16:30Z = 2026-11-21 00:30 in Asia/Shanghai. The UTC
    // day is still 11-20, so the old gate judged the 11-21 slot
    // "strictly future" and swallowed the Shift.
    setClock('Asia/Shanghai', '2026-11-20T16:30:00Z');
    await useStore.getState().createTask(pendingTask('t-cn', '2026-11-21'));
    await useStore.getState().scheduleTaskToRail('t-cn', {
      cycleId: 'cycle-2026-11-25',
      date: '2026-11-25',
      railId: 'am',
    });
    const shifts = shiftsFor('t-cn');
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.type).toBe('reschedule');
    expect(shifts[0]?.payload['fromDate']).toBe('2026-11-21');
  });

  it('UTC-5 19:30: rescheduling TOMORROW\'s task stays silent', async () => {
    // 2026-11-21T00:30Z = 2026-11-20 19:30 in America/New_York (EST).
    // The UTC day is already 11-21, so the old gate treated the
    // strictly-future 11-21 slot as "today" and fabricated a Shift.
    setClock('America/New_York', '2026-11-21T00:30:00Z');
    await useStore.getState().createTask(pendingTask('t-ny', '2026-11-21'));
    await useStore.getState().scheduleTaskToRail('t-ny', {
      cycleId: 'cycle-2026-11-25',
      date: '2026-11-25',
      railId: 'am',
    });
    expect(shiftsFor('t-ny')).toEqual([]);
  });

  it('UTC-5 19:30: free-time rescheduling TOMORROW\'s task stays silent', async () => {
    setClock('America/New_York', '2026-11-21T00:30:00Z');
    await useStore.getState().createTask(pendingTask('t-ny-ft', '2026-11-21'));
    await useStore.getState().scheduleTaskFreeTime('t-ny-ft', {
      date: '2026-11-25',
      startMinutes: 9 * 60,
      durationMinutes: 30,
    });
    expect(shiftsFor('t-ny-ft')).toEqual([]);
  });

  it('UTC+8 00:30: unscheduling TODAY\'s task emits an unschedule Shift', async () => {
    setClock('Asia/Shanghai', '2026-11-20T16:30:00Z');
    await useStore.getState().createTask(pendingTask('t-cn-un', '2026-11-21'));
    await useStore.getState().unscheduleTask('t-cn-un');
    const shifts = shiftsFor('t-cn-un');
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.type).toBe('unschedule');
  });

  it('UTC-5 19:30: unscheduling TOMORROW\'s task stays silent', async () => {
    setClock('America/New_York', '2026-11-21T00:30:00Z');
    await useStore.getState().createTask(pendingTask('t-ny-un', '2026-11-21'));
    await useStore.getState().unscheduleTask('t-ny-un');
    expect(shiftsFor('t-ny-un')).toEqual([]);
  });
});

describe('no-effectiveFrom defaults land on the local day', () => {
  it('UTC+8 00:30: deleting a rail tombstones TODAY, preserving yesterday\'s history', async () => {
    setClock('Asia/Shanghai', '2026-11-20T16:30:00Z'); // local 2026-11-21 00:30
    await useStore.getState().createRail(
      {
        id: 'r-x',
        templateKey: 'workday',
        name: 'Rail X',
        startMinutes: 9 * 60,
        durationMinutes: 60,
        color: 'sand',
        showInCheckin: true,
      },
      undefined,
      '2026-11-01',
    );
    await useStore.getState().deleteRail('r-x');
    const state = useStore.getState();
    // Old behavior: effectiveFrom = UTC '2026-11-20' → yesterday's
    // (local) Cycle history reads the rail as nonexistent.
    expect(state.railTombstones['r-x']?.effectiveFrom).toBe('2026-11-21');
    expect(railAtDate(state, 'r-x', '2026-11-20')).toBeDefined();
    expect(railAtDate(state, 'r-x', '2026-11-21')).toBeUndefined();
  });
});
