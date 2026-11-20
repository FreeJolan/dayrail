import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PARSE_TIMEOUT_MS,
  parseIntentsFromText,
  parseResultSchema,
  toProposalDraft,
  type IntentObjectGenerator,
  type ParseContext,
  type ParseIntentsConfig,
  type ParseResult,
} from '../intentParse';
import { AiClientError } from '../ai/client';
import { INBOX_LINE_ID } from '../types';

// The default generator calls the AI SDK's `generateText` (dynamically
// imported) — mock just that export so its response handling (forced
// tool call → Zod validation → error classification) is testable.
const generateTextMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock,
}));

afterEach(() => {
  generateTextMock.mockReset();
});

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
  it('drops calendar-impossible dates that match the ISO shape', () => {
    // "2025-02-30" / "2025-13-05" pass \d{4}-\d{2}-\d{2} but are not
    // real days; persisting them would produce slots no view renders
    // (and cycle-NaN-NaN-NaN for out-of-range months).
    const d = toProposalDraft({
      kind: 'task',
      title: 'x',
      schedule: { bind: 'rail', railId: 'rail-a', date: '2025-02-30' },
    });
    if (d.kind === 'task') {
      expect(d.schedule).toEqual({ mode: 'rail', railId: 'rail-a' });
    }
    const e = toProposalDraft({
      kind: 'task',
      title: 'x',
      steps: [{ label: 's', schedule: { railId: 'rail-a', date: '2025-13-05' } }],
    });
    if (e.kind === 'task') {
      expect(e.steps[0]?.schedule).toEqual({ railId: 'rail-a' });
    }
  });
  it('keeps a real calendar date (incl. a leap day)', () => {
    const d = toProposalDraft({
      kind: 'task',
      title: 'x',
      schedule: { bind: 'rail', railId: 'rail-a', date: '2028-02-29' },
    });
    if (d.kind === 'task') {
      expect(d.schedule).toEqual({ mode: 'rail', railId: 'rail-a', date: '2028-02-29' });
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

  describe('grounding check (§6.7.8)', () => {
    const context: ParseContext = {
      templates: [{ key: 'workday', name: '工作日' }],
      rails: [
        { id: 'rail-am', name: '晨间', templateKey: 'workday', startMinutes: 420, durationMinutes: 30 },
      ],
    };

    it('strips a hallucinated railId from a whole-task schedule but keeps the date', async () => {
      const generate: IntentObjectGenerator = async () => ({
        proposals: [
          {
            kind: 'task',
            title: 'x',
            schedule: { bind: 'rail', railId: 'rail-ghost', date: '2026-05-25' },
          },
        ],
      });
      const [d] = await parseIntentsFromText('x', config, context, generate);
      if (d?.kind === 'task') {
        // Degraded to unbound ('' = the review card's native "no rail
        // picked" state) instead of a dangling reference.
        expect(d.schedule).toEqual({ mode: 'rail', railId: '', date: '2026-05-25' });
      } else {
        throw new Error('expected a task draft');
      }
    });

    it('strips hallucinated step railIds but keeps grounded ones', async () => {
      const generate: IntentObjectGenerator = async () => ({
        proposals: [
          {
            kind: 'task',
            title: 'x',
            steps: [
              { label: 'ok', schedule: { railId: 'rail-am' } },
              { label: 'ghost', schedule: { railId: 'rail-ghost', date: '2026-05-25' } },
            ],
          },
        ],
      });
      const [d] = await parseIntentsFromText('x', config, context, generate);
      if (d?.kind === 'task') {
        expect(d.steps[0]?.schedule).toEqual({ railId: 'rail-am' });
        expect(d.steps[1]?.schedule).toEqual({ railId: '', date: '2026-05-25' });
      } else {
        throw new Error('expected a task draft');
      }
    });

    it('unbinds a habit slot pointing at a hallucinated rail and filters unknown templateKeys', async () => {
      const generate: IntentObjectGenerator = async () => ({
        proposals: [
          {
            kind: 'habit',
            name: 'h',
            slots: [
              { bind: 'existing', railId: 'rail-ghost', weekdays: [1, 3] },
              { bind: 'existing', railId: 'rail-am' },
              { bind: 'new', startMinutes: 420, templateKeys: ['ghostday', 'workday'] },
              { bind: 'new', startMinutes: 500, templateKeys: ['ghostday'] },
            ],
          },
        ],
      });
      const [d] = await parseIntentsFromText('x', config, context, generate);
      if (d?.kind === 'habit') {
        expect(d.slots[0]).toEqual({ mode: 'existing', railId: '', weekdays: [1, 3] });
        expect(d.slots[1]).toEqual({ mode: 'existing', railId: 'rail-am' });
        expect(d.slots[2]).toMatchObject({ mode: 'new', templateKeys: ['workday'] });
        // All-unknown keys → no restriction (= every template), which
        // the review card shows, instead of rails on ghost templates.
        expect((d.slots[3] as { templateKeys?: string[] }).templateKeys).toBeUndefined();
      } else {
        throw new Error('expected a habit draft');
      }
    });

    it('leaves references untouched when no grounding context was given', async () => {
      const generate: IntentObjectGenerator = async () => ({
        proposals: [
          { kind: 'task', title: 'x', schedule: { bind: 'rail', railId: 'rail-anything' } },
        ],
      });
      const [d] = await parseIntentsFromText('x', config, undefined, generate);
      if (d?.kind === 'task') {
        expect(d.schedule).toEqual({ mode: 'rail', railId: 'rail-anything' });
      }
    });
  });
});

// ── default generator (forced tool call via the AI SDK) ─────────────

describe('defaultGenerate response handling', () => {
  const config: ParseIntentsConfig = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };

  it('accepts a schema-valid forced tool call and passes a default timeout', async () => {
    generateTextMock.mockResolvedValue({
      text: '',
      toolCalls: [{ toolName: 'emit_proposals', input: VALID }],
    });
    const out = await parseIntentsFromText('x', config);
    expect(out.map((d) => d.kind)).toEqual(['habit', 'task']);
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: AI_PARSE_TIMEOUT_MS }),
    );
  });

  it('classifies schema-mismatched structured output as parse-error, not network', async () => {
    // e.g. the model writes percent as the string "20%" — a structured-
    // output failure of the MODEL; before the fix the ZodError fell into
    // mapToAiClientError's fallback and surfaced as「Network failure」.
    generateTextMock.mockResolvedValue({
      text: '',
      toolCalls: [
        {
          toolName: 'emit_proposals',
          input: {
            proposals: [{ kind: 'task', title: 'x', steps: [{ label: 's', percent: '20%' }] }],
          },
        },
      ],
    });
    const err = await parseIntentsFromText('x', config).then(
      () => {
        throw new Error('expected rejection');
      },
      (e) => e,
    );
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('parse-error');
    expect((err as AiClientError).message).not.toMatch(/network/i);
  });

  it('classifies a missing tool call as parse-error', async () => {
    generateTextMock.mockResolvedValue({ text: 'just prose', toolCalls: [] });
    const err = await parseIntentsFromText('x', config).then(
      () => {
        throw new Error('expected rejection');
      },
      (e) => e,
    );
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('parse-error');
  });
});
