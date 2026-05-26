// ERD §6.6 v0.8.2 — OpenAI-compatible AI client.
//
// Streaming + chat-completion go through the Vercel AI SDK
// (`@ai-sdk/openai-compatible` + `ai`), loaded **dynamically** so the
// PWA cold-start bundle stays slim for users who never enable AI
// (default-off per §6.4). The SDK adds ~80 KB gzipped to the AI
// chunk on first use; that's amortized across subsequent calls in
// the same session.
//
// The SDK handles SSE parsing, chunk buffering, encoding edge cases,
// and error categorization — which were ~120 lines of hand-rolled
// code in earlier v0.8.2 commits before dogfood revealed how many
// edge cases live there. ERD §6.6 "prefer mature off-the-shelf
// components for streaming" applies.
//
// `listModels` stays hand-rolled because /v1/models is not first-class
// in the AI SDK and the response shape varies more than the SDK
// abstraction allows. It's a 60-line GET + defensive parser.

// Type-only imports stay static so consumers get IntelliSense; the
// runtime values (`streamText`, `APICallError`, `createOpenAICompatible`)
// are loaded on demand inside `callChatCompletion`.
import type { APICallError as APICallErrorType } from 'ai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallChatCompletionParams {
  /** Base URL of an OpenAI-compatible API root, e.g.
   *  `https://openrouter.ai/api/v1`. Trailing slash optional. */
  baseUrl: string;
  /** Bearer token. Most providers want a non-empty value; some local
   *  bridges accept anything. The SDK forwards it via Authorization. */
  apiKey: string;
  /** Model id passed verbatim to the provider. */
  model: string;
  /** OpenAI-style messages array. */
  messages: ChatMessage[];
  /** Optional cancellation. Forwarded to `streamText`'s abortSignal. */
  signal?: AbortSignal;
  /** Optional per-delta callback. Each `delta` is a fragment of
   *  assistant content as it streams in. The promise still resolves
   *  to the full assembled string at the end. */
  onChunk?: (delta: string) => void;
}

export type AiClientErrorKind =
  | 'network' // fetch threw (connection refused, DNS, generic TypeError)
  | 'cors' // browser-side cross-origin failure (common with local CLI bridges)
  | 'auth-401' // bad / missing key
  | 'not-found-404' // wrong base URL or model
  | 'rate-limit-429' // throttled
  | 'provider-error' // 5xx or other non-2xx
  | 'parse-error' // SSE / JSON parse failed (rare with SDK; kept for safety)
  | 'aborted'; // signal aborted

export class AiClientError extends Error {
  readonly kind: AiClientErrorKind;
  readonly status?: number;
  readonly bodyExcerpt?: string;

  constructor(
    kind: AiClientErrorKind,
    message: string,
    opts: { status?: number; bodyExcerpt?: string } = {},
  ) {
    super(message);
    this.name = 'AiClientError';
    this.kind = kind;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.bodyExcerpt !== undefined) this.bodyExcerpt = opts.bodyExcerpt;
  }
}

// ── Cold-start 403 retry ───────────────────────────────────────────
//
// Some local OpenAI-compatible bridges return HTTP 403
// `{"error":{"type":"forbidden","message":"Request not allowed"}}` for
// the first few seconds after the bridge / upstream credential goes
// cold (observed with CLIProxyAPI's Claude OAuth path: a few-second
// warmup window after (re)start / idle, then it succeeds and stays
// warm — the OAuth token is NOT refreshed, so it's a session/cloak
// warmup, not auth expiry). The bridge's own retry fires sub-second,
// inside that window, so it can't mask it. We retry with a multi-second
// backoff that outlasts the warmup. Empirically the window was > 0.5s
// and ≤ 6s after a cold start, so the schedule below lands attempts at
// t=0, +2s, +6s. Scoped to 403 only — 401 (bad key) / 404 / 429
// (rate-limit, must not hammer) / aborts propagate immediately.
const COLD_START_403_BACKOFFS_MS = [2000, 4000];

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiClientError('aborted', 'Request aborted by caller'));
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AiClientError('aborted', 'Request aborted by caller'));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Run `attempt`; on an `AiClientError` with HTTP 403, wait and retry
 *  per `COLD_START_403_BACKOFFS_MS`. `attempt` MUST map its failures to
 *  `AiClientError` (so `.status` is readable). All non-403 errors and
 *  aborts surface immediately. A 403 that happens before any output is
 *  re-attempted cleanly; callers that stream should only emit output
 *  after the first successful chunk (a 403 precedes the body). */
