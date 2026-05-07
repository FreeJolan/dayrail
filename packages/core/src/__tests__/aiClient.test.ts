// Tests for the OpenAI-compatible AI client (packages/core/src/ai/client.ts).
//
// Coverage focus per ERD §6.6:
//   - SSE chunk parsing across boundaries (assembly + buffering)
//   - JSON extraction tolerating ```json fences + prose around braces
//   - Error classification (network / cors / 401 / 404 / 429 / 5xx / parse)
//
// fetch is mocked; no real network. We exercise the response stream
// path by constructing a ReadableStream from canned chunks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiClientError,
  callChatCompletion,
  extractJsonFromResponse,
  listModels,
  parseModelList,
  parseSseBuffer,
} from '../ai/client';

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------ extractJsonFromResponse ------------

describe('extractJsonFromResponse', () => {
  it('parses a bare JSON object', () => {
    const got = extractJsonFromResponse('{"observation":"hi","patterns":[],"suggestions":[]}');
    expect(got).toEqual({ observation: 'hi', patterns: [], suggestions: [] });
  });

  it('strips ```json fences', () => {
    const text = '```json\n{"observation":"x","patterns":[],"suggestions":[]}\n```';
    expect(extractJsonFromResponse(text)).toEqual({
      observation: 'x',
      patterns: [],
      suggestions: [],
    });
  });

  it('strips bare ``` fences without language tag', () => {
    const text = '```\n{"observation":"y","patterns":[],"suggestions":[]}\n```';
    expect(extractJsonFromResponse(text)).toEqual({
      observation: 'y',
      patterns: [],
      suggestions: [],
    });
  });

  it('tolerates prose before and after braces', () => {
    const text =
      'Here is what I noticed: {"observation":"z","patterns":["a"],"suggestions":[]} hope it helps.';
    expect(extractJsonFromResponse(text)).toEqual({
      observation: 'z',
      patterns: ['a'],
      suggestions: [],
    });
  });

  it('throws AiClientError parse-error on empty input', () => {
    try {
      extractJsonFromResponse('');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('parse-error');
    }
  });

  it('throws AiClientError parse-error on malformed JSON', () => {
    try {
      extractJsonFromResponse('not even close to json');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('parse-error');
    }
  });
});

// ------------ parseSseBuffer ------------

describe('parseSseBuffer', () => {
  it('splits complete events on double newline', () => {
    const buf = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
    const { events, remainder } = parseSseBuffer(buf);
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(remainder).toBe('');
  });

  it('preserves a trailing partial event in the remainder', () => {
    const buf = 'data: {"a":1}\n\ndata: {"b":';
    const { events, remainder } = parseSseBuffer(buf);
    expect(events).toEqual(['{"a":1}']);
    expect(remainder).toBe('data: {"b":');
  });

  it('joins multi-line data: lines with newline (per SSE spec)', () => {
    const buf = 'data: line one\ndata: line two\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toEqual(['line one\nline two']);
  });

  it('normalizes CRLF to LF', () => {
    const buf = 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n';
    const { events, remainder } = parseSseBuffer(buf);
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(remainder).toBe('');
  });

  it('skips event blocks without a data: line', () => {
    const buf = ': comment\n\ndata: {"x":3}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toEqual(['{"x":3}']);
  });
});

// ------------ callChatCompletion · happy path ------------

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i]!));
      i += 1;
    },
  });
}

describe('callChatCompletion', () => {
  it('assembles SSE deltas into a single string', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(streamFromString(sse), { status: 200 }),
      ),
    );

    const out = await callChatCompletion({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out).toBe('Hello');
  });

  it('handles SSE deltas split across chunk boundaries', async () => {
    // Split a single event mid-bytes to exercise the buffer.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          streamFromChunks([
            'data: {"choices":[{"delta":{"con',
            'tent":"split"}}]}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
      ),
    );

    const out = await callChatCompletion({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out).toBe('split');
  });

  it('strips trailing slash from baseUrl when joining /chat/completions', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(streamFromString('data: [DONE]\n\n'), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await callChatCompletion({
      baseUrl: 'https://example.test/v1/',
      apiKey: 'sk-test',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [calledUrl] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe('https://example.test/v1/chat/completions');
  });
});

