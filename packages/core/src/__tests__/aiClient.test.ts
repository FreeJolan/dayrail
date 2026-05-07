// Tests for the OpenAI-compatible AI client (packages/core/src/ai/client.ts).
//
// v0.8.2 dogfood reversal: the original SSE parsing tests
// (consumeSse / parseSseBuffer / extractContentDelta) are gone now
// that streaming is delegated to the Vercel AI SDK
// (`@ai-sdk/openai-compatible` + `ai`). The SDK has its own test
// coverage; we trust it. What stays here:
//
//   - parseModelList: response-shape tolerance for /v1/models is
//     genuinely our problem (envelope variance across providers).
//   - listModels: end-to-end fetch + error classification for the
//     /v1/models endpoint.
//
// `callChatCompletion` is now a thin wrapper around `streamText`;
// mocking the SDK to test the wrapper would mostly test the SDK
// rather than our integration. Trust the SDK; verify the wrapper at
// runtime via real-call dogfood instead.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiClientError, listModels, parseModelList } from '../ai/client';

afterEach(() => {
  vi.restoreAllMocks();
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

  it('classifies 401 as auth-401 with body excerpt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"bad key"}', { status: 401 }),
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
      expect((err as AiClientError).kind).toBe('auth-401');
      expect((err as AiClientError).bodyExcerpt).toContain('bad key');
    }
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
      expect((err as AiClientError).message).toMatch(
        /may not implement \/v1\/models/,
      );
    }
  });

  it('classifies 429 as rate-limit-429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })),
    );
    try {
      await listModels({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
      });
      throw new Error('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('rate-limit-429');
    }
  });

  it('classifies generic 5xx as provider-error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('upstream sad', { status: 502 })),
    );
    try {
      await listModels({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
      });
      throw new Error('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('provider-error');
    }
  });

  it('classifies "Failed to fetch" TypeError as cors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    try {
      await listModels({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
      });
      throw new Error('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('cors');
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