export async function withColdStart403Retry<T>(
  attempt: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      const backoff = COLD_START_403_BACKOFFS_MS[i]; // undefined once exhausted
      if (
        backoff === undefined ||
        !(err instanceof AiClientError) ||
        err.status !== 403 ||
        signal?.aborted
      ) {
        throw err;
      }
      await sleepAbortable(backoff, signal);
    }
  }
}

/** Issue one chat completion against an OpenAI-compatible endpoint
 *  with streaming on. Returns the assembled assistant content as a
 *  single string. Throws `AiClientError` on any failure path. */
export async function callChatCompletion(
  params: CallChatCompletionParams,
): Promise<string> {
  const { baseUrl, apiKey, model, messages, signal, onChunk } = params;

  // Dynamic import: the AI SDK + provider together are ~80 KB gzipped
  // and we want them off the cold-start path for users who never
  // enable AI. Vite splits these into a separate async chunk; the
  // first call pays a one-time download cost, subsequent calls are
  // instant from the browser cache.
  const [{ streamText, APICallError }, { createOpenAICompatible }] =
    await Promise.all([
      import('ai'),
      import('@ai-sdk/openai-compatible'),
    ]);

  const provider = createOpenAICompatible({
    name: 'dayrail-custom',
    baseURL: baseUrl.replace(/\/+$/, ''),
    apiKey,
  });

  // Wrap in the cold-start 403 retry: a 403 arrives before any stream
  // body, so a re-attempt never double-emits via onChunk.
  return withColdStart403Retry(async () => {
    const result = streamText({
      model: provider(model),
      messages,
      ...(signal && { abortSignal: signal }),
    });

    let assembled = '';
    try {
      for await (const delta of result.textStream) {
        assembled += delta;
        if (onChunk && delta.length > 0) onChunk(delta);
      }
      return assembled;
    } catch (err) {
      throw mapToAiClientError(err, APICallError);
    }
  }, signal);
}

/** Map any thrown error from the AI SDK / fetch layer onto our
 *  classified `AiClientError`. The SDK throws `APICallError` for
 *  HTTP-level failures with a `responseBody` we can surface; other
 *  errors fall back to network / cors / aborted heuristics.
 *
 *  `APICallErrorCtor` is passed in (not statically imported) because
 *  the SDK is dynamically loaded — see `callChatCompletion`. */
export function mapToAiClientError(
  err: unknown,
  APICallErrorCtor: typeof APICallErrorType,
): AiClientError {
  if (err instanceof AiClientError) return err;

  if (APICallErrorCtor.isInstance(err)) {
    const status = (err as { statusCode?: number }).statusCode;
    const rawBody = (err as { responseBody?: string }).responseBody;
    const body =
      typeof rawBody === 'string' && rawBody.length > 0
        ? rawBody.slice(0, 500)
        : undefined;
    const opts = {
      ...(status !== undefined && { status }),
      ...(body !== undefined && { bodyExcerpt: body }),
    };
    if (status === 401) {
      return new AiClientError(
        'auth-401',
        'Provider rejected the API key (401).',
        opts,
      );
    }
    if (status === 404) {
      return new AiClientError(
        'not-found-404',
        'Endpoint or model not found (404). Check Base URL and Model name.',
        opts,
      );
    }
    if (status === 429) {
      return new AiClientError(
        'rate-limit-429',
        'Provider rate-limited the request (429). Try again in a moment.',
        opts,
      );
    }
    return new AiClientError(
      'provider-error',
      status !== undefined
        ? `Provider returned ${status}.`
        : 'Provider returned a non-2xx response.',
      opts,
    );
  }

  // Abort
  if (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err as { name?: string }).name === 'AbortError'
  ) {
    return new AiClientError('aborted', 'Request aborted by caller');
  }

  // CORS / network heuristic — TypeError("Failed to fetch") is the
  // canonical browser CORS failure.
  const message = (err as Error).message ?? String(err);
  const lower = message.toLowerCase();
  if (
    err instanceof TypeError &&
    (lower.includes('failed to fetch') ||
      lower.includes('cors') ||
      lower.includes('cross-origin'))
  ) {
    return new AiClientError(
      'cors',
      `Network or CORS failure. If you are using a local CLI bridge (claude-code-router / Ollama / etc.) make sure it allows CORS from this origin.`,
    );
  }

  return new AiClientError('network', `Network failure: ${message}`);
}