// ------------ callChatCompletion · error classification ------------

describe('callChatCompletion error classification', () => {
  async function expectKind(
    response: Response | Error,
    kind: AiClientError['kind'],
  ): Promise<void> {
    if (response instanceof Error) {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(response));
    } else {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    }
    try {
      await callChatCompletion({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      });
      throw new Error('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe(kind);
    }
  }

  it('classifies 401 as auth-401', async () => {
    await expectKind(new Response('{"error":"bad key"}', { status: 401 }), 'auth-401');
  });

  it('classifies 404 as not-found-404', async () => {
    await expectKind(new Response('{"error":"no model"}', { status: 404 }), 'not-found-404');
  });

  it('classifies 429 as rate-limit-429', async () => {
    await expectKind(new Response('{"error":"slow down"}', { status: 429 }), 'rate-limit-429');
  });

  it('classifies generic 5xx as provider-error', async () => {
    await expectKind(new Response('upstream sad', { status: 502 }), 'provider-error');
  });

  it('classifies "Failed to fetch" TypeError as cors', async () => {
    await expectKind(new TypeError('Failed to fetch'), 'cors');
  });

  it('classifies generic network error as network', async () => {
    await expectKind(new Error('connection reset'), 'network');
  });
});

// ------------ parseModelList ------------

describe('parseModelList', () => {
  it('reads OpenAI-compat { data: [...] } shape', () => {
    expect(
      parseModelList({
        data: [
          { id: 'claude-3-5-sonnet', owned_by: 'anthropic' },
          { id: 'gpt-4o-mini' },
        ],
      }),
    ).toEqual([{ id: 'claude-3-5-sonnet' }, { id: 'gpt-4o-mini' }]);
  });

  it('reads bare top-level array', () => {
    expect(parseModelList([{ id: 'llama-3.1-8b' }])).toEqual([
      { id: 'llama-3.1-8b' },
    ]);
  });

  it('reads alt { models: [...] } envelope used by some self-hosted backends', () => {
    expect(parseModelList({ models: [{ id: 'mistral-large' }] })).toEqual([
      { id: 'mistral-large' },
    ]);
  });

  it('accepts string entries (some backends return ids only)', () => {
    expect(parseModelList(['gpt-4o', 'claude-3-haiku'])).toEqual([
      { id: 'gpt-4o' },
      { id: 'claude-3-haiku' },
    ]);
  });

  it('drops entries without a string id', () => {
    expect(
      parseModelList({
        data: [
          { id: 'good-model' },
          { name: 'no id' },
          { id: 42 },
          { id: '' },
          null,
        ],
      }),
    ).toEqual([{ id: 'good-model' }]);
  });

  it('returns empty array on totally unfamiliar shape', () => {
    expect(parseModelList({ totally: 'unexpected' })).toEqual([]);
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList(undefined)).toEqual([]);
    expect(parseModelList(42)).toEqual([]);
  });
});

// ------------ listModels ------------

describe('listModels', () => {
  it('GETs {baseUrl}/models with the API key in Authorization', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'claude-3-5-sonnet' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const out = await listModels({
      baseUrl: 'https://example.test/v1/',
      apiKey: 'sk-test',
    });
    expect(out).toEqual([{ id: 'claude-3-5-sonnet' }]);

    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe('https://example.test/v1/models');
    expect((init as RequestInit).method).toBe('GET');
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ Authorization: 'Bearer sk-test' });
  });

  it('classifies 404 distinctly so caller can suggest "manual entry"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );
    try {
      await listModels({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
      });
      throw new Error('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('not-found-404');
      expect((err as AiClientError).message).toMatch(/may not implement \/v1\/models/);
    }
  });

  it('throws parse-error when the response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('plain text not json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      ),
    );
    try {
      await listModels({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
      });
      throw new Error('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('parse-error');
    }
  });

  it('returns empty array when the JSON is well-formed but unfamiliar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ unexpected: 'shape' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const out = await listModels({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
    });
    expect(out).toEqual([]);
  });
});
