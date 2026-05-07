// ERD §6.6 v0.8.2 — OpenAI-compatible generic client.
//
// One `fetch` + manual SSE parser covers every compatible endpoint:
// OpenRouter / Groq / Together / Anthropic-via-proxy / Ollama /
// LM Studio / claude-code-router / claude-bridge. We deliberately
// do NOT depend on provider-specific `response_format: json_object`
// (behavior diverges across providers); structured output is enforced
// at the prompt level + recovered with `extractJsonFromResponse` on
// the client side.
//
// Streaming is on by design — provider-side compat for SSE is wider
// than for JSON-mode `response_format`. The first MVP collects all
// chunks into a single string before returning; that gives us the
// option to surface per-chunk UI later without rewriting the client.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallChatCompletionParams {
  /** Base URL of an OpenAI-compatible API root, e.g.
   *  `https://openrouter.ai/api/v1`. Trailing slash optional. */
  baseUrl: string;
  /** Bearer token. Most providers want a non-empty value; some local
   *  bridges accept empty (we still send the header). */
  apiKey: string;
  /** Model id, passed verbatim to the provider. */
  model: string;
  /** OpenAI-style messages array. */
  messages: ChatMessage[];
  /** Optional cancellation. */
  signal?: AbortSignal;
}

export type AiClientErrorKind =
  | 'network' // fetch threw (connection refused, DNS, generic TypeError)
  | 'cors' // browser-side cross-origin failure (common with local CLI bridges)
  | 'auth-401' // bad / missing key
  | 'not-found-404' // wrong base URL or model
  | 'rate-limit-429' // throttled
  | 'provider-error' // 5xx or other non-2xx
  | 'parse-error' // SSE / JSON parse failed
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

/** Issue one chat completion against an OpenAI-compatible endpoint
 *  with streaming on. Returns the assembled assistant content as a
 *  single string. Throws `AiClientError` on any failure path. */
export async function callChatCompletion(
  params: CallChatCompletionParams,
): Promise<string> {
  const { baseUrl, apiKey, model, messages, signal } = params;
  const url = joinUrl(baseUrl, '/chat/completions');
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
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
        'Endpoint or model not found (404). Check Base URL and Model name.',
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
      `Provider returned ${res.status}.`,
      opts,
    );
  }

  if (!res.body) {
    throw new AiClientError('parse-error', 'Response had no body to stream');
  }

  return await consumeSse(res.body, signal);
}

// ============ /v1/models · model autocomplete ============

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

async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let result = '';
  try {
    while (true) {
      if (signal?.aborted) {
        throw new AiClientError('aborted', 'Request aborted by caller');
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.remainder;
      for (const event of parsed.events) {
        if (event === '[DONE]') return result;
        const delta = extractContentDelta(event);
        if (delta !== null) result += delta;
      }
    }
    // Drain any remaining buffered event (some servers don't flush a
    // trailing \n\n before EOF).
    if (buffer.length > 0) {
      const tail = parseSseBuffer(buffer + '\n\n');
      for (const event of tail.events) {
        if (event === '[DONE]') return result;
        const delta = extractContentDelta(event);
        if (delta !== null) result += delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return result;
}

interface ParsedSse {
  events: string[];
  remainder: string;
}

/** Split an SSE buffer into complete events. SSE event boundary is a
 *  blank line (`\n\n`). Each event may have multiple `data:` lines
 *  (RFC says join with `\n`); we honor that. The buffer's trailing
 *  partial event is returned as `remainder`. */
export function parseSseBuffer(buffer: string): ParsedSse {
  // Normalize CRLF → LF so splits work regardless of server quirks.
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const remainder = blocks.pop() ?? '';
  const events: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const datas = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => (l.startsWith('data: ') ? l.slice(6) : l.slice(5)));
    if (datas.length === 0) continue;
    events.push(datas.join('\n'));
  }
  return { events, remainder };
}

function extractContentDelta(event: string): string | null {
  try {
    const obj = JSON.parse(event) as {
      choices?: Array<{
        delta?: { content?: unknown };
        message?: { content?: unknown };
      }>;
    };
    const choice = obj.choices?.[0];
    const delta = choice?.delta?.content ?? choice?.message?.content;
    return typeof delta === 'string' ? delta : null;
  } catch {
    return null;
  }
}

/** Best-effort JSON extraction from a model response. Strips markdown
 *  code fences if present, then falls back to first-`{` last-`}`
 *  bracketing. Throws `AiClientError('parse-error')` if no valid JSON
 *  is found. The result type is unknown — caller validates the schema. */
export function extractJsonFromResponse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AiClientError('parse-error', 'Empty response from model.');
  }

  // Try fenced ```json ... ``` or ``` ... ``` block first.
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]!.trim());
    } catch {
      // Fall through to bare-braces strategy.
    }
  }

  // Bare JSON with possible prose around it: find outermost { ... }.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // Fall through.
    }
  }

  // Last resort: parse as-is.
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new AiClientError(
      'parse-error',
      `Could not parse model response as JSON: ${(err as Error).message}`,
      { bodyExcerpt: trimmed.slice(0, 200) },
    );
  }
}

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
