// Regression tests for the effective-from revision ordering
// invariant (ERD §10.5). `pickActive` (revisions.ts) assumes each
// entity's revision array is ASC by `effectiveFrom` and early-breaks
// on the first entry past the queried date.
//
// The old `appendRevision` always pushed to the array tail (same-id
// replacement was "delete in place + push to end"), so the UI flow
// "create → edit effective-from-tomorrow → edit effective-from-today"
// produced [tomorrow, today]: `railAtDate(today)` hit the tomorrow
// entry first, broke, and returned undefined — the rail (and its
// tasks) vanished from Today/Cycle/check-in for the day, with the
// mis-ordered array persisted in the Y.Doc forever. Multi-device
// Y.Array merges interleave by clientID, which is equally unordered.
//
// The fix is defended at both ends and both are pinned here:
//   · write side — appendRevision does a sorted insert;
//   · read side — readFlatStateFromDoc → dedupRevisions stable-sorts
//     ASC by effectiveFrom, self-healing legacy out-of-order arrays
//     and multi-device interleavings.

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createYDoc,
  readFlatStateFromDoc,
  TOP_LEVEL_MAPS,
} from '@dayrail/db/yjs';
import { getYDoc, useStore, type DayRailState } from '../store';
import { railAtDate } from '../revisions';
import type { Rail } from '../types';

type RailReadState = Pick<DayRailState, 'railRevisions' | 'railTombstones'>;

function railStateFromDoc(doc: Y.Doc): RailReadState {
  const flat = readFlatStateFromDoc(doc);
  return {
    railRevisions: flat.railRevisions,
    railTombstones: flat.railTombstones,
  } as unknown as RailReadState;
}

function rev(
  railId: string,
  effectiveFrom: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `rev-rail-${railId}-${effectiveFrom}`,
    railId,
    effectiveFrom,
    templateKey: 'workday',
    name: `v@${effectiveFrom}`,
    startMinutes: 540,
    durationMinutes: 60,
    color: 'sand',
    showInCheckin: true,
    authoredAt: 0,
    ...extra,
  };
}

const RAIL: Rail = {
  id: 'r1',
  templateKey: 'workday',
  name: 'Deep work',
  startMinutes: 540,
  durationMinutes: 60,
  color: 'sand',
  showInCheckin: true,
};

beforeEach(() => {
  // The store's Y.Doc is a module singleton; start each test from an
  // empty visible state.
  const doc = getYDoc();
  doc.transact(() => {
    for (const name of TOP_LEVEL_MAPS) doc.getMap(name).clear();
  });
});

describe('appendRevision · sorted insert (write-side defense)', () => {
  it('create → tomorrow edit → today edit keeps the Y.Array ASC and the rail visible today', async () => {
    const { createRail, updateRail } = useStore.getState();
    await createRail(RAIL, undefined, '2026-11-20');
    await updateRail('r1', { startMinutes: 600 }, undefined, '2026-11-21');
    // The same-day re-edit replaces the 11-20 revision; before the
    // fix it was re-pushed to the tail, AFTER the 11-21 entry.
    await updateRail('r1', { name: 'Renamed' }, undefined, '2026-11-20');

    // Raw Y.Array order — pins the sorted insert itself, independent
    // of the read path's defensive re-sort.
    const yarr = getYDoc().getMap('railRevisions').get('r1') as Y.Array<{
      effectiveFrom: string;
    }>;
    expect(yarr.toArray().map((r) => r.effectiveFrom)).toEqual([
      '2026-11-20',
      '2026-11-21',
    ]);

    const state = railStateFromDoc(getYDoc());
    // The bug: railAtDate(today) returned undefined → rail vanished.
    const today = railAtDate(state, 'r1', '2026-11-20');
    expect(today).toBeDefined();
    expect(today?.name).toBe('Renamed');
    // Tomorrow resolves to the tomorrow-dated revision.
    const tomorrow = railAtDate(state, 'r1', '2026-11-21');
    expect(tomorrow?.effectiveFrom).toBe('2026-11-21');
    expect(tomorrow?.startMinutes).toBe(600);
  });

  it('a backdated revision is inserted before later-dated ones', async () => {
    const { createRail, updateRail } = useStore.getState();
    await createRail(RAIL, undefined, '2026-11-20');
    await updateRail('r1', { name: 'Backdated' }, undefined, '2026-11-01');

    const yarr = getYDoc().getMap('railRevisions').get('r1') as Y.Array<{
      effectiveFrom: string;
    }>;
    expect(yarr.toArray().map((r) => r.effectiveFrom)).toEqual([
      '2026-11-01',
      '2026-11-20',
    ]);
    const state = railStateFromDoc(getYDoc());
    expect(railAtDate(state, 'r1', '2026-11-05')?.name).toBe('Backdated');
    expect(railAtDate(state, 'r1', '2026-11-20')?.name).toBe('Deep work');
  });
});

describe('read-path self-heal (legacy + multi-device data)', () => {
  it('heals a persisted out-of-order array written by pre-fix clients', () => {
    // Simulate what the old append-to-tail left in the Y.Doc:
    // [tomorrow, today].
    const doc = getYDoc();
    doc.transact(() => {
      const arr = new Y.Array<unknown>();
      arr.push([rev('r1', '2026-11-21'), rev('r1', '2026-11-20')]);
      doc.getMap('railRevisions').set('r1', arr);
    });

    const state = railStateFromDoc(doc);
    expect(
      (state.railRevisions['r1'] ?? []).map((r) => r.effectiveFrom),
    ).toEqual(['2026-11-20', '2026-11-21']);
    expect(railAtDate(state, 'r1', '2026-11-20')?.effectiveFrom).toBe(
      '2026-11-20',
    );
    expect(railAtDate(state, 'r1', '2026-11-22')?.effectiveFrom).toBe(
      '2026-11-21',
    );
  });

  it('two devices appending concurrently read back date-ordered on both, regardless of merge interleave', () => {
    const docA = createYDoc();
    docA.transact(() => {
      const arr = new Y.Array<unknown>();
      arr.push([rev('r1', '2026-01-01')]);
      docA.getMap('railRevisions').set('r1', arr);
    });
    const docB = createYDoc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Concurrent appends: A writes a March revision, B a February one.
    docA.transact(() => {
      (docA.getMap('railRevisions').get('r1') as Y.Array<unknown>).push([
        rev('r1', '2026-03-01'),
      ]);
    });
    docB.transact(() => {
      (docB.getMap('railRevisions').get('r1') as Y.Array<unknown>).push([
        rev('r1', '2026-02-01'),
      ]);
    });
    // Cross-merge. The Y.Array interleave order follows clientIDs,
    // not dates — the read path must not depend on it.
    const updA = Y.encodeStateAsUpdate(docA);
    const updB = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docA, updB);
    Y.applyUpdate(docB, updA);

    for (const doc of [docA, docB]) {
      const flat = readFlatStateFromDoc(doc);
      const efs = (flat.railRevisions['r1'] as Array<{ effectiveFrom: string }>).map(
        (r) => r.effectiveFrom,
      );
      expect(efs).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    }
  });
});
