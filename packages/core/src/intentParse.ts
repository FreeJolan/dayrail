// Paste → AI parse (ERD §6.7.5 / §6.7.6).
//
// The paste path's internal AI turns a "DayRail-agnostic" blob of
// natural language / Markdown into PROPOSAL DRAFTS in the app's native
// shape — a task draft or a habit draft — which the review card edits
// with native fields. Structured output via a FORCED tool call carrying
// a small CLOSED Zod schema (the canonical bridge CLIProxyAPI → Claude
// doesn't translate OpenAI `response_format` json_schema, but does
// translate function-calling to Claude tool use — see `defaultGenerate`).
// The model call is an injection seam so the mapping stays unit-testable.

import { z } from 'zod';
import { AiClientError, mapToAiClientError } from './ai/client';
import { INBOX_LINE_ID } from './types';
import type { ProposalDraft } from './intentStaging';

const MINUTES_IN_DAY = 24 * 60;

// What the model fills — one entry per intended item. Closed schema; the
// AI proposes NEW rail times for habits (it can't know existing rail
// ids), and the user can switch a slot to an existing rail in the card.
const taskStepSchema = z.object({
  label: z.string().min(1),
  /** 0–100 milestone position this step reaches on the parent task. */
  percent: z.number().int().min(0).max(100).optional(),
});

const taskProposalSchema = z.object({
  kind: z.literal('task'),
  title: z.string().min(1),
  note: z.string().optional(),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  /** Discrete steps (切分) — each a TaskOccurrence { label, optional percent }. */
  steps: z.array(taskStepSchema).optional(),
});

const habitSlotProposalSchema = z.object({
  /** Minutes from local midnight (07:00 = 420). */
  startMinutes: z.number().int().min(0).max(MINUTES_IN_DAY - 1),
  durationMinutes: z.number().int().positive().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});

const habitProposalSchema = z.object({
  kind: z.literal('habit'),
  name: z.string().min(1),
  note: z.string().optional(),
  slots: z.array(habitSlotProposalSchema),
});

/** The closed schema `generateText`'s forced tool call enforces. */
export const parseResultSchema = z.object({
  proposals: z.array(z.discriminatedUnion('kind', [taskProposalSchema, habitProposalSchema])),
});

export type ParseResult = z.infer<typeof parseResultSchema>;

/** Map a model proposal → internal native draft, filling defaults the
 *  AI shouldn't have to (Inbox line, slot mode='new', empty steps). */
export function toProposalDraft(p: ParseResult['proposals'][number]): ProposalDraft {
  if (p.kind === 'task') {
    return {
      kind: 'task',
      title: p.title,
      ...(p.note ? { note: p.note } : {}),
      ...(p.priority ? { priority: p.priority } : {}),
      lineId: INBOX_LINE_ID,
      steps: p.steps ?? [],
    };
  }
  return {
    kind: 'habit',
    name: p.name,
    ...(p.note ? { note: p.note } : {}),
    slots: p.slots.map((s) => ({
      mode: 'new' as const,
      startMinutes: s.startMinutes,
      ...(s.durationMinutes !== undefined ? { durationMinutes: s.durationMinutes } : {}),
      ...(s.weekdays ? { weekdays: s.weekdays } : {}),
    })),
  };
}

export interface ParseIntentsConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

/** Parse-pass system prompt — extraction-focused, distinct from the
 *  prose-review prompts in `ai/prompts.ts`. */
export const PARSE_SYSTEM_PROMPT = [
  "You convert a user's free-form notes into a structured list of planner items by",
  'calling the tool emit_proposals. Each item is either:',
  '- kind:"task" — a one-off / bounded to-do. Fields: title, optional note, optional',
  '  priority (P0/P1/P2), optional steps[] where each step is { label, optional',
  "  percent (0-100 milestone) }. Set a step's percent ONLY when the user marks it as",
  '  a milestone / N% (e.g. "draft = 20%"). Do NOT add times to tasks.',
  '- kind:"habit" — a recurring activity. Fields: name, optional note, slots[] where each',
  '  slot has startMinutes (minutes from local midnight, 07:00=420), optional',
  '  durationMinutes, optional weekdays (0=Sun..6=Sat).',
  '',
  'Group the same recurring activity at multiple times of day into ONE habit with',
  'multiple slots. Only include a time/slot when the user implies one. Do not invent',
  'details the user did not imply.',
].join('\n');

/** Injection seam for tests; defaults to the real AI SDK call. */
export type IntentObjectGenerator = (
  config: ParseIntentsConfig,
  messages: { system: string; prompt: string },
) => Promise<ParseResult>;

const defaultGenerate: IntentObjectGenerator = async (config, { system, prompt }) => {
  const { baseUrl, apiKey, model, signal } = config;
  // Lazy import — keep the AI SDK off the cold-start path.
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
    // Forced tool call (not generateObject / response_format — the
    // bridge doesn't translate those). Proposals come back as the
    // tool's Zod-validated input.
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

/** ERD §6.7.5. Parse a free-form blob into native proposal drafts for
 *  the staging tray. Empty input → no proposals. Throws `AiClientError`
 *  on any provider failure (with a `bodyExcerpt` the UI can surface). */
export async function parseIntentsFromText(
  text: string,
  config: ParseIntentsConfig,
  generate: IntentObjectGenerator = defaultGenerate,
): Promise<ProposalDraft[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const result = await generate(config, { system: PARSE_SYSTEM_PROMPT, prompt: trimmed });
  return result.proposals.map(toProposalDraft);
}
