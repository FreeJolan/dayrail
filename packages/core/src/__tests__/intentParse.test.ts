import { describe, expect, it } from 'vitest';
import {
  parseIntentsFromText,
  parseResultSchema,
  type IntentObjectGenerator,
  type ParseIntentsConfig,
  type ParseResult,
} from '../intentParse';

const VALID: ParseResult = {
  proposals: [
    {
      intent: {
        title: '冥想',
        frequency: 'daily',
        perOccurrenceDurationMinutes: 5,
        times: [{ startMinutes: 420, label: '晨间' }],
      },
      suggestedShape: 'habit',
    },
    {
      intent: { title: '写报告', frequency: 'once', times: [] },
      suggestedShape: 'task',
    },
  ],
};

describe('parseResultSchema · closed contract', () => {
  it('accepts a valid result', () => {
    expect(parseResultSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects an empty title', () => {
    const bad = {
      proposals: [{ intent: { title: '', frequency: 'daily', times: [] }, suggestedShape: 'habit' }],
    };
    expect(parseResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an out-of-range startMinutes', () => {
    const bad = {
      proposals: [
        {
          intent: { title: 'x', frequency: 'daily', times: [{ startMinutes: 99999 }] },
          suggestedShape: 'habit',
        },
      ],
    };
    expect(parseResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown shape (e.g. "adhoc", not yet supported)', () => {
    const bad = {
      proposals: [{ intent: { title: 'x', frequency: 'daily', times: [] }, suggestedShape: 'adhoc' }],
    };
    expect(parseResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a weekday outside 0..6', () => {
    const bad = {
      proposals: [
        {
          intent: { title: 'x', frequency: 'weekly', times: [{ startMinutes: 360, weekdays: [7] }] },
          suggestedShape: 'habit',
        },
      ],
    };
    expect(parseResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe('parseIntentsFromText', () => {
  const config: ParseIntentsConfig = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };

  it('maps parsed proposals to { intent, shape }', async () => {
    const generate: IntentObjectGenerator = async () => VALID;
    const out = await parseIntentsFromText('whatever', config, generate);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ shape: 'habit' });
    expect(out[0]?.intent.title).toBe('冥想');
    expect(out[1]).toMatchObject({ shape: 'task' });
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
    const generate: IntentObjectGenerator = async (_config, messages) => {
      seen = messages;
      return { proposals: [] };
    };
    await parseIntentsFromText('  hello  ', config, generate);
    expect(seen?.prompt).toBe('hello');
    expect(seen?.system).toContain('suggestedShape');
  });

  it('propagates a generator error', async () => {
    const generate: IntentObjectGenerator = async () => {
      throw new Error('boom');
    };
    await expect(parseIntentsFromText('x', config, generate)).rejects.toThrow('boom');
  });
});
