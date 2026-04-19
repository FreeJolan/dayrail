import { describe, expect, it } from 'vitest';
import { materializeAutoTasksImpl } from '../autoTask';
import type {
  CalendarRule,
  CalendarRuleWeekday,
  HabitBinding,
  Line,
  Rail,
  Task,
  Template,
} from '../types';

// The materializer is the destructive forward path: bugs here either
// spam the store with phantom tasks or silently skip days the user
// expected to see. Already caught two traps in session history
// (rail.recurrence mismatch, binding.createdAt ms vs date). These
// tests pin the current behaviour so regressions show up loud.

// Reference dates — 2026-04-19 is Sunday, so the week runs:
//   Mon 2026-04-13 · Tue 04-14 · Wed 04-15 · Thu 04-16 · Fri 04-17
//   Sat 04-18      · Sun 04-19
const MON = '2026-04-13';
const SUN = '2026-04-19';

function makeTemplate(key: string): Template {
  return { key, name: key, isDefault: false };
}

function makeRail(overrides: Partial<Rail> & { id: string; templateKey: string }): Rail {
  return {
    name: overrides.id,
    startMinutes: 9 * 60,
    durationMinutes: 60,
    color: 'indigo',
    showInCheckin: true,
    ...overrides,
  };
}

function makeHabit(overrides: Partial<Line> & { id: string }): Line {
  return {
    name: overrides.id,
    kind: 'habit',
    status: 'active',
    isDefault: false,
    createdAt: Date.parse('2026-04-01'),
    ...overrides,
  };
}

function makeBinding(overrides: Partial<HabitBinding> & { habitId: string; railId: string }): HabitBinding {
  return {
    id: overrides.id ?? `bind-${overrides.habitId}-${overrides.railId}`,
    createdAt: Date.parse('2026-04-01'),
    ...overrides,
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

function byKey<T extends { key: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.key, i]));
}

function mapById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

interface Recorder {
  calls: Task[];
  upsert: (task: Task) => Promise<void>;
}

function makeRecorder(): Recorder {
  const calls: Task[] = [];
  return {
    calls,
    upsert: async (task) => {
      calls.push(task);
    },
  };
}

describe('materializeAutoTasksImpl', () => {
  it('produces one auto-task per (binding, matching date)', async () => {
    const state = {
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'workday' })]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([makeBinding({ habitId: 'h1', railId: 'rA' })]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    // Mon–Fri = 5 workdays in the window.
    expect(rec.calls).toHaveLength(5);
    expect(rec.calls.every((t) => t.source === 'auto-habit')).toBe(true);
    expect(rec.calls.every((t) => t.lineId === 'h1')).toBe(true);
    expect(rec.calls.every((t) => t.slot?.railId === 'rA')).toBe(true);
    // Deterministic id scheme.
    for (const task of rec.calls) {
      expect(task.id).toBe(`task-auto-h1-${task.slot!.date}`);
    }
  });

  it('skips dates whose template doesn\'t match the rail', async () => {
    // Rail is in workday template; window includes Sat + Sun which
    // resolve to restday → should produce zero tasks.
    const state = {
      templates: byKey([makeTemplate('workday'), makeTemplate('restday')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'workday' })]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([makeBinding({ habitId: 'h1', railId: 'rA' })]),
      calendarRules: mapById([
        weekdayRule('workday', [1, 2, 3, 4, 5]),
        weekdayRule('restday', [0, 6]),
      ]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: '2026-04-18', // Sat
      endDate: '2026-04-19', // Sun
    });
    expect(rec.calls).toEqual([]);
  });

  it('respects binding.weekdays as an AND filter with the template', async () => {
    // Workday template covers Mon-Fri; binding narrows to Wed only.
    // Expected: one task on Wed 04-15.
    const state = {
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'workday' })]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([
        makeBinding({ habitId: 'h1', railId: 'rA', weekdays: [3] }),
      ]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    expect(rec.calls.map((t) => t.slot!.date)).toEqual(['2026-04-15']);
  });

  it('floors binding.createdAt to the date — a mid-day-created binding still covers that day', async () => {
    // Binding created at 15:00 on Wed 04-15; rail fires at 09:00.
    // Naive ms comparison (old bug) would skip Wed because 09:00 < 15:00.
    // Date-floor means Wed should still materialize.
    const state = {
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'workday' })]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([
        makeBinding({
          habitId: 'h1',
          railId: 'rA',
          createdAt: Date.parse('2026-04-15T15:00:00'),
        }),
      ]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    // Wed (04-15), Thu (04-16), Fri (04-17) — Mon/Tue excluded (pre-createdAt).
    expect(rec.calls.map((t) => t.slot!.date)).toEqual([
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
    ]);
  });

  it('skips habits that are not active', async () => {
    const state = {
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'workday' })]),
      lines: mapById([makeHabit({ id: 'h1', status: 'archived' })]),
      habitBindings: mapById([makeBinding({ habitId: 'h1', railId: 'rA' })]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    expect(rec.calls).toEqual([]);
  });

  it('skips bindings whose rail or habit has been deleted', async () => {
    const state = {
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'workday' })]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([
        makeBinding({ habitId: 'h1', railId: 'rA' }),
        makeBinding({ habitId: 'h1', railId: 'dangling-rail' }),
        makeBinding({ habitId: 'ghost-habit', railId: 'rA' }),
      ]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    // Only the clean (h1, rA) binding should produce tasks — 5 workdays.
    expect(rec.calls).toHaveLength(5);
  });

  it('handles multiple bindings for the same habit across different rails', async () => {
    // Habit h1 fires on two rails: workday morning + weekend afternoon.
    const state = {
      templates: byKey([makeTemplate('workday'), makeTemplate('restday')]),
      rails: mapById([
        makeRail({ id: 'morning', templateKey: 'workday' }),
        makeRail({ id: 'weekend', templateKey: 'restday' }),
      ]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([
        makeBinding({ id: 'b1', habitId: 'h1', railId: 'morning' }),
        makeBinding({ id: 'b2', habitId: 'h1', railId: 'weekend' }),
      ]),
      calendarRules: mapById([
        weekdayRule('workday', [1, 2, 3, 4, 5]),
        weekdayRule('restday', [0, 6]),
      ]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    // 5 workday rails + 2 restday rails = 7 tasks across the week.
    expect(rec.calls).toHaveLength(7);
    const byRail = new Map<string, number>();
    for (const t of rec.calls) {
      const id = t.slot!.railId;
      byRail.set(id, (byRail.get(id) ?? 0) + 1);
    }
    expect(byRail.get('morning')).toBe(5);
    expect(byRail.get('weekend')).toBe(2);
  });

  it('no-ops when there are zero bindings', async () => {
    const state = {
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'workday' })]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: {},
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    expect(rec.calls).toEqual([]);
  });

  it('skips dates with no resolved template (no CalendarRule covers them)', async () => {
    // Custom template without a weekday rule → resolveTemplateForDate
    // returns null (fallback heuristic in the materializer is () => null).
    const state = {
      templates: byKey([makeTemplate('custom')]),
      rails: mapById([makeRail({ id: 'rA', templateKey: 'custom' })]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([makeBinding({ habitId: 'h1', railId: 'rA' })]),
      calendarRules: {}, // no rule for 'custom'
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    expect(rec.calls).toEqual([]);
  });
});
