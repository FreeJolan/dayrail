import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCK_MINUTES, projectIntent, type IntentSpec } from '../intentStaging';
import { INBOX_LINE_ID } from '../types';

// Deterministic id minter so tests can assert intra-plan references
// (binding → line / rail) without depending on timestamps.
function counterGen(): (prefix: string) => string {
  const counts: Record<string, number> = {};
  return (prefix) => {
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    return `${prefix}-${counts[prefix]}`;
  };
}

// The canonical ERD §6.7 example: "meditate 5 min, morning and evening".
const MEDITATION: IntentSpec = {
  title: '冥想',
  perOccurrenceDurationMinutes: 5,
  frequency: 'daily',
  times: [
    { startMinutes: 7 * 60, label: '晨间' },
    { startMinutes: 22 * 60, label: '晚间' },
  ],
};

describe('projectIntent · habit shape', () => {
  it('projects the meditation example into a habit line + two rails + two bindings', () => {
    const plan = projectIntent(MEDITATION, 'habit', { genId: counterGen(), now: 1000 });
    expect(plan.shape).toBe('habit');
    expect(plan.line).toMatchObject({
      name: '冥想',
      kind: 'habit',
      status: 'active',
      createdAt: 1000,
    });
    expect(plan.rails).toHaveLength(2);
    expect(plan.bindings).toHaveLength(2);
  });

  it('wires bindings to the minted line + rails (intra-plan refs)', () => {
    const plan = projectIntent(MEDITATION, 'habit', { genId: counterGen() });
    for (const b of plan.bindings) {
      expect(b.habitId).toBe(plan.line?.id);
    }
    expect(plan.bindings.map((b) => b.railId)).toEqual(plan.rails.map((r) => r.id));
  });

  it('uses perOccurrenceDuration as the block length when a time gives none', () => {
    const plan = projectIntent(MEDITATION, 'habit', { genId: counterGen() });
    expect(plan.rails[0]).toMatchObject({ startMinutes: 7 * 60, durationMinutes: 5 });
  });

  it('prefers an explicit per-time duration over the spec default', () => {
    const plan = projectIntent(
      { title: 'x', frequency: 'daily', perOccurrenceDurationMinutes: 5, times: [{ startMinutes: 480, durationMinutes: 45 }] },
      'habit',
      { genId: counterGen() },
    );
    expect(plan.rails[0]?.durationMinutes).toBe(45);
  });

  it('falls back to DEFAULT_BLOCK_MINUTES when neither time nor spec gives a duration', () => {
    const plan = projectIntent(
      { title: 'x', frequency: 'daily', times: [{ startMinutes: 480 }] },
      'habit',
      { genId: counterGen() },
    );
    expect(plan.rails[0]?.durationMinutes).toBe(DEFAULT_BLOCK_MINUTES);
  });

  it('carries a per-time weekday filter onto its binding', () => {
    const plan = projectIntent(
      { title: 'run', frequency: 'weekly', times: [{ startMinutes: 360, weekdays: [1, 3, 5] }] },
      'habit',
      { genId: counterGen() },
    );
    expect(plan.bindings[0]?.weekdays).toEqual([1, 3, 5]);
  });

  it('omits weekdays on the binding when the time has none', () => {
    const plan = projectIntent(MEDITATION, 'habit', { genId: counterGen() });
    expect(plan.bindings[0]).not.toHaveProperty('weekdays');
  });

  it('puts the time label on the rail subtitle, keeping name = title', () => {
    const plan = projectIntent(MEDITATION, 'habit', { genId: counterGen() });
    expect(plan.rails[0]).toMatchObject({ name: '冥想', subtitle: '晨间' });
    expect(plan.rails[1]).toMatchObject({ name: '冥想', subtitle: '晚间' });
  });

  it('summary names the habit then each slot', () => {
    const plan = projectIntent(MEDITATION, 'habit', { genId: counterGen() });
    expect(plan.summary).toHaveLength(3); // habit line + two slots
    expect(plan.summary[0]).toContain('冥想');
    expect(plan.summary[1]).toContain('07:00–07:05');
    expect(plan.summary[2]).toContain('22:00–22:05');
  });
});

describe('projectIntent · task shape (same intent, different shape)', () => {
  it('projects the same spec into an Inbox task instead of a habit', () => {
    const plan = projectIntent(MEDITATION, 'task', { genId: counterGen() });
    expect(plan.shape).toBe('task');
    expect(plan.line).toBeUndefined();
    expect(plan.rails).toHaveLength(0);
    expect(plan.bindings).toHaveLength(0);
    expect(plan.task).toMatchObject({
      title: '冥想',
      lineId: INBOX_LINE_ID,
      status: 'pending',
      order: 0,
    });
  });

  it('turns named times into discrete-step occurrences', () => {
    const plan = projectIntent(MEDITATION, 'task', { genId: counterGen() });
    expect(plan.occurrences.map((o) => o.label)).toEqual(['晨间', '晚间']);
  });

  it('a bare title with no times → a single task, no occurrences', () => {
    const plan = projectIntent(
      { title: '打电话给牙医', frequency: 'once', times: [] },
      'task',
      { genId: counterGen() },
    );
    expect(plan.task?.title).toBe('打电话给牙医');
    expect(plan.occurrences).toHaveLength(0);
  });
});

describe('projectIntent · shape switch is deterministic re-projection', () => {
  it('the same spec yields a habit graph or a task graph by shape alone (no AI)', () => {
    const asHabit = projectIntent(MEDITATION, 'habit', { genId: counterGen(), now: 0 });
    const asTask = projectIntent(MEDITATION, 'task', { genId: counterGen() });
    expect(asHabit.line).toBeDefined();
    expect(asHabit.task).toBeUndefined();
    expect(asTask.task).toBeDefined();
    expect(asTask.line).toBeUndefined();
  });

  it('re-projecting the same (spec, shape, genId) is stable', () => {
    const a = projectIntent(MEDITATION, 'habit', { genId: counterGen(), now: 0 });
    const b = projectIntent(MEDITATION, 'habit', { genId: counterGen(), now: 0 });
    expect(a).toEqual(b);
  });

  it('carries an optional note onto the projected entity', () => {
    const withNote: IntentSpec = { ...MEDITATION, note: '深呼吸' };
    expect(projectIntent(withNote, 'habit', { genId: counterGen() }).line?.note).toBe('深呼吸');
    expect(projectIntent(withNote, 'task', { genId: counterGen() }).task?.note).toBe('深呼吸');
  });
});
