import { describe, expect, it } from 'vitest';
import { materializeAutoTasksImpl } from '../autoTask';
import type {
  CalendarRule,
  CalendarRuleRevision,
  CalendarRuleWeekday,
  HabitBinding,
  HabitBindingRevision,
  Line,
  Rail,
  RailRevision,
  Task,
  Template,
} from '../types';
import { REVISION_SENTINEL_DATE } from '../types';

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

/** Mirror what the v0.5 sentinel migration produces. Tests build legacy
 *  fixtures and pass them through `withRevisions` so the date-aware
 *  selectors find a revision for every test date (`'1970-01-01' <= D`). */
function withRevisions<
  S extends {
    rails?: Record<string, Rail>;
    calendarRules?: Record<string, CalendarRule>;
    habitBindings?: Record<string, HabitBinding>;
  },
>(
  state: S,
): S & {
  railRevisions: Record<string, RailRevision[]>;
  railTombstones: Record<string, never>;
  calendarRuleRevisions: Record<string, CalendarRuleRevision[]>;
  calendarRuleTombstones: Record<string, never>;
  habitBindingRevisions: Record<string, HabitBindingRevision[]>;
  habitBindingTombstones: Record<string, never>;
} {
  const railRevs: Record<string, RailRevision[]> = {};
  for (const r of Object.values(state.rails ?? {})) {
    railRevs[r.id] = [
      {
        id: `rev-rail-${r.id}-sentinel`,
        railId: r.id,
        effectiveFrom: REVISION_SENTINEL_DATE,
        templateKey: r.templateKey,
        name: r.name,
        ...(r.subtitle != null && { subtitle: r.subtitle }),
        startMinutes: r.startMinutes,
        durationMinutes: r.durationMinutes,
        color: r.color,
        ...(r.icon != null && { icon: r.icon }),
        showInCheckin: r.showInCheckin,
        authoredAt: 0,
      } satisfies RailRevision,
    ];
  }
  const ruleRevs: Record<string, CalendarRuleRevision[]> = {};
  for (const cr of Object.values(state.calendarRules ?? {})) {
    ruleRevs[cr.id] = [
      {
        id: `rev-calrule-${cr.id}-sentinel`,
        ruleId: cr.id,
        effectiveFrom: REVISION_SENTINEL_DATE,
        priority: cr.priority,
        value: cr.value,
        authoredAt: 0,
      } satisfies CalendarRuleRevision,
    ];
  }
  const bindingRevs: Record<string, HabitBindingRevision[]> = {};
  for (const b of Object.values(state.habitBindings ?? {})) {
    bindingRevs[b.id] = [
      {
        id: `rev-binding-${b.id}-sentinel`,
        bindingId: b.id,
        effectiveFrom: REVISION_SENTINEL_DATE,
        habitId: b.habitId,
        railId: b.railId,
        ...(b.weekdays != null && { weekdays: [...b.weekdays] }),
        authoredAt: b.createdAt,
      } satisfies HabitBindingRevision,
    ];
  }
  return {
    ...state,
    railRevisions: railRevs,
    railTombstones: {},
    calendarRuleRevisions: ruleRevs,
    calendarRuleTombstones: {},
    habitBindingRevisions: bindingRevs,
    habitBindingTombstones: {},
  };
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
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
    await materializeAutoTasksImpl(withRevisions(state), rec.upsert, {
      startDate: MON,
      endDate: SUN,
    });
    expect(rec.calls).toEqual([]);
  });
});

// ------------------------------------------------------------------
// §10.5 effective-from freeze guarantee.
//
// The proof point: a rail change that lands mid-window creates a new
// revision with `effectiveFrom = D2`. Materializing across D2 must
// produce auto-tasks whose rail/template/binding fields come from the
// OLD revision for dates < D2 and the NEW revision from D2 onward.
// Slots are pinned to the rail's stable id (the identity shell), so
// downstream consumers re-render via `railAtDate(slot.date)` and see
// the historically-correct rail every time.
// ------------------------------------------------------------------

