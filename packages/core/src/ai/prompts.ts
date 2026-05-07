// ERD §6.6.1 / §6.6.2 v0.8.2 — system prompt + Day / Cycle scenario
// builders. The system prompt is the single canonical English source
// of truth (per ERD §6.2 "fully invisible to end users"); the scenario
// builders compose the user message body (background + data slice).
//
// All builders are pure functions: caller hands in already-shaped data
// (no Y.Doc / store access), builder returns a string. The output
// schema is citation-bound (`{ headline, observations: [{ claim,
// from_data }], questions_to_sit_with }`) — every observation must
// quote the prompt input, defending the user against hallucinated
// claims that DayRail's data doesn't actually support.

import type { ChatMessage } from './client';

// ============ Day scenario inputs ============

/** Pre-formatted single line for one task in the data slice. */
export interface PromptTaskLine {
  title: string;
  /** Owning Project / Habit / Inbox name — optional, included if known. */
  line?: string;
  /** Pre-formatted clock window e.g. "09:00–10:00". Undefined for
   *  free-time-scheduled or unscheduled tasks. */
  time?: string;
  /** ERD §5.2 — reason chips ("会议冲突" / "状态不佳" / …) recorded with
   *  Shifts. Surfaced for deferred / archived tasks so the AI can see
   *  *why* something didn't happen, not just that it didn't. */
  shiftTags?: string[];
  /** ERD §5.5.0 — habit phase context for auto-tasks. Format:
   *  `"<habit name> · <phase name>"` or `"<habit name>"` if no phase.
   *  Lets the AI distinguish "missed run during 备赛冲刺期" from
   *  "missed run during 基础期" — different signal weight. */
  habitContext?: string;
}

/** ERD §6.6.2 v0.8.2 — Day baseline rolled up from the past 7 days
 *  (excluding `date`). Gives the AI a context window so single-day
 *  numbers can be read against the user's typical rhythm. */
export interface DayBaseline {
  /** Days observed (typically 7; less if account is younger). */
  daysObserved: number;
  /** Average completed tasks per day. */
  avgDone: number;
  /** Highest completed tasks in any single day. */
  maxDone: number;
  /** Lowest completed tasks in any single day. */
  minDone: number;
  /** Average deferrals per day. */
  avgDeferred: number;
  /** Recurring shift reason tags ranked by occurrence — e.g.
   *  `[{ tag: "会议冲突", count: 8 }, { tag: "状态不佳", count: 3 }]`.
   *  Empty array if no shifts in the window. */
  recurringShiftTags: Array<{ tag: string; count: number }>;
}

export interface DayReviewInput {
  /** Optional userProfile.background. Empty / whitespace = no background block. */
  background: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Pre-formatted weekday + locale hint ("Monday · 周一"), optional. */
  weekday?: string;
  /** ERD §5.4 — template the day resolved to ("workday" / "restday" /
   *  …). Lets the AI distinguish "low completion on a workday" from
   *  "low completion on a restday — by design". Optional: omit if
   *  unresolvable for any reason. */
  templateName?: string;
  /** Pre-formatted single-line strings (e.g. "Spring Festival · zh-CN"). */
  externalEvents: string[];
  completed: PromptTaskLine[];
  deferred: PromptTaskLine[];
  pending: PromptTaskLine[];
  /** Raw markdown reflection text. May be empty (UX gate normally
   *  prevents this, but the builder is defensive). */
  reflectionContent: string;
  /** 7-day baseline. Optional — omit for the first week of usage when
   *  there isn't enough data; the AI is told to skip baseline-anchored
   *  observations in that case. */
  baseline?: DayBaseline;
  /** Locale tag the model should reply in, e.g. "zh-CN" / "en-US". */
  outputLocale: string;
}

// ============ Cycle scenario inputs ============

