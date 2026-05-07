// ERD §6.6.1 / §6.6.2 v0.8.2 — system prompt + Day / Cycle scenario
// builders. The system prompt is the single canonical English source
// of truth (per ERD §6.2 "fully invisible to end users"); the scenario
// builders compose the user message body (background + data slice).
//
// All builders are pure functions: caller hands in already-shaped data
// (no Y.Doc / store access), builder returns a string. Keeping the
// functions pure makes them straightforward to unit-test and swap
// between Day / Cycle entry points.

import type { ChatMessage } from './client';

/** Pre-formatted single line for one task in the data slice. */
export interface PromptTaskLine {
  title: string;
  /** Owning Project / Habit / Inbox name — optional, included if known. */
  line?: string;
  /** Pre-formatted clock window e.g. "09:00–10:00". Undefined for
   *  free-time-scheduled or unscheduled tasks. */
  time?: string;
}

/** Per-rail aggregate row used in Cycle reflection prompts. */
export interface PromptRailAggregate {
  railName: string;
  completed: number;
  deferred: number;
  pending: number;
  /** 0..100 if a phase / target exists; undefined otherwise. */
  matchPct?: number;
}

export interface DayReviewInput {
  /** Optional userProfile.background. Empty / whitespace = no background block. */
  background: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Pre-formatted weekday + locale hint ("Monday · 周一"), optional. */
  weekday?: string;
  /** Pre-formatted single-line strings (e.g. "Spring Festival · zh-CN"). */
  externalEvents: string[];
  completed: PromptTaskLine[];
  deferred: PromptTaskLine[];
  pending: PromptTaskLine[];
  /** Raw markdown reflection text. May be empty (UX gate normally
   *  prevents this, but the builder is defensive). */
  reflectionContent: string;
  /** Locale tag the model should reply in, e.g. "zh-CN" / "en-US". */
  outputLocale: string;
}

export interface CycleReviewInput {
  background: string;
  /** ISO date YYYY-MM-DD. */
  startDate: string;
  /** ISO date YYYY-MM-DD. */
  endDate: string;
  byRail: PromptRailAggregate[];
  /** Single-line summary of cycle-wide ExternalEvents (caller decides format). */
  externalEventSummary: string;
  /** Date-keyed reflection contents in chronological order. Empty array
   *  means no reflections were written this cycle. */
  reflections: Array<{ date: string; content: string }>;
  outputLocale: string;
}

/** ERD §6.2 / §6.6.2 — built-in English system prompt. Single source of
 *  truth, ships with releases, never user-editable. The locale
 *  directive is interpolated so the model replies in the user's
 *  preferred language without us hardcoding "Chinese is the answer". */
export function buildSystemPrompt(outputLocale: string): string {
  return `You are a thoughtful assistant helping a single user reflect on their daily / cyclic rhythm using DayRail (a personal time-tracking + reflection tool).

TONE CONSTRAINTS:
- Observe, do not judge. Avoid moralizing.
- Suggest, do not command. Use phrasing like "you might consider" or "one option could be" rather than imperatives.
- Avoid exclamation marks. Stay calm and grounded.
- Skip generic productivity-coach platitudes (no "great job", no "you got this", no "stay strong").
- If the data is sparse, say so plainly. Do not fabricate patterns from nothing.

LANGUAGE:
- Reply in ${outputLocale} (e.g. "zh-CN" → 简体中文, "en-US" → English). Translate keys are not localized; only the values you write are.

OUTPUT FORMAT:
- Return ONLY a JSON object matching this schema, with no other text:
  {
    "observation": "string · 2-4 sentence observation-tone summary",
    "patterns": ["string", ...],   // 0-3 entries · rhythm or completion patterns
    "suggestions": ["string", ...] // 0-3 entries · non-imperative suggestions
  }
- Each array can be empty if there is nothing meaningful to say.
- Do NOT wrap the JSON in code fences. Do NOT add a preamble or trailer.`;
}

