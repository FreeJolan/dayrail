// ERD §14 · ExternalEvent abstraction tests.
//
// Covers:
//   - userNoteToExternal mapping (incl. color in meta)
//   - selectExternalEventsOn aggregation order across sources
//     (holidays first, user-notes after; multi-region holiday alpha
//     order; user-notes createdAt ascending)
//   - holiday locale fallback (label[uiLocale] ?? label.en)
//   - empty-source paths

import { beforeEach, describe, expect, it } from 'vitest';
import {
  selectExternalEventsOn,
  selectUserDayNotesOn,
  setHolidayDatasets,
  userNoteToExternal,
  resolveEnabledHolidayRegions,
  listHolidayRegions,
  getHolidayDatasetDisplayName,
} from '../externalEvents';
import type { HolidayDataset, UserDayNote } from '../types';

const ZH_CN: HolidayDataset = {
  regionCode: 'zh-CN',
  displayName: { 'zh-CN': '中国大陆', en: 'Mainland China' },
  events: [
    { date: '2026-01-01', label: { 'zh-CN': '元旦', en: "New Year's Day" }, kind: 'holiday' },
    { date: '2026-05-01', label: { 'zh-CN': '劳动节', en: 'Labour Day' }, kind: 'holiday' },
    { date: '2026-05-10', label: { 'zh-CN': '母亲节', en: "Mother's Day" }, kind: 'observance' },
  ],
};

const EN_US: HolidayDataset = {
  regionCode: 'en-US',
  displayName: { en: 'United States' },
  events: [
    { date: '2026-01-01', label: { en: "New Year's Day" }, kind: 'holiday' },
    { date: '2026-07-04', label: { en: 'Independence Day' }, kind: 'holiday' },
  ],
};

beforeEach(() => {
  // Reset datasets between tests so registration order doesn't leak.
  setHolidayDatasets([]);
});

describe('userNoteToExternal', () => {
  it('maps a UserDayNote to the unified ExternalEvent shape', () => {
    const note: UserDayNote = {
      id: 'n1',
      date: '2026-05-12',
      label: '妈妈生日',
      color: 'pink',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    };
    const ev = userNoteToExternal(note);
    expect(ev.sourceId).toBe('user:note:n1');
    expect(ev.date).toBe('2026-05-12');
    expect(ev.label).toBe('妈妈生日');
    expect(ev.kind).toBe('user-note');
    expect(ev.meta).toEqual({ createdAt: 1_700_000_000, color: 'pink' });
  });

  it('omits color from meta when undefined', () => {
    const note: UserDayNote = {
      id: 'n2',
      date: '2026-05-12',
      label: '看牙医',
      createdAt: 1_700_000_001,
      updatedAt: 1_700_000_001,
    };
    const ev = userNoteToExternal(note);
    expect(ev.meta).toEqual({ createdAt: 1_700_000_001 });
  });
});

