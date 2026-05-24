import { describe, expect, it } from 'vitest';
import {
  parseIntentsFromText,
  parseResultSchema,
  toProposalDraft,
  type IntentObjectGenerator,
  type ParseContext,
  type ParseIntentsConfig,
  type ParseResult,
} from '../intentParse';
import { INBOX_LINE_ID } from '../types';

const VALID: ParseResult = {
  proposals: [
    {
      kind: 'habit',
      name: '冥想',
      slots: [
        { bind: 'new', startMinutes: 420, durationMinutes: 5 },
        { bind: 'new', startMinutes: 1350 },
      ],
    },
    { kind: 'task', title: '写季度总结初稿', priority: 'P1', steps: [{ label: '提纲', percent: 20 }] },
  ],
};

describe('parseResultSchema · closed contract', () => {
  it('accepts valid task + habit proposals', () => {
    expect(parseResultSchema.safeParse(VALID).success).toBe(true);
  });
  it('rejects an unknown kind', () => {
    expect(
      parseResultSchema.safeParse({ proposals: [{ kind: 'adhoc', title: 'x' }] }).success,
    ).toBe(false);
  });
  it('rejects a new-rail habit slot with out-of-range startMinutes', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'habit', name: 'x', slots: [{ bind: 'new', startMinutes: 99999 }] }],
      }).success,
    ).toBe(false);
  });
  it('rejects a habit slot missing the bind discriminator', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'habit', name: 'x', slots: [{ startMinutes: 420 }] }],
      }).success,
    ).toBe(false);
  });
  it('accepts an existing-rail habit slot', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'habit', name: 'x', slots: [{ bind: 'existing', railId: 'rail-a' }] }],
      }).success,
    ).toBe(true);
  });
  it('accepts a new-rail slot scoped to specific templates', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [
          {
            kind: 'habit',
            name: 'x',
            slots: [{ bind: 'new', startMinutes: 420, templateKeys: ['workday', 'restday'] }],
          },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects an empty task title', () => {
    expect(parseResultSchema.safeParse({ proposals: [{ kind: 'task', title: '' }] }).success).toBe(
      false,
    );
  });
  it('rejects a bad priority', () => {
    expect(
      parseResultSchema.safeParse({ proposals: [{ kind: 'task', title: 'x', priority: 'P9' }] })
        .success,
    ).toBe(false);
  });
  it('rejects a step percent above 100', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'task', title: 'x', steps: [{ label: 's', percent: 200 }] }],
      }).success,
    ).toBe(false);
  });
  it('accepts a step with a valid milestone percent', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'task', title: 'x', steps: [{ label: '初稿', percent: 20 }] }],
      }).success,
    ).toBe(true);
  });
  it('accepts a whole-task rail schedule', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'task', title: 'x', schedule: { bind: 'rail', railId: 'rail-a' } }],
      }).success,
    ).toBe(true);
  });
  it('accepts a whole-task free-time schedule', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'task', title: 'x', schedule: { bind: 'free', startMinutes: 540 } }],
      }).success,
    ).toBe(true);
  });
  it('accepts a step with an occurrence rail schedule', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [
          { kind: 'task', title: 'x', steps: [{ label: '初稿', schedule: { railId: 'rail-a' } }] },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects a task schedule missing the bind discriminator', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'task', title: 'x', schedule: { railId: 'rail-a' } }],
      }).success,
    ).toBe(false);
  });
});

