import { describe, expect, it } from 'vitest';
import {
  calendarRuleAtDate,
  calendarRuleRevisionsActiveOn,
  habitBindingAtDate,
  habitBindingsActiveOn,
  railAtDate,
  railsActiveOn,
  templateAtDate,
} from '../revisions';
import type {
  CalendarRuleRevision,
  HabitBindingRevision,
  RailRevision,
  TemplateRevision,
  Tombstone,
} from '../types';
import { REVISION_SENTINEL_DATE } from '../types';

// Effective-from selectors are the data-layer "past = frozen"
// guarantee for ERD §10.5. Bugs here cascade into every read path
// once Phase 2 lands — the selector either returns the wrong revision
// (history shifts), the wrong tombstone behavior (deleted entities
// reappear in past views or never disappear), or `undefined` when a
// revision should win. These tests pin every branch of the resolution
// rule.

function railRev(over: Partial<RailRevision> & { railId: string; effectiveFrom: string }): RailRevision {
  return {
    id: over.id ?? `rev-${over.railId}-${over.effectiveFrom}`,
    templateKey: 'workday',
    name: over.railId,
    startMinutes: 9 * 60,
    durationMinutes: 60,
    color: 'indigo',
    showInCheckin: true,
    authoredAt: 0,
    ...over,
  };
}

function tplRev(over: Partial<TemplateRevision> & { templateKey: string; effectiveFrom: string }): TemplateRevision {
  return {
    id: over.id ?? `rev-${over.templateKey}-${over.effectiveFrom}`,
    name: over.templateKey,
    authoredAt: 0,
    ...over,
  };
}

function ruleRev(
  over: Partial<CalendarRuleRevision> & {
    ruleId: string;
    effectiveFrom: string;
  },
): CalendarRuleRevision {
  return {
    id: over.id ?? `rev-${over.ruleId}-${over.effectiveFrom}`,
    priority: 10,
    value: { weekdays: [1, 2, 3, 4, 5], templateKey: 'workday' },
    authoredAt: 0,
    ...over,
  };
}

function bindingRev(
  over: Partial<HabitBindingRevision> & {
    bindingId: string;
    effectiveFrom: string;
    habitId: string;
    railId: string;
  },
): HabitBindingRevision {
  return {
    id: over.id ?? `rev-${over.bindingId}-${over.effectiveFrom}`,
    authoredAt: 0,
    ...over,
  };
}

function tombstone(effectiveFrom: string): Tombstone {
  return { effectiveFrom, at: 0 };
}

describe('railAtDate', () => {
  it('returns undefined when no revisions exist', () => {
    const state = { railRevisions: {}, railTombstones: {} };
    expect(railAtDate(state, 'rail-A', '2026-04-20')).toBeUndefined();
  });

  it('returns the only revision when one exists and date is on/after it', () => {
    const rev = railRev({ railId: 'rail-A', effectiveFrom: '2026-04-01' });
    const state = {
      railRevisions: { 'rail-A': [rev] },
      railTombstones: {},
    };
    expect(railAtDate(state, 'rail-A', '2026-04-01')).toBe(rev);
    expect(railAtDate(state, 'rail-A', '2026-04-20')).toBe(rev);
  });

  it('returns undefined when date is strictly before the first revision', () => {
    const rev = railRev({ railId: 'rail-A', effectiveFrom: '2026-04-10' });
    const state = {
      railRevisions: { 'rail-A': [rev] },
      railTombstones: {},
    };
    expect(railAtDate(state, 'rail-A', '2026-04-09')).toBeUndefined();
  });

  it('picks the latest revision with effectiveFrom <= date', () => {
    const r1 = railRev({
      railId: 'rail-A',
      effectiveFrom: '2026-04-01',
      name: 'old',
    });
    const r2 = railRev({
      railId: 'rail-A',
      effectiveFrom: '2026-04-15',
      name: 'new',
    });
    const state = {
      railRevisions: { 'rail-A': [r1, r2] },
      railTombstones: {},
    };
    expect(railAtDate(state, 'rail-A', '2026-04-10')?.name).toBe('old');
    expect(railAtDate(state, 'rail-A', '2026-04-14')?.name).toBe('old');
    expect(railAtDate(state, 'rail-A', '2026-04-15')?.name).toBe('new');
    expect(railAtDate(state, 'rail-A', '2026-04-20')?.name).toBe('new');
  });

  it('respects tombstones: returns undefined on/after the tombstone date', () => {
    const r1 = railRev({ railId: 'rail-A', effectiveFrom: '2026-04-01' });
    const state = {
      railRevisions: { 'rail-A': [r1] },
      railTombstones: { 'rail-A': tombstone('2026-04-15') },
    };
    expect(railAtDate(state, 'rail-A', '2026-04-14')).toBe(r1);
    expect(railAtDate(state, 'rail-A', '2026-04-15')).toBeUndefined();
    expect(railAtDate(state, 'rail-A', '2026-04-20')).toBeUndefined();
  });
});

