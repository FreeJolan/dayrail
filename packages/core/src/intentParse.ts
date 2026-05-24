// Paste → AI parse (ERD §6.7.5 / §6.7.6).
//
// The paste path's internal AI turns a "DayRail-agnostic" blob of
// natural language / Markdown into structured `IntentSpec`s + a
// suggested shape per intent (the user can switch it in the review
// surface, §6.7.2). Per §6.7.6 this is STRUCTURED output against a small
// CLOSED Zod schema — NOT "extract JSON from prose" (the v0.8.2 drift
// trap). Mechanism: a forced AI-SDK tool call carrying the schema, not
// `generateObject` / `response_format` — the canonical bridge
// (CLIProxyAPI → Claude) doesn't translate OpenAI structured outputs but
// does translate function-calling to Claude tool use (see
// `defaultGenerate`). The model call is an injection seam so the mapping
// logic stays unit-testable without a network round-trip.

import { z } from 'zod';
import { AiClientError, mapToAiClientError } from './ai/client';
import type { IntentSpec, ProposalShape } from './intentStaging';

const MINUTES_IN_DAY = 24 * 60;

const intentTimeSchema = z.object({
  /** Minutes from local midnight (07:00 = 420). */
  startMinutes: z.number().int().min(0).max(MINUTES_IN_DAY - 1),
  durationMinutes: z.number().int().positive().optional(),
  label: z.string().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});

const intentSpecSchema = z.object({
  title: z.string().min(1),
  note: z.string().optional(),
  perOccurrenceDurationMinutes: z.number().int().positive().optional(),
  times: z.array(intentTimeSchema),
  frequency: z.enum(['once', 'daily', 'weekly']),
  dates: z.array(z.string()).optional(),
  // `color` is intentionally NOT in the parse schema — the model
  // shouldn't pick brand colors; the projector defaults it and the user
  // can recolor in the review surface.
});

const parsedProposalSchema = z.object({
  intent: intentSpecSchema,
  suggestedShape: z.enum(['habit', 'task']),
});

/** The closed schema `generateObject` enforces (§6.7.6). Exported so the
 *  contract can be unit-tested directly. */
export const parseResultSchema = z.object({
  proposals: z.array(parsedProposalSchema),
});

export type ParseResult = z.infer<typeof parseResultSchema>;

export interface ParseIntentsConfig {
  /** OpenAI-compatible API root, e.g. the user's Claude proxy. */
  baseUrl: string;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

export interface ParsedProposal {
  intent: IntentSpec;
  shape: ProposalShape;
}

/** Parse-pass system prompt — small + extraction-focused, distinct from
 *  the prose-review prompts in `ai/prompts.ts`. */
export const PARSE_SYSTEM_PROMPT = [
  "You convert a user's free-form notes into a structured list of intended",
  'activities for a personal planner. Extract one proposal per distinct',
  'activity or task the user wants to start or do.',
  '',
  'times[].startMinutes is minutes from local midnight (07:00 = 420). Only',
  'include a time when the user implies one; otherwise leave times empty.',
  '',
  'suggestedShape: "habit" for a recurring rhythm (daily / weekly, anchored',
  'to a time of day); "task" for a one-off or a bounded effort.',
  '',
  'Do not invent details the user did not imply. If unsure of a time, omit it.',
].join('\n');

/** Injection seam for tests; defaults to the real AI SDK call. */
export type IntentObjectGenerator = (
  config: ParseIntentsConfig,
  messages: { system: string; prompt: string },
) => Promise<ParseResult>;

const defaultGenerate: IntentObjectGenerator = async (config, { system, prompt }) => {
  const { baseUrl, apiKey, model, signal } = config;
  // Lazy import — keep the AI SDK off the cold-start path (mirrors
  // `callChatCompletion`).
  const [{ generateText, tool, APICallError }, { createOpenAICompatible }] = await Promise.all([
    import('ai'),
    import('@ai-sdk/openai-compatible'),
  ]);
  const provider = createOpenAICompatible({
    name: 'dayrail-custom',
    baseURL: baseUrl.replace(/\/+$/, ''),
    apiKey,
  });
  try {
    // Structured output via a FORCED tool call — NOT `generateObject` /
    // `response_format` json_schema. The canonical bridge (CLIProxyAPI →
    // Claude) doesn't translate OpenAI structured outputs (it warns
    // "responseFormat is not supported" and the model replies in prose →
    // JSON parse fails), but it DOES translate OpenAI function-calling to
    // Claude's native tool use. The proposals come back as the tool's
    // Zod-validated input. Still structured, still the closed schema
    // (§6.7.6) — just through the mechanism the bridge supports.
    const result = await generateText({
      model: provider(model),
      system,
      prompt,
      tools: {
        emit_proposals: tool({
          description: 'Emit the planner proposals extracted from the user text.',
          inputSchema: parseResultSchema,
        }),
      },
      toolChoice: 'required',
      ...(signal ? { abortSignal: signal } : {}),
    });
    const call = result.toolCalls.find((c) => c.toolName === 'emit_proposals');
    if (!call) {
      throw new AiClientError('parse-error', 'AI 没有按预期返回结构化结果。', {
        ...(result.text ? { bodyExcerpt: result.text.slice(0, 500) } : {}),
      });
    }
    return parseResultSchema.parse(call.input);
  } catch (err) {
    throw mapToAiClientError(err, APICallError);
  }
};

/** ERD §6.7.5. Parse a free-form blob into structured proposals (intent
 *  + a suggested shape) for the staging tray. Empty input → no proposals.
 *  Throws `AiClientError` on any provider failure (surfaced with a
 *  `bodyExcerpt` so the review UI can show what the endpoint returned). */
export async function parseIntentsFromText(
  text: string,
  config: ParseIntentsConfig,
  generate: IntentObjectGenerator = defaultGenerate,
): Promise<ParsedProposal[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const result = await generate(config, { system: PARSE_SYSTEM_PROMPT, prompt: trimmed });
  return result.proposals.map((p) => ({ intent: p.intent, shape: p.suggestedShape }));
}