describe('selectExternalEventsOn', () => {
  it('returns empty when nothing matches', () => {
    setHolidayDatasets([ZH_CN]);
    const out = selectExternalEventsOn('2026-04-04', {
      enabledHolidayRegions: ['zh-CN'],
      userDayNotes: {},
    });
    expect(out).toEqual([]);
  });

  it('aggregates user-notes first, then holidays/observances, then makeup-workdays', () => {
    setHolidayDatasets([ZH_CN, EN_US]);
    const notes: Record<string, UserDayNote> = {
      n1: {
        id: 'n1',
        date: '2026-01-01',
        label: '元旦聚会',
        createdAt: 100,
        updatedAt: 100,
      },
    };
    const out = selectExternalEventsOn('2026-01-01', {
      enabledHolidayRegions: ['zh-CN', 'en-US'],
      userDayNotes: notes,
    });
    // ERD §14.3 multi-attribute display: user-notes lead the stack.
    expect(out.map((e) => e.kind)).toEqual(['user-note', 'holiday', 'holiday']);
    expect(out[0]!.sourceId).toBe('user:note:n1');
    expect(out[1]!.sourceId).toBe('holidays:en-US'); // alpha order: en-US < zh-CN
    expect(out[2]!.sourceId).toBe('holidays:zh-CN');
  });

  it('places makeup-workdays after holidays and observances', () => {
    const ZH_CN_WITH_MAKEUP: HolidayDataset = {
      regionCode: 'zh-CN',
      displayName: { 'zh-CN': '中国大陆', en: 'Mainland China' },
      events: [
        // A makeup workday declared first in the dataset to prove the
        // selector reorders by kind, not by source-array position.
        { date: '2026-02-14', label: { 'zh-CN': '调休·春节', en: 'Makeup · Spring Festival' }, kind: 'makeup-workday' },
        // An observance and a holiday on the same date (artificial,
        // but covers the ordering invariant).
        { date: '2026-02-14', label: { 'zh-CN': '情人节', en: "Valentine's Day" }, kind: 'observance' },
        { date: '2026-02-14', label: { 'zh-CN': '春节', en: 'Spring Festival' }, kind: 'holiday' },
      ],
    };
    setHolidayDatasets([ZH_CN_WITH_MAKEUP]);
    const out = selectExternalEventsOn('2026-02-14', {
      enabledHolidayRegions: ['zh-CN'],
      userDayNotes: {
        n1: {
          id: 'n1',
          date: '2026-02-14',
          label: '生日',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    expect(out.map((e) => e.kind)).toEqual([
      'user-note',
      'holiday',
      'observance',
      'makeup-workday',
    ]);
  });

  it('orders user notes by createdAt ascending', () => {
    setHolidayDatasets([]);
    const notes: Record<string, UserDayNote> = {
      a: { id: 'a', date: '2026-05-12', label: 'A', createdAt: 200, updatedAt: 200 },
      b: { id: 'b', date: '2026-05-12', label: 'B', createdAt: 100, updatedAt: 100 },
      c: { id: 'c', date: '2026-05-12', label: 'C', createdAt: 300, updatedAt: 300 },
      // distractor on a different date:
      d: { id: 'd', date: '2026-05-11', label: 'D', createdAt: 50, updatedAt: 50 },
    };
    const out = selectExternalEventsOn('2026-05-12', {
      enabledHolidayRegions: [],
      userDayNotes: notes,
    });
    expect(out.map((e) => e.label)).toEqual(['B', 'A', 'C']);
  });

  it('uses uiLocale for label resolution with English fallback', () => {
    setHolidayDatasets([ZH_CN]);
    const out = selectExternalEventsOn('2026-05-01', {
      enabledHolidayRegions: ['zh-CN'],
      userDayNotes: {},
      uiLocale: 'zh-CN',
    });
    expect(out[0]!.label).toBe('劳动节');

    const outEn = selectExternalEventsOn('2026-05-01', {
      enabledHolidayRegions: ['zh-CN'],
      userDayNotes: {},
      uiLocale: 'en',
    });
    expect(outEn[0]!.label).toBe('Labour Day');
  });

  it('falls back through label.en when the uiLocale key is missing', () => {
    setHolidayDatasets([EN_US]);
    const out = selectExternalEventsOn('2026-07-04', {
      enabledHolidayRegions: ['en-US'],
      userDayNotes: {},
      uiLocale: 'zh-CN', // dataset has no zh-CN label, only en
    });
    expect(out[0]!.label).toBe('Independence Day');
  });

  it('skips regions whose dataset is not loaded', () => {
    setHolidayDatasets([ZH_CN]);
    const out = selectExternalEventsOn('2026-01-01', {
      enabledHolidayRegions: ['zh-CN', 'ja-JP'], // ja-JP not registered
      userDayNotes: {},
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.regionCode).toBe('zh-CN');
  });

  it('preserves observance kind for non-statutory holidays', () => {
    setHolidayDatasets([ZH_CN]);
    const out = selectExternalEventsOn('2026-05-10', {
      enabledHolidayRegions: ['zh-CN'],
      userDayNotes: {},
    });
    expect(out[0]!.kind).toBe('observance');
  });

  it('returns no results when enabled regions is empty', () => {
    setHolidayDatasets([ZH_CN]);
    const out = selectExternalEventsOn('2026-01-01', {
      enabledHolidayRegions: [],
      userDayNotes: {},
    });
    expect(out).toEqual([]);
  });
});

describe('selectUserDayNotesOn', () => {
  it('filters by date and sorts createdAt ascending', () => {
    const notes: Record<string, UserDayNote> = {
      a: { id: 'a', date: '2026-05-12', label: 'A', createdAt: 200, updatedAt: 200 },
      b: { id: 'b', date: '2026-05-12', label: 'B', createdAt: 100, updatedAt: 100 },
      c: { id: 'c', date: '2026-05-13', label: 'C', createdAt: 50, updatedAt: 50 },
    };
    const out = selectUserDayNotesOn('2026-05-12', notes);
    expect(out.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('returns empty array when no matches', () => {
    expect(selectUserDayNotesOn('2026-05-12', {})).toEqual([]);
  });
});

describe('resolveEnabledHolidayRegions', () => {
  it('returns the array when set', () => {
    expect(resolveEnabledHolidayRegions({ enabledHolidayRegions: ['zh-CN'] })).toEqual(['zh-CN']);
  });

  it('returns empty array for null profile', () => {
    expect(resolveEnabledHolidayRegions(null)).toEqual([]);
  });

  it('returns empty array when field is missing', () => {
    expect(resolveEnabledHolidayRegions({})).toEqual([]);
  });
});

describe('holiday dataset registry', () => {
  it('listHolidayRegions returns sorted region codes', () => {
    setHolidayDatasets([EN_US, ZH_CN]);
    expect(listHolidayRegions()).toEqual(['en-US', 'zh-CN']);
  });

  it('getHolidayDatasetDisplayName resolves locale with English fallback', () => {
    setHolidayDatasets([ZH_CN, EN_US]);
    expect(getHolidayDatasetDisplayName('zh-CN', 'zh-CN')).toBe('中国大陆');
    expect(getHolidayDatasetDisplayName('zh-CN', 'en')).toBe('Mainland China');
    // EN_US has only `en`; falling back from zh-CN locale should hit it
    expect(getHolidayDatasetDisplayName('en-US', 'zh-CN')).toBe('United States');
  });

  it('getHolidayDatasetDisplayName returns null for unloaded region', () => {
    setHolidayDatasets([]);
    expect(getHolidayDatasetDisplayName('zh-CN', 'zh-CN')).toBeNull();
  });
});
