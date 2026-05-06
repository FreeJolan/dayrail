// ERD §5.4 v0.8.1 — resolver tests for the user-controlled
// CalendarRule priority list + the new `external-event` kind.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  calendarRuleApplies,
  resolveTemplateForDate,
} from '../store';
import { setHolidayDatasets } from '../externalEvents';
import type {
  CalendarRule,
  CalendarRuleRevision,
  HolidayDataset,
  UserDayNote,
  UserProfile,
} from '../types';
import { REVISION_SENTINEL_DATE } from '../types';

const ZH_CN: HolidayDataset = {
  regionCode: 'zh-CN',
  displayName: { 'zh-CN': '中国大陆', en: 'Mainland China' },
  events: [
    { date: '2026-05-01', label: { 'zh-CN': '劳动节', en: 'Labour Day' }, kind: 'holiday' },
    { date: '2026-05-02', label: { 'zh-CN': '劳动节', en: 'Labour Day' }, kind: 'holiday' },
    { date: '2026-04-26', label: { 'zh-CN': '调休·劳动节', en: 'Makeup · Labour' }, kind: 'makeup-workday' },
  ],
};

beforeEach(() => {
  setHolidayDatasets([ZH_CN]);
});

function buildRevision(rule: CalendarRule): CalendarRuleRevision {
  return {
    id: `rev-${rule.id}`,
    ruleId: rule.id,
    effectiveFrom: REVISION_SENTINEL_DATE,
    ...(rule.priority !== undefined && { priority: rule.priority }),
    value: rule.value,
    authoredAt: rule.createdAt,
  };
}

describe('calendarRuleApplies · external-event kind', () => {
  const rule: CalendarRule = {
    id: 'r1',
    kind: 'external-event',
    value: { kinds: ['holiday'], templateKey: 'restday' },
    createdAt: 1000,
  };

  it('matches when the date carries a holiday in an enabled region', () => {
    const ctx = {
      userDayNotes: {} as Record<string, UserDayNote>,
      enabledHolidayRegions: ['zh-CN'],
    };
    expect(calendarRuleApplies(rule, '2026-05-01', ctx)).toBe(true);
  });

  it('does not match when no holiday source is enabled', () => {
    const ctx = {
      userDayNotes: {} as Record<string, UserDayNote>,
      enabledHolidayRegions: [] as string[],
    };
    expect(calendarRuleApplies(rule, '2026-05-01', ctx)).toBe(false);
  });

  it('does not match makeup-workday when only "holiday" is in kinds', () => {
    const ctx = {
      userDayNotes: {} as Record<string, UserDayNote>,
      enabledHolidayRegions: ['zh-CN'],
    };
    expect(calendarRuleApplies(rule, '2026-04-26', ctx)).toBe(false);
  });

  it('matches makeup-workday when the rule includes that kind', () => {
    const r: CalendarRule = {
      id: 'r2',
      kind: 'external-event',
      value: { kinds: ['makeup-workday'], templateKey: 'workday' },
      createdAt: 1,
    };
    const ctx = {
      userDayNotes: {} as Record<string, UserDayNote>,
      enabledHolidayRegions: ['zh-CN'],
    };
    expect(calendarRuleApplies(r, '2026-04-26', ctx)).toBe(true);
  });

  it('respects the regions filter when present', () => {
    const r: CalendarRule = {
      id: 'r3',
      kind: 'external-event',
      value: {
        kinds: ['holiday'],
        regions: ['en-US'],
        templateKey: 'restday',
      },
      createdAt: 1,
    };
    const ctx = {
      userDayNotes: {} as Record<string, UserDayNote>,
      enabledHolidayRegions: ['zh-CN'],
    };
    expect(calendarRuleApplies(r, '2026-05-01', ctx)).toBe(false);
  });

  it('matches user-note kind regardless of regions filter', () => {
    const r: CalendarRule = {
      id: 'r4',
      kind: 'external-event',
      value: {
        kinds: ['user-note'],
        regions: ['fake'],
        templateKey: 'restday',
      },
      createdAt: 1,
    };
    const ctx = {
      userDayNotes: {
        n1: {
          id: 'n1',
          date: '2026-05-12',
          label: 'Birthday',
          createdAt: 1,
          updatedAt: 1,
        },
      },
      enabledHolidayRegions: [] as string[],
    };
    expect(calendarRuleApplies(r, '2026-05-12', ctx)).toBe(true);
  });

  it('returns false with empty kinds array', () => {
    const r: CalendarRule = {
      id: 'r5',
      kind: 'external-event',
      value: { kinds: [], templateKey: 'restday' },
      createdAt: 1,
    };
    const ctx = {
      userDayNotes: {} as Record<string, UserDayNote>,
      enabledHolidayRegions: ['zh-CN'],
    };
    expect(calendarRuleApplies(r, '2026-05-01', ctx)).toBe(false);
  });

  it('returns false when no extCtx is supplied', () => {
    expect(calendarRuleApplies(rule, '2026-05-01')).toBe(false);
  });
});