describe('templateAtDate', () => {
  it('resolves the active template revision', () => {
    const r1 = tplRev({ templateKey: 'workday', effectiveFrom: REVISION_SENTINEL_DATE });
    const r2 = tplRev({
      templateKey: 'workday',
      effectiveFrom: '2026-04-15',
      name: 'workday-renamed',
    });
    const state = {
      templateRevisions: { workday: [r1, r2] },
      templateTombstones: {},
    };
    expect(templateAtDate(state, 'workday', '2026-01-01')?.name).toBe('workday');
    expect(templateAtDate(state, 'workday', '2026-04-20')?.name).toBe('workday-renamed');
  });
});

describe('calendarRuleAtDate', () => {
  it('returns the value snapshot for the given date', () => {
    const r1 = ruleRev({
      ruleId: 'cr-weekday-workday',
      effectiveFrom: '2026-04-01',
      value: { weekdays: [1, 2, 3, 4, 5], templateKey: 'workday' },
    });
    const r2 = ruleRev({
      ruleId: 'cr-weekday-workday',
      effectiveFrom: '2026-04-15',
      value: { weekdays: [1, 2, 3, 4, 5, 6], templateKey: 'workday' },
    });
    const state = {
      calendarRuleRevisions: { 'cr-weekday-workday': [r1, r2] },
      calendarRuleTombstones: {},
    };
    expect(calendarRuleAtDate(state, 'cr-weekday-workday', '2026-04-10')).toBe(r1);
    expect(calendarRuleAtDate(state, 'cr-weekday-workday', '2026-04-15')).toBe(r2);
  });

  it('respects calendar-rule tombstones', () => {
    const r1 = ruleRev({
      ruleId: 'cr-x',
      effectiveFrom: '2026-04-01',
    });
    const state = {
      calendarRuleRevisions: { 'cr-x': [r1] },
      calendarRuleTombstones: { 'cr-x': tombstone('2026-04-20') },
    };
    expect(calendarRuleAtDate(state, 'cr-x', '2026-04-19')).toBe(r1);
    expect(calendarRuleAtDate(state, 'cr-x', '2026-04-20')).toBeUndefined();
  });
});

describe('habitBindingAtDate', () => {
  it('lets a binding swap its rail across a cutover date', () => {
    const r1 = bindingRev({
      bindingId: 'b-1',
      effectiveFrom: '2026-04-01',
      habitId: 'habit-run',
      railId: 'rail-morning',
    });
    const r2 = bindingRev({
      bindingId: 'b-1',
      effectiveFrom: '2026-04-15',
      habitId: 'habit-run',
      railId: 'rail-evening',
    });
    const state = {
      habitBindingRevisions: { 'b-1': [r1, r2] },
      habitBindingTombstones: {},
    };
    expect(habitBindingAtDate(state, 'b-1', '2026-04-10')?.railId).toBe('rail-morning');
    expect(habitBindingAtDate(state, 'b-1', '2026-04-20')?.railId).toBe('rail-evening');
  });
});

describe('railsActiveOn', () => {
  it('returns rails that have an active revision on the date', () => {
    const a = railRev({ railId: 'rail-A', effectiveFrom: '2026-04-01' });
    const b = railRev({ railId: 'rail-B', effectiveFrom: '2026-04-10' });
    const state = {
      railRevisions: { 'rail-A': [a], 'rail-B': [b] },
      railTombstones: {},
    };
    expect(railsActiveOn(state, '2026-04-05').map((r) => r.railId)).toEqual([
      'rail-A',
    ]);
    expect(
      railsActiveOn(state, '2026-04-10')
        .map((r) => r.railId)
        .sort(),
    ).toEqual(['rail-A', 'rail-B']);
  });

  it('hides tombstoned rails on/after their tombstone date', () => {
    const a = railRev({ railId: 'rail-A', effectiveFrom: '2026-04-01' });
    const state = {
      railRevisions: { 'rail-A': [a] },
      railTombstones: { 'rail-A': tombstone('2026-04-10') },
    };
    expect(railsActiveOn(state, '2026-04-09').length).toBe(1);
    expect(railsActiveOn(state, '2026-04-10').length).toBe(0);
  });
});

describe('calendarRuleRevisionsActiveOn / habitBindingsActiveOn', () => {
  it('exposes only entities whose revision exists at the date', () => {
    const calState = {
      calendarRuleRevisions: {
        early: [ruleRev({ ruleId: 'early', effectiveFrom: '2026-04-01' })],
        late: [ruleRev({ ruleId: 'late', effectiveFrom: '2026-04-15' })],
      },
      calendarRuleTombstones: {},
    };
    expect(
      calendarRuleRevisionsActiveOn(calState, '2026-04-10').map((r) => r.ruleId),
    ).toEqual(['early']);
    expect(
      calendarRuleRevisionsActiveOn(calState, '2026-04-20')
        .map((r) => r.ruleId)
        .sort(),
    ).toEqual(['early', 'late']);

    const bindingState = {
      habitBindingRevisions: {
        b: [
          bindingRev({
            bindingId: 'b',
            effectiveFrom: '2026-04-01',
            habitId: 'h',
            railId: 'r',
          }),
        ],
      },
      habitBindingTombstones: { b: tombstone('2026-04-20') },
    };
    expect(habitBindingsActiveOn(bindingState, '2026-04-19').length).toBe(1);
    expect(habitBindingsActiveOn(bindingState, '2026-04-20').length).toBe(0);
  });
});
