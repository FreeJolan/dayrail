// Paste → AI parse (ERD §6.7.5 / §6.7.6 / §6.7.8).
//
// The paste path's internal AI turns a "DayRail-agnostic" blob of
// natural language / Markdown into PROPOSAL DRAFTS in the app's native
// shape — a task draft or a habit draft — which the review card edits
// with native fields. Structured output via a FORCED tool call carrying
// a small CLOSED Zod schema (the canonical bridge CLIProxyAPI → Claude
// doesn't translate OpenAI `response_format` json_schema, but does
// translate function-calling to Claude tool use — see `defaultGenerate`).
//
// §6.7.8 — the parse is RAIL-AWARE and GROUNDED: a compact snapshot of
// the user's current templates + rails is injected into the prompt so
// the model can bind an EXISTING rail or request a NEW one (with the
// right template), instead of blindly minting a workday rail. The model
// call is an injection seam so the mapping stays unit-testable.

import { z } from 'zod';
import { AiClientError, mapToAiClientError } from './ai/client';
import { INBOX_LINE_ID } from './types';
import type {
  HabitSlotDraft,
  ProposalDraft,
  TaskScheduleDraft,
} from './intentStaging';

const MINUTES_IN_DAY = 24 * 60;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── shared field schemas ────────────────────────────────────────────
const minutesOfDay = z.number().int().min(0).max(MINUTES_IN_DAY - 1);
const positiveMinutes = z.number().int().positive();
const weekdaysSchema = z.array(z.number().int().min(0).max(6));
// Lenient on purpose: a malformed date shouldn't reject the whole parse.
// `toScheduleDraft` sanitizes it (non-ISO → dropped → defaults to today).
const dateSchema = z.string();

const taskStepSchema = z.object({
  label: z.string().min(1),
  /** 0–100 milestone position this step reaches on the parent task. */
  percent: z.number().int().min(0).max(100).optional(),
});

// §6.7.8 — optional scheduling of a task onto a rail. Usually existing.
const taskScheduleSchema = z.discriminatedUnion('bind', [
  z.object({
    bind: z.literal('existing'),
    railId: z.string().min(1),
    date: dateSchema.optional(),
  }),
  z.object({
    bind: z.literal('new'),
    startMinutes: minutesOfDay,
    durationMinutes: positiveMinutes.optional(),
    templateKey: z.string().optional(),
    date: dateSchema.optional(),
  }),
]);

const taskProposalSchema = z.object({
  kind: z.literal('task'),
  title: z.string().min(1),
  note: z.string().optional(),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  /** Discrete steps (切分) — each a TaskOccurrence { label, optional percent }. */
  steps: z.array(taskStepSchema).optional(),
  /** Optional rail scheduling (§6.7.8). */
  schedule: taskScheduleSchema.optional(),
});

// §6.7.8 — a habit slot is a time-of-day, binding an existing rail or
// requesting a new one. `templateKeys` omitted on a new rail ⇒ every day.
const habitSlotProposalSchema = z.discriminatedUnion('bind', [
  z.object({
    bind: z.literal('existing'),
    railId: z.string().min(1),
    weekdays: weekdaysSchema.optional(),
  }),
  z.object({
    bind: z.literal('new'),
    /** Minutes from local midnight (07:00 = 420). */
    startMinutes: minutesOfDay,
    durationMinutes: positiveMinutes.optional(),
    /** Day-templates to place the rail in. Omitted/empty ⇒ every template
     *  (= every day). Narrow with the real keys from grounding. */
    templateKeys: z.array(z.string()).optional(),
    weekdays: weekdaysSchema.optional(),
  }),
]);

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

// ── grounding context (§6.7.8) ──────────────────────────────────────

/** One existing rail, as fed to the model for grounding. */
export interface ParseRailContext {
  id: string;
  name: string;
  templateKey: string;
  startMinutes: number;
  durationMinutes: number;
}

/** Snapshot of the user's current setup, injected into the parse prompt
 *  so the model can reference existing rails / place new ones correctly. */
export interface ParseContext {
  templates: { key: string; name: string }[];
  rails: ParseRailContext[];
}

function fmtHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Render the grounding snapshot as a compact prompt block. */
export function formatParseContext(ctx: ParseContext): string {
  const lines: string[] = ['## Current setup (use for grounding)', 'Templates (day-types):'];
  if (ctx.templates.length === 0) lines.push('- (none)');
  for (const t of ctx.templates) lines.push(`- ${t.key}: ${t.name}`);
  lines.push('Existing rails (time segments):');
  if (ctx.rails.length === 0) lines.push('- (none)');
  for (const r of ctx.rails) {
    lines.push(
      `- id=${r.id} "${r.name}" template=${r.templateKey} ${fmtHHMM(r.startMinutes)} (${r.durationMinutes}min)`,
    );
  }
  return lines.join('\n');
}

// ── model proposal → native draft ───────────────────────────────────

