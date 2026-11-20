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
// `callChatCompletion` runs against the REAL AI SDK with a stubbed
// global `fetch`: the SDK's streaming error contract is exactly what
// bit us once (v6 textStream silently swallows HTTP errors — see the
// callChatCompletion describe below), so the integration IS our
// problem and gets covered end-to-end here.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { APICallError } from 'ai';
import {
  AiClientError,
  callChatCompletion,
  listModels,
  mapToAiClientError,
  parseModelList,
} from '../ai/client';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── fetch fixtures ─────────────────────────────────────────────────

const SSE_HEADERS = { 'Content-Type': 'text/event-stream' };

/** A well-formed OpenAI-compatible streaming response. */
function sseResponse(...contents: string[]): Response {
  const encoder = new TextEncoder();
  const lines = [
    ...contents.map(
      (content) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    ),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

/** Accepts the connection, sends headers, then never sends a byte —
 *  the hung-bridge scenario. Honors the request's abort signal the way
 *  real fetch does (rejects the pending read). */
function hangingSseResponse(init?: RequestInit): Response {
  const signal = init?.signal;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => {
        controller.error(
          signal.reason ?? new DOMException('Aborted', 'AbortError'),
        );
      });
    },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

function errorResponse(status: number): Response {
  return new Response(
    JSON.stringify({ error: { message: `upstream said ${status}` } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

const chatParams = () => ({
  baseUrl: 'https://example.test/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'hi' }],
});

/** Capture the rejection (fails the test on resolution). */
function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (err) => err,
  );
}

/** Drive fake timers in small steps until `p` settles. (Backoff timers
 *  are scheduled only after async hops — a single big advance can run
 *  before anything is on the clock and then just no-op.) */
async function advanceUntilSettled<T>(p: Promise<T>, maxMs = 30_000): Promise<T> {
  let settled = false;
  const tracked = p.finally(() => {
    settled = true;
  });
  tracked.catch(() => {}); // avoid an unhandled-rejection report while driving
  for (let elapsed = 0; elapsed < maxMs && !settled; elapsed += 500) {
    await vi.advanceTimersByTimeAsync(500);
  }
  return tracked;
}

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

  it('times out instead of pending forever when the provider never responds', async () => {
    // No production caller passes a signal, so without the default
    // timeout this promise would simply never settle.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(
                init.signal?.reason ?? new DOMException('Aborted', 'AbortError'),
              ),
            );
          }),
      ),
    );
    const err = await rejection(
      listModels({ baseUrl: 'https://example.test/v1', apiKey: 'k', timeoutMs: 50 }),
    );
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('network');
    expect((err as AiClientError).message).toMatch(/timed out/i);
  });

  it('still classifies a caller abort as aborted, not as a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(
                init.signal?.reason ?? new DOMException('Aborted', 'AbortError'),
              ),
            );
          }),
      ),
    );
    const ac = new AbortController();
    const pending = rejection(
      listModels({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
        signal: ac.signal,
      }),
    );
    ac.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('aborted');
  });
});

// ------------ callChatCompletion ------------
//
// AI SDK v6's `textStream` silently swallows error parts: an HTTP
// failure (401/403/404/429/5xx) used to make callChatCompletion
// resolve to '' instead of throwing, which broke error classification
// AND the cold-start 403 retry. These run against the real SDK with a
// stubbed fetch to pin the error-surfacing contract.

describe('callChatCompletion', () => {
  it('streams and assembles content, forwarding deltas to onChunk', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('Hel', 'lo')));
    const chunks: string[] = [];
    const out = await callChatCompletion({
      ...chatParams(),
      onChunk: (d) => chunks.push(d),
    });
    expect(out).toBe('Hello');
    expect(chunks).toEqual(['Hel', 'lo']);
  });

  it('surfaces a streaming 401 as auth-401 instead of resolving to an empty string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => errorResponse(401)),
    );
    const err = await rejection(callChatCompletion(chatParams()));
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('auth-401');
    expect((err as AiClientError).status).toBe(401);
  });

  it('classifies a streaming 429 as rate-limit-429', async () => {
    // Fresh Response per call: the SDK retries retryable statuses
    // internally with multi-second backoff — drive it with fake timers.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => errorResponse(429)),
    );
    vi.useFakeTimers();
    const err = await advanceUntilSettled(
      rejection(callChatCompletion(chatParams())),
    );
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('rate-limit-429');
    expect((err as AiClientError).status).toBe(429);
  });

  it('classifies a streaming 5xx as provider-error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => errorResponse(502)),
    );
    vi.useFakeTimers();
    const err = await advanceUntilSettled(
      rejection(callChatCompletion(chatParams())),
    );
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('provider-error');
    expect((err as AiClientError).status).toBe(502);
  });

  it('retries a cold-start 403 and succeeds once the bridge warms up', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementationOnce(async () => errorResponse(403))
      .mockImplementation(async () => sseResponse('warm'));
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
    const out = await advanceUntilSettled(callChatCompletion(chatParams()));
    expect(out).toBe('warm');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung stream via the idle watchdog instead of pending forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (_url: string, init: RequestInit) =>
          hangingSseResponse(init),
        ),
    );
    const err = await rejection(
      callChatCompletion({ ...chatParams(), idleTimeoutMs: 50 }),
    );
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('network');
    expect((err as AiClientError).message).toMatch(/no stream activity/);
  });

  it('keeps a caller abort classified as aborted, not as a watchdog timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (_url: string, init: RequestInit) =>
          hangingSseResponse(init),
        ),
    );
    const ac = new AbortController();
    const pending = rejection(
      callChatCompletion({ ...chatParams(), signal: ac.signal }),
    );
    setTimeout(() => ac.abort(), 20);
    const err = await pending;
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe('aborted');
  });
});

// ------------ mapToAiClientError ------------

describe('mapToAiClientError', () => {
  it('maps a TimeoutError DOMException (AbortSignal.timeout) to a network timeout', () => {
    const err = mapToAiClientError(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      APICallError,
    );
    expect(err.kind).toBe('network');
    expect(err.message).toMatch(/timed out/i);
  });
});