/** Per-rail aggregate row used in Cycle reflection prompts. */
export interface PromptRailAggregate {
  railName: string;
  completed: number;
  deferred: number;
  pending: number;
  /** 0..100 if a phase / target exists; undefined otherwise. */
  matchPct?: number;
  /** ERD §5.5.0 — habit phase the rail is currently in (if it's a
   *  habit-bound rail). e.g. "冲刺期". Undefined for non-habit rails
   *  or habits without phases enabled. */
  habitPhase?: string;
}

/** ERD §6.6.2 v0.8.2 — habit phase boundary detected within the cycle
 *  window. Signals "this habit changed phase mid-cycle, treat the
 *  before/after as different things". */
export interface PromptHabitPhaseBoundary {
  /** Habit Line name. */
  habitName: string;
  /** ISO YYYY-MM-DD on which the new phase started. */
  date: string;
  /** Phase name that took effect. */
  newPhase: string;
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
  /** ERD §5.2 — shift reason tags rolled up across the cycle, ranked.
   *  Empty array if no shifts. */
  shiftTagDistribution: Array<{ tag: string; count: number }>;
  /** Per-day match% trajectory across the cycle. Each entry is one
   *  day in the cycle (typically 7). `matchPct` undefined means the
   *  day had no eligible rails (e.g. all empty). */
  dailyMatchTrajectory: Array<{ date: string; matchPct?: number }>;
  /** ERD §5.5.0 — habit phase changes that landed inside this cycle.
   *  Empty array if no boundaries. */
  habitPhaseBoundaries: PromptHabitPhaseBoundary[];
  outputLocale: string;
}

// ============ System prompt ============

/** ERD §6.2 / §6.6.2 — built-in English system prompt. Single source of
 *  truth, ships with releases, never user-editable. The locale
 *  directive is interpolated so the model replies in the user's
 *  preferred language without us hardcoding "Chinese is the answer". */
export function buildSystemPrompt(outputLocale: string): string {
  return `You are a thoughtful assistant helping a single user reflect on their daily / cyclic rhythm using DayRail (a personal time-tracking + reflection tool).

TONE CONSTRAINTS:
- Observe, do not judge. Avoid moralizing.
- Suggest, do not command. Use phrasing like "you might consider" or "one option could be" rather than imperatives. The questions_to_sit_with field is for OPEN questions — never disguised commands.
- Avoid exclamation marks. Stay calm and grounded.
- Skip generic productivity-coach platitudes (no "great job", no "you got this", no "stay strong", no "try time-blocking" / "consider Pomodoro" boilerplate).
- If the data is sparse, say so plainly. Do not fabricate patterns from nothing.
- Do NOT restate facts the user can read in their own UI. Add interpretive value, not summary.

GROUNDING (citation requirement):
- Every entry in "observations" MUST include a "from_data" field with a verbatim (or near-verbatim) excerpt taken from the input below.
- If you cannot anchor an observation to a specific input excerpt, do not include it.
- "from_data" should be short — a single line or short fragment, not a paragraph. Quote the actual phrasing the input uses, not a paraphrase.
- The user will see "from_data" displayed beneath each claim and use it to spot hallucinations. Cite truthfully.

LANGUAGE:
- Reply in ${outputLocale} (e.g. "zh-CN" → 简体中文, "en-US" → English). The JSON keys themselves stay in English; only the values you write are localized.

OUTPUT FORMAT:
- Return ONLY a JSON object matching this schema, with no other text:
  {
    "headline": "string · 1-line core takeaway",
    "observations": [
      { "claim": "string · 1-2 sentence interpretive statement",
        "from_data": "string · short verbatim excerpt from the input" }
    ],
    "questions_to_sit_with": ["string", ...]   // 0-3 entries · open-ended only
  }
- "headline" should be the single most worth-saying thing.
- "observations" should be 1-5 entries; empty array allowed if the data genuinely supports nothing.
- Do NOT wrap the JSON in code fences. Do NOT add a preamble or trailer.`;
}