describe('materializer · revision-frozen past', () => {
  it('respects rail revisions when crossing a cutover date', async () => {
    // Setup: workday rail "rA" lives at 09:00–10:00 on rev1
    // (effective '1970-01-01' through 2026-04-15), then changes to
    // 14:00–15:00 from 2026-04-15 onward. Materialize the full
    // Mon–Fri window 2026-04-13 .. 2026-04-17. Expectation: tasks on
    // 04-13 / 04-14 carry no time annotation directly (slot only) —
    // we validate by re-resolving the rail per slot date.

    const rail: Rail = {
      id: 'rA',
      templateKey: 'workday',
      name: 'Coding',
      startMinutes: 9 * 60,
      durationMinutes: 60,
      color: 'indigo',
      showInCheckin: true,
    };
    const baseState = withRevisions({
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([rail]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([makeBinding({ habitId: 'h1', railId: 'rA' })]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    });

    // Layer in the post-cutover rev (effectiveFrom = 2026-04-15).
    const rev2: RailRevision = {
      id: 'rev-rail-rA-2026-04-15',
      railId: 'rA',
      effectiveFrom: '2026-04-15',
      templateKey: 'workday',
      name: 'Coding (afternoon)',
      startMinutes: 14 * 60,
      durationMinutes: 60,
      color: 'indigo',
      showInCheckin: true,
      authoredAt: 0,
    };
    baseState.railRevisions['rA']!.push(rev2);

    const rec = makeRecorder();
    await materializeAutoTasksImpl(baseState, rec.upsert, {
      startDate: '2026-04-13', // Mon
      endDate: '2026-04-17', // Fri
    });
    expect(rec.calls.map((t) => t.slot!.date)).toEqual([
      '2026-04-13',
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
    ]);

    // The auto-tasks themselves carry only `slot` — re-resolve the
    // rail per slot date to confirm the time is the historically
    // correct one.
    const { railAtDate } = await import('../revisions');
    const rA0413 = railAtDate(baseState, 'rA', '2026-04-13');
    const rA0415 = railAtDate(baseState, 'rA', '2026-04-15');
    expect(rA0413?.startMinutes).toBe(9 * 60);
    expect(rA0413?.name).toBe('Coding');
    expect(rA0415?.startMinutes).toBe(14 * 60);
    expect(rA0415?.name).toBe('Coding (afternoon)');
  });

  it('materializes nothing on a date before any revision exists', async () => {
    // Rail's first revision is 2026-04-15 (no sentinel). The window
    // starts 2026-04-13 — those days should resolve to undefined and
    // produce zero tasks.
    const rail: Rail = {
      id: 'rA',
      templateKey: 'workday',
      name: 'Coding',
      startMinutes: 9 * 60,
      durationMinutes: 60,
      color: 'indigo',
      showInCheckin: true,
    };
    const state = {
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([rail]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([makeBinding({ habitId: 'h1', railId: 'rA' })]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
      railRevisions: {
        rA: [
          {
            id: 'rev-rail-rA-2026-04-15',
            railId: 'rA',
            effectiveFrom: '2026-04-15',
            templateKey: 'workday',
            name: 'Coding',
            startMinutes: 9 * 60,
            durationMinutes: 60,
            color: 'indigo' as const,
            showInCheckin: true,
            authoredAt: 0,
          } satisfies RailRevision,
        ],
      },
      railTombstones: {},
      calendarRuleRevisions: {
        'cr-weekday-workday': [
          {
            id: 'rev-calrule-cr-weekday-workday-sentinel',
            ruleId: 'cr-weekday-workday',
            effectiveFrom: REVISION_SENTINEL_DATE,
            priority: 10,
            value: { templateKey: 'workday', weekdays: [1, 2, 3, 4, 5] },
            authoredAt: 0,
          } satisfies CalendarRuleRevision,
        ],
      },
      calendarRuleTombstones: {},
      habitBindingRevisions: {
        'bind-h1-rA': [
          {
            id: 'rev-binding-bind-h1-rA-sentinel',
            bindingId: 'bind-h1-rA',
            effectiveFrom: REVISION_SENTINEL_DATE,
            habitId: 'h1',
            railId: 'rA',
            authoredAt: Date.parse('2026-04-01'),
          } satisfies HabitBindingRevision,
        ],
      },
      habitBindingTombstones: {},
    };
    const rec = makeRecorder();
    await materializeAutoTasksImpl(state, rec.upsert, {
      startDate: '2026-04-13', // Mon
      endDate: '2026-04-17', // Fri
    });
    // 04-13 / 04-14 land before the rail's first revision → skipped.
    expect(rec.calls.map((t) => t.slot!.date)).toEqual([
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
    ]);
  });

  it('respects rail tombstones — dates on/after retire produce no tasks', async () => {
    const rail: Rail = {
      id: 'rA',
      templateKey: 'workday',
      name: 'Coding',
      startMinutes: 9 * 60,
      durationMinutes: 60,
      color: 'indigo',
      showInCheckin: true,
    };
    const baseState = withRevisions({
      templates: byKey([makeTemplate('workday')]),
      rails: mapById([rail]),
      lines: mapById([makeHabit({ id: 'h1' })]),
      habitBindings: mapById([makeBinding({ habitId: 'h1', railId: 'rA' })]),
      calendarRules: mapById([weekdayRule('workday', [1, 2, 3, 4, 5])]),
    });
    (baseState.railTombstones as Record<string, { effectiveFrom: string; at: number }>) = {
      rA: { effectiveFrom: '2026-04-15', at: 0 },
    };

    const rec = makeRecorder();
    await materializeAutoTasksImpl(baseState, rec.upsert, {
      startDate: '2026-04-13',
      endDate: '2026-04-17',
    });
    expect(rec.calls.map((t) => t.slot!.date)).toEqual([
      '2026-04-13',
      '2026-04-14',
    ]);
  });
});