// ============ /v1/models · model autocomplete ============
//
// Hand-rolled because /v1/models is not first-class in the AI SDK,
// and the response shape varies (canonical { data: [...] } vs bare
// arrays vs alt envelopes used by self-hosted backends). One small
// fetch + a defensive parser is the right level for this corner.

export interface ModelInfo {
  /** Model id passed verbatim into the `model` field of subsequent
   *  `/chat/completions` calls. */
  id: string;
}

export interface ListModelsParams {
  /** Same Base URL as `callChatCompletion` — `/models` is appended. */
  baseUrl: string;
  /** Bearer token. Most providers require it; some local bridges
   *  accept anything. We always send the header. */
  apiKey: string;
  /** Optional cancellation. */
  signal?: AbortSignal;
}

/** ERD §6.6 v0.8.2 — fetch the `/v1/models` autocomplete list.
 *
 *  OpenAI-compat standardizes the response as `{ data: [{ id, ... }] }`,
 *  but locally-grown bridges sometimes return a bare array or omit
 *  the wrapper. We accept both. Returns an empty array if the shape
 *  is unfamiliar — caller can fall back to free-text input. */
export async function listModels(
  params: ListModelsParams,
): Promise<ModelInfo[]> {
  const { baseUrl, apiKey, signal } = params;
  const url = joinUrl(baseUrl, '/models');
  const init: RequestInit = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    ...(signal && { signal }),
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (signal?.aborted) {
      throw new AiClientError('aborted', 'Request aborted by caller');
    }
    if (looksLikeCors(err)) {
      throw new AiClientError(
        'cors',
        `Network or CORS failure reaching ${url}. If you are using a local CLI bridge (claude-code-router / Ollama / etc.) make sure it allows CORS from this origin.`,
      );
    }
    throw new AiClientError(
      'network',
      `Network failure reaching ${url}: ${(err as Error).message ?? String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await safeReadBody(res);
    const opts = { status: res.status, bodyExcerpt: body };
    if (res.status === 401)
      throw new AiClientError(
        'auth-401',
        'Provider rejected the API key (401).',
        opts,
      );
    if (res.status === 404)
      throw new AiClientError(
        'not-found-404',
        'Endpoint not found (404). The provider may not implement /v1/models — fill the Model field manually.',
        opts,
      );
    if (res.status === 429)
      throw new AiClientError(
        'rate-limit-429',
        'Provider rate-limited the request (429). Try again in a moment.',
        opts,
      );
    throw new AiClientError(
      'provider-error',
      `Provider returned ${res.status} when listing models.`,
      opts,
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    throw new AiClientError(
      'parse-error',
      `Could not parse /models response as JSON: ${(err as Error).message}`,
    );
  }
  return parseModelList(payload);
}

/** Pull `[{ id }]` out of an OpenAI-compat models payload. Defensive:
 *  accept `{ data: [...] }` (canonical), `{ models: [...] }`
 *  (sometimes used by self-hosted backends), or a bare top-level array. */
export function parseModelList(payload: unknown): ModelInfo[] {
  let raw: unknown;
  if (Array.isArray(payload)) {
    raw = payload;
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    raw = obj.data ?? obj.models ?? null;
  }
  if (!Array.isArray(raw)) return [];
  const out: ModelInfo[] = [];
  for (const entry of raw) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      out.push({ id: entry });
      continue;
    }
    if (typeof entry !== 'object') continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) {
      out.push({ id });
    }
  }
  return out;
}

// ============ Helpers ============

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return trimmed + suffix;
}

function looksLikeCors(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('cors') ||
    m.includes('cross-origin')
  );
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}