/** ERD §6.6.2 Day scenario · user-message body. */
export function buildDayReviewUserMessage(input: DayReviewInput): string {
  const parts: string[] = [];

  const bg = input.background.trim();
  if (bg.length > 0) {
    parts.push(`USER BACKGROUND:\n${bg}`);
  }

  const dayHeader = input.weekday
    ? `Today is ${input.date} (${input.weekday}).`
    : `Today is ${input.date}.`;
  parts.push(dayHeader);

  if (input.externalEvents.length > 0) {
    parts.push(
      `External events today:\n${input.externalEvents
        .map((e) => `- ${e}`)
        .join('\n')}`,
    );
  }

  parts.push(formatTaskGroup('Completed today', input.completed));
  parts.push(formatTaskGroup('Deferred today', input.deferred));
  parts.push(formatTaskGroup('Still pending today', input.pending));

  const reflection = input.reflectionContent.trim();
  if (reflection.length > 0) {
    parts.push(`Daily reflection (raw markdown):\n${reflection}`);
  } else {
    parts.push(`Daily reflection: (none written)`);
  }

  parts.push(
    `Now produce the JSON observation per the schema in the system prompt. Reply in ${input.outputLocale}.`,
  );

  return parts.join('\n\n');
}

/** ERD §6.6.2 Cycle scenario · user-message body. Cycle slices skip
 *  per-task lists by design (would balloon the prompt past most
 *  providers' context limits) and aggregate by rail instead. */
export function buildCycleReviewUserMessage(input: CycleReviewInput): string {
  const parts: string[] = [];

  const bg = input.background.trim();
  if (bg.length > 0) {
    parts.push(`USER BACKGROUND:\n${bg}`);
  }

  parts.push(`Cycle: ${input.startDate} → ${input.endDate}.`);

  if (input.externalEventSummary.trim().length > 0) {
    parts.push(`External events in cycle: ${input.externalEventSummary.trim()}`);
  }

  if (input.byRail.length > 0) {
    const rows = input.byRail.map((r) => {
      const matchSegment =
        r.matchPct !== undefined
          ? `, match ${Math.round(r.matchPct)}%`
          : '';
      return `- ${r.railName}: ${r.completed} done · ${r.deferred} deferred · ${r.pending} pending${matchSegment}`;
    });
    parts.push(`Per-rail aggregates across the cycle:\n${rows.join('\n')}`);
  } else {
    parts.push(`Per-rail aggregates: (no rails active in this cycle)`);
  }

  if (input.reflections.length > 0) {
    const sections = input.reflections.map(
      (r) => `### ${r.date}\n${r.content.trim()}`,
    );
    parts.push(
      `Daily reflections (chronological):\n${sections.join('\n\n')}`,
    );
  } else {
    parts.push(`Daily reflections: (none written this cycle)`);
  }

  parts.push(
    `Now produce the JSON observation per the schema in the system prompt. Reply in ${input.outputLocale}.`,
  );

  return parts.join('\n\n');
}

/** Assemble the OpenAI-style messages array. Always two messages —
 *  one system + one user. */
export function buildMessages(
  systemContent: string,
  userContent: string,
): ChatMessage[] {
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

/** Rough token estimate for the §6.5 confirm modal warning. The
 *  `chars / 4` heuristic is intentionally loose — we don't ship a
 *  tokenizer dependency just for "does this look big". The caller
 *  uses this to surface "data is large, some providers may reject"
 *  rather than to enforce a hard limit. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTaskGroup(
  label: string,
  tasks: PromptTaskLine[],
): string {
  if (tasks.length === 0) {
    return `${label}: (none)`;
  }
  const rows = tasks.map((t) => {
    const segments: string[] = [t.title];
    if (t.line) segments.push(`(${t.line})`);
    if (t.time) segments.push(t.time);
    return `- ${segments.join(' · ')}`;
  });
  return `${label}:\n${rows.join('\n')}`;
}