describe('resolveTemplateForDate · calendarRuleOrder priority', () => {
  /**
   * Two rules that BOTH match 2026-05-01:
   *   A: external-event kind=holiday → restday
   *   B: weekday Fri → workday
   * Without the order list, legacy priority would put B (weekday=10)
   * below an external-event rule (no priority field, undefined). With
   * `calendarRuleOrder = [B, A]`, B should win.
   */
  const ruleA: CalendarRule = {
    id: 'A',
    kind: 'external-event',
    value: { kinds: ['holiday'], templateKey: 'restday' },
    createdAt: 1000,
  };
  const ruleB: CalendarRule = {
    id: 'B',
    kind: 'weekday',
    value: { weekdays: [5], templateKey: 'workday' },
    priority: 10,
    createdAt: 500,
  };

  function makeState(opts: {
    order?: string[];
    profile?: UserProfile;
  }): Parameters<typeof resolveTemplateForDate>[0] {
    return {
      calendarRules: { A: ruleA, B: ruleB },
      calendarRuleRevisions: {
        A: [buildRevision(ruleA)],
        B: [buildRevision(ruleB)],
      },
      calendarRuleTombstones: {},
      userDayNotes: {},
      userProfile: opts.profile ?? {
        enabledHolidayRegions: ['zh-CN'],
        ...(opts.order && { calendarRuleOrder: opts.order }),
      },
    };
  }

  it('returns A when order puts A first', () => {
    const state = makeState({ order: ['A', 'B'] });
    expect(resolveTemplateForDate(state, '2026-05-01', () => null)).toBe('restday');
  });

  it('returns B when order puts B first (B wins over A)', () => {
    const state = makeState({ order: ['B', 'A'] });
    expect(resolveTemplateForDate(state, '2026-05-01', () => null)).toBe('workday');
  });

  it('falls back to legacy priority when order is empty', () => {
    // ruleB has priority=10, ruleA has priority=undefined → 0
    // So in the absence of an order list, ruleB (10) > ruleA (0).
    const state = makeState({ order: [] });
    expect(resolveTemplateForDate(state, '2026-05-01', () => null)).toBe('workday');
  });

  it('rules in the order list always beat rules not in it', () => {
    // Only ruleA is in the order list; ruleB falls to legacy fallback.
    const state = makeState({ order: ['A'] });
    expect(resolveTemplateForDate(state, '2026-05-01', () => null)).toBe('restday');
  });

  it('falls through to heuristic when no rules match', () => {
    const state = makeState({ order: ['A', 'B'] });
    expect(
      resolveTemplateForDate(state, '2026-04-04', () => 'heuristic-result'),
    ).toBe('heuristic-result');
  });

  it('handles a missing userProfile by treating order list as empty', () => {
    const state = {
      calendarRules: { B: ruleB },
      calendarRuleRevisions: { B: [buildRevision(ruleB)] },
      calendarRuleTombstones: {},
      // userDayNotes / userProfile both omitted
    };
    expect(resolveTemplateForDate(state, '2026-05-01', () => null)).toBe('workday');
  });
});
