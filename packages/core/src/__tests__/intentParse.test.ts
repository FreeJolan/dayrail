import { describe, expect, it } from 'vitest';
import {
  parseIntentsFromText,
  parseResultSchema,
  toProposalDraft,
  type IntentObjectGenerator,
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
        { startMinutes: 420, durationMinutes: 5 },
        { startMinutes: 1350 },
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
  it('rejects a habit slot with out-of-range startMinutes', () => {
    expect(
      parseResultSchema.safeParse({
        proposals: [{ kind: 'habit', name: 'x', slots: [{ startMinutes: 99999 }] }],
      }).success,
    ).toBe(false);
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
});

describe('toProposalDraft', () => {
  it('habit slots become mode:new with defaults filled', () => {
    const d = toProposalDraft(VALID.proposals[0]!);
    expect(d.kind).toBe('habit');
    if (d.kind === 'habit') {
      expect(d.slots).toHaveLength(2);
      expect(d.slots[0]).toMatchObject({ mode: 'new', startMinutes: 420, durationMinutes: 5 });
      expect(d.slots[1]).toMatchObject({ mode: 'new', startMinutes: 1350 });
    }
  });
  it('task lineId defaults to Inbox, steps default to []', () => {
    const d = toProposalDraft({ kind: 'task', title: '写报告' });
    expect(d.kind).toBe('task');
    if (d.kind === 'task') {
      expect(d.lineId).toBe(INBOX_LINE_ID);
      expect(d.steps).toEqual([]);
    }
  });
  it('carries task priority + steps through', () => {
    const d = toProposalDraft(VALID.proposals[1]!);
    if (d.kind === 'task') {
      expect(d.priority).toBe('P1');
      expect(d.steps).toEqual([{ label: '提纲', percent: 20 }]);
    }
  });
});

describe('parseIntentsFromText', () => {
  const config: ParseIntentsConfig = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };

  it('maps model output to native drafts', async () => {
    const generate: IntentObjectGenerator = async () => VALID;
    const out = await parseIntentsFromText('whatever', config, generate);
    expect(out.map((d) => d.kind)).toEqual(['habit', 'task']);
  });

  it('returns [] for empty / whitespace input without calling the model', async () => {
    let called = false;
    const generate: IntentObjectGenerator = async () => {
      called = true;
      return VALID;
    };
    expect(await parseIntentsFromText('   ', config, generate)).toEqual([]);
    expect(called).toBe(false);
  });

  it('passes the parse system prompt + trimmed text to the generator', async () => {
    let seen: { system: string; prompt: string } | undefined;
    const generate: IntentObjectGenerator = async (_c, messages) => {
      seen = messages;
      return { proposals: [] };
    };
    await parseIntentsFromText('  hello  ', config, generate);
    expect(seen?.prompt).toBe('hello');
    expect(seen?.system).toContain('emit_proposals');
  });

  it('propagates a generator error', async () => {
    const generate: IntentObjectGenerator = async () => {
      throw new Error('boom');
    };
    await expect(parseIntentsFromText('x', config, generate)).rejects.toThrow('boom');
  });
});