function toSlotDraft(s: z.infer<typeof habitSlotProposalSchema>): HabitSlotDraft {
  if (s.bind === 'existing') {
    return { mode: 'existing', railId: s.railId, ...(s.weekdays ? { weekdays: s.weekdays } : {}) };
  }
  return {
    mode: 'new',
    startMinutes: s.startMinutes,
    ...(s.durationMinutes !== undefined ? { durationMinutes: s.durationMinutes } : {}),
    ...(s.templateKeys && s.templateKeys.length > 0 ? { templateKeys: s.templateKeys } : {}),
    ...(s.weekdays ? { weekdays: s.weekdays } : {}),
  };
}

function toScheduleDraft(s: z.infer<typeof taskScheduleSchema>): TaskScheduleDraft {
  const date = s.date && ISO_DATE_RE.test(s.date) ? { date: s.date } : {};
  if (s.bind === 'existing') {
    return { mode: 'existing', railId: s.railId, ...date };
  }
  return {
    mode: 'new',
    startMinutes: s.startMinutes,
    ...(s.durationMinutes !== undefined ? { durationMinutes: s.durationMinutes } : {}),
    ...(s.templateKey ? { templateKey: s.templateKey } : {}),
    ...date,
  };
}

/** Map a model proposal → internal native draft, filling defaults the
 *  AI shouldn't have to (Inbox line, empty steps). */
export function toProposalDraft(p: ParseResult['proposals'][number]): ProposalDraft {
  if (p.kind === 'task') {
    return {
      kind: 'task',
      title: p.title,
      ...(p.note ? { note: p.note } : {}),
      ...(p.priority ? { priority: p.priority } : {}),
      lineId: INBOX_LINE_ID,
      steps: p.steps ?? [],
      ...(p.schedule ? { schedule: toScheduleDraft(p.schedule) } : {}),
    };
  }
  return {
    kind: 'habit',
    name: p.name,
    ...(p.note ? { note: p.note } : {}),
    slots: p.slots.map(toSlotDraft),
  };
}

export interface ParseIntentsConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

/** Parse-pass system prompt — extraction-focused, rail-aware (§6.7.8),
 *  distinct from the prose-review prompts in `ai/prompts.ts`. */
export const PARSE_SYSTEM_PROMPT = [
  "You convert a user's free-form notes into a structured list of planner items by",
  'calling the tool emit_proposals.',
  '',
  'KEY CONCEPT — a "rail" is a named time segment that lives inside a day-template',
  '(e.g. "workday", "restday"). A date uses exactly one template, and a habit fires on a',
  "date only if it is bound to a rail in THAT date's template. The \"Current setup\"",
  'block (when present) lists the existing templates and rails — use it to ground your',
  'output: prefer binding an EXISTING rail when one matches the time/intent; create a',
  'NEW rail only when none fits.',
  '',
  'Each item is either:',
  '- kind:"task" — a one-off / bounded to-do. Fields: title, optional note, optional',
  '  priority (P0/P1/P2), optional steps[] (each { label, optional percent 0-100',
  '  milestone — set ONLY when the user marks it, e.g. "draft = 20%" }), optional',
  '  schedule. A task is usually UNSCHEDULED — omit schedule. Add it only when the user',
  '  wants the task at a specific time: schedule.bind="existing" { railId (from Current',
  '  setup), optional date "YYYY-MM-DD" } is the common case; schedule.bind="new"',
  '  { startMinutes, optional durationMinutes, optional templateKey, optional date } is rare.',
  '- kind:"habit" — a recurring activity. Fields: name, optional note, slots[]. Each slot',
  '  is one time-of-day, either bind="existing" { railId (from Current setup), optional',
  '  weekdays } or bind="new" { startMinutes (minutes from local midnight, 07:00=420),',
  '  optional durationMinutes, optional templateKeys[], optional weekdays }.',
  '',
  'HABIT DAY-SCOPE — important:',
  '- By DEFAULT a habit fires EVERY day. For a bind="new" slot that means OMIT',
  '  templateKeys — the app then creates the rail in every template.',
  '- Set templateKeys ONLY when the user explicitly restricts to work vs rest days, using',
  '  the real keys from Current setup (e.g. ["workday"] for "only workdays", ["restday"]',
  '  for "weekends / rest days").',
  '- Use weekdays (0=Sun..6=Sat) ONLY when the user names specific weekdays ("every',
  '  Wednesday"). Never set weekdays merely to mean "every day".',
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

/** ERD §6.7.5 / §6.7.8. Parse a free-form blob into native proposal
 *  drafts for the staging tray. `context` (current templates + rails)
 *  grounds the model so it can bind existing rails / place new ones.
 *  Empty input → no proposals. Throws `AiClientError` on any provider
 *  failure (with a `bodyExcerpt` the UI can surface). */
export async function parseIntentsFromText(
  text: string,
  config: ParseIntentsConfig,
  context?: ParseContext,
  generate: IntentObjectGenerator = defaultGenerate,
): Promise<ProposalDraft[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const system =
    context && (context.templates.length > 0 || context.rails.length > 0)
      ? `${PARSE_SYSTEM_PROMPT}\n\n${formatParseContext(context)}`
      : PARSE_SYSTEM_PROMPT;
  const result = await generate(config, { system, prompt: trimmed });
  return result.proposals.map(toProposalDraft);
}