describe('toProposalDraft', () => {
  it('new-rail habit slots become mode:new with defaults filled', () => {
    const d = toProposalDraft(VALID.proposals[0]!);
    expect(d.kind).toBe('habit');
    if (d.kind === 'habit') {
      expect(d.slots).toHaveLength(2);
      expect(d.slots[0]).toMatchObject({ mode: 'new', startMinutes: 420, durationMinutes: 5 });
      expect(d.slots[1]).toMatchObject({ mode: 'new', startMinutes: 1350 });
      // No template restriction ⇒ templateKeys omitted (= every day at commit).
      expect((d.slots[0] as { templateKeys?: string[] }).templateKeys).toBeUndefined();
    }
  });
  it('existing-rail habit slot becomes mode:existing', () => {
    const d = toProposalDraft({
      kind: 'habit',
      name: 'x',
      slots: [{ bind: 'existing', railId: 'rail-evening', weekdays: [1, 3] }],
    });
    if (d.kind === 'habit') {
      expect(d.slots[0]).toMatchObject({ mode: 'existing', railId: 'rail-evening', weekdays: [1, 3] });
    }
  });
  it('carries new-rail templateKeys through', () => {
    const d = toProposalDraft({
      kind: 'habit',
      name: 'x',
      slots: [{ bind: 'new', startMinutes: 420, templateKeys: ['workday'] }],
    });
    if (d.kind === 'habit' && d.slots[0]?.mode === 'new') {
      expect(d.slots[0].templateKeys).toEqual(['workday']);
    }
  });
  it('task lineId defaults to Inbox, steps default to [], no schedule', () => {
    const d = toProposalDraft({ kind: 'task', title: '写报告' });
    expect(d.kind).toBe('task');
    if (d.kind === 'task') {
      expect(d.lineId).toBe(INBOX_LINE_ID);
      expect(d.steps).toEqual([]);
      expect(d.schedule).toBeUndefined();
    }
  });
  it('carries task priority + steps through', () => {
    const d = toProposalDraft(VALID.proposals[1]!);
    if (d.kind === 'task') {
      expect(d.priority).toBe('P1');
      expect(d.steps).toEqual([{ label: '提纲', percent: 20 }]);
    }
  });
  it('maps a whole-task rail schedule', () => {
    const d = toProposalDraft({
      kind: 'task',
      title: 'x',
      schedule: { bind: 'rail', railId: 'rail-a', date: '2026-05-25' },
    });
    if (d.kind === 'task') {
      expect(d.schedule).toEqual({ mode: 'rail', railId: 'rail-a', date: '2026-05-25' });
    }
  });
  it('maps a whole-task free schedule and drops a non-ISO date', () => {
    const d = toProposalDraft({
      kind: 'task',
      title: 'x',
      schedule: { bind: 'free', startMinutes: 540, durationMinutes: 45, date: 'tomorrow' },
    });
    if (d.kind === 'task' && d.schedule?.mode === 'free') {
      expect(d.schedule.startMinutes).toBe(540);
      expect(d.schedule.durationMinutes).toBe(45);
      expect(d.schedule.date).toBeUndefined(); // 'tomorrow' isn't ISO → dropped
    }
  });
  it('maps a step occurrence rail schedule', () => {
    const d = toProposalDraft({
      kind: 'task',
      title: 'x',
      steps: [{ label: '初稿', schedule: { railId: 'rail-a', date: '2026-05-25' } }],
    });
    if (d.kind === 'task') {
      expect(d.steps[0]?.schedule).toEqual({ railId: 'rail-a', date: '2026-05-25' });
    }
  });
});

describe('parseIntentsFromText', () => {
  const config: ParseIntentsConfig = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };

  it('maps model output to native drafts', async () => {
    const generate: IntentObjectGenerator = async () => VALID;
    const out = await parseIntentsFromText('whatever', config, undefined, generate);
    expect(out.map((d) => d.kind)).toEqual(['habit', 'task']);
  });

  it('returns [] for empty / whitespace input without calling the model', async () => {
    let called = false;
    const generate: IntentObjectGenerator = async () => {
      called = true;
      return VALID;
    };
    expect(await parseIntentsFromText('   ', config, undefined, generate)).toEqual([]);
    expect(called).toBe(false);
  });

  it('passes the parse system prompt + trimmed text to the generator', async () => {
    let seen: { system: string; prompt: string } | undefined;
    const generate: IntentObjectGenerator = async (_c, messages) => {
      seen = messages;
      return { proposals: [] };
    };
    await parseIntentsFromText('  hello  ', config, undefined, generate);
    expect(seen?.prompt).toBe('hello');
    expect(seen?.system).toContain('emit_proposals');
  });

  it('injects grounding context (rails + templates) into the system prompt', async () => {
    let seen: { system: string } | undefined;
    const generate: IntentObjectGenerator = async (_c, messages) => {
      seen = messages;
      return { proposals: [] };
    };
    const context: ParseContext = {
      templates: [{ key: 'workday', name: '工作日' }],
      rails: [{ id: 'rail-am', name: '晨间', templateKey: 'workday', startMinutes: 420, durationMinutes: 30 }],
    };
    await parseIntentsFromText('hi', config, context, generate);
    expect(seen?.system).toContain('Current setup');
    expect(seen?.system).toContain('rail-am');
    expect(seen?.system).toContain('07:00');
  });

  it('propagates a generator error', async () => {
    const generate: IntentObjectGenerator = async () => {
      throw new Error('boom');
    };
    await expect(parseIntentsFromText('x', config, undefined, generate)).rejects.toThrow('boom');
  });
});