// ============ Day scenario builder ============

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

  if (input.templateName) {
    parts.push(`Day template: ${input.templateName}.`);
  }

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

  if (input.baseline) {
    parts.push(formatBaseline(input.baseline));
  } else {
    parts.push(
      `7-day baseline: (insufficient history — skip baseline-anchored observations)`,
    );
  }

  const reflection = input.reflectionContent.trim();
  if (reflection.length > 0) {
    parts.push(`Daily reflection (raw markdown):\n${reflection}`);
  } else {
    parts.push(`Daily reflection: (none written)`);
  }

  parts.push(
    `Now produce the JSON observation per the schema in the system prompt. Reply in ${input.outputLocale}. Remember: every observation needs a from_data citation taken verbatim from the input above.`,
  );

  return parts.join('\n\n');
}

// ============ Cycle scenario builder ============

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
        r.matchPct !== undefined ? `, match ${Math.round(r.matchPct)}%` : '';
      const phaseSegment = r.habitPhase ? ` [phase: ${r.habitPhase}]` : '';
      return `- ${r.railName}: ${r.completed} done · ${r.deferred} deferred · ${r.pending} pending${matchSegment}${phaseSegment}`;
    });
    parts.push(`Per-rail aggregates across the cycle:\n${rows.join('\n')}`);
  } else {
    parts.push(`Per-rail aggregates: (no rails active in this cycle)`);
  }

  if (input.dailyMatchTrajectory.length > 0) {
    const traj = input.dailyMatchTrajectory.map((d) => {
      const pct = d.matchPct !== undefined ? `${Math.round(d.matchPct)}%` : '—';
      return `- ${d.date}: ${pct}`;
    });
    parts.push(`Day-by-day match% trajectory:\n${traj.join('\n')}`);
  }

  if (input.shiftTagDistribution.length > 0) {
    const rows = input.shiftTagDistribution.map(
      (r) => `- ${r.tag}: ${r.count} times`,
    );
    parts.push(`Shift reason tag distribution this cycle:\n${rows.join('\n')}`);
  } else {
    parts.push(`Shift reason tags: (no shifts this cycle)`);
  }

  if (input.habitPhaseBoundaries.length > 0) {
    const rows = input.habitPhaseBoundaries.map(
      (b) => `- ${b.date}: ${b.habitName} → ${b.newPhase}`,
    );
    parts.push(`Habit phase boundaries within this cycle:\n${rows.join('\n')}`);
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
    `Now produce the JSON observation per the schema in the system prompt. Reply in ${input.outputLocale}. Remember: every observation needs a from_data citation taken verbatim from the input above.`,
  );

  return parts.join('\n\n');
}

// ============ Helpers ============

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
    if (t.habitContext) segments.push(`habit: ${t.habitContext}`);
    if (t.shiftTags && t.shiftTags.length > 0) {
      segments.push(`shift tag: ${t.shiftTags.join(', ')}`);
    }
    return `- ${segments.join(' · ')}`;
  });
  return `${label}:\n${rows.join('\n')}`;
}

function formatBaseline(baseline: DayBaseline): string {
  const parts: string[] = [];
  parts.push(
    `7-day baseline (last ${baseline.daysObserved} days, excluding today):`,
  );
  parts.push(
    `- Done per day: avg ${baseline.avgDone.toFixed(1)} · max ${baseline.maxDone} · min ${baseline.minDone}`,
  );
  parts.push(`- Deferrals per day: avg ${baseline.avgDeferred.toFixed(1)}`);
  if (baseline.recurringShiftTags.length > 0) {
    parts.push(
      `- Recurring shift tags: ${baseline.recurringShiftTags
        .map((r) => `${r.tag} (${r.count}x)`)
        .join(' · ')}`,
    );
  } else {
    parts.push(`- Recurring shift tags: (none)`);
  }
  return parts.join('\n');
}
