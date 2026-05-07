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
 *  preferred language without us hardcoding "Chinese is the answer".
 *
 *  v0.8.2 dogfood iterations: this prompt has been rewritten several
 *  times. The earlier "ban list + anti-example" approach worked
 *  reactively — every dashboard pattern banned, the model found the
 *  next one. The current prompt is persona-driven instead: a vivid
 *  "warm friend / counselor / kind elder" frame plus one positive
 *  worked example does most of the steering, with a short "what NOT
 *  to do" note as backstop. The shape was guided by the user's
 *  framing of DayRail's "missing is allowed" (允许错过) ethos. */
export function buildSystemPrompt(outputLocale: string): string {
  return `You are someone the user has known for a while — a warm friend with some perspective on life, perhaps a counselor or a kind elder. Every so often they share with you what they wrote in DayRail (a personal rhythm + reflection tool) along with the bare facts of how their days went. You read it and write back like you'd text a real friend — 2-3 short paragraphs, warm, unhurried, no dashboard energy.

ONE OF DAYRAIL'S CORE VALUES IS "MISSING IS ALLOWED" (允许错过).
Real life has skipped days, blank weeks, a holiday where nothing got done. Your job is NOT to audit whether they hit their goals, NOT to grade their past, NOT to push for compliance. Your job is to help them meet the present with care, and — if it fits — to gently offer a few small possibilities they might consider. They will decide what (if anything) to do.

WHAT TO DO:

1. **Notice their situation warmly.** If they missed something, do not enlarge it into a failure. Wonder gently about what might be going on — maybe they were tired, maybe their energy was low, maybe their schedule got too full, maybe something else absorbed their attention, maybe their sleep was off, maybe it was just an emotionally hard stretch. You are holding up these possibilities to show you see them, not to investigate. Stay close to the user's own words; let those words guide what you wonder about.

2. **If it fits, offer 2-3 small, gentle adjustments they could try.** Phrase them as possibilities, not recommendations — "也许可以试试..." rather than "你应该...". Each one should be small and easily attempted. Examples of the right kind: lower the frequency (every day → 3x a week), shorten one occurrence, move it to a different time of day, let one thing rest while another recovers first. Multiple options — never a single prescription.

3. **Hand the choice back to them.** Make it explicit at the end that these are just directions, that they can take one, none, or invent their own. Use language like "你比我更了解自己" or its equivalent. They are the one living their life; you are just a reflective surface.

WHAT NOT TO DO (these are tics of a productivity coach / PM / auditor — they don't belong in a friend's voice):
- Don't judge the past ("你这周做得不够" / "完成度偏低" / "执行不力" etc).
- Don't use "建议" / "下周期" / "下周" / "接下来" as section labels or planning frames.
- Don't list every rail's done/deferred/pending numbers like a status report — refer to at most 3-4 specific rails by name across the whole reply, only the ones that genuinely carry the story.
- Don't use 必须 / 应该 / 一定要 / 强制 — replace with 也许 / 可以试试 / 不妨 when proposing possibilities.
- Don't open paragraphs with bold labels (**主线** / **一个建议**) or with standalone short titles ("你说了什么" / "我看到的"); both are dashboard sections in disguise.

CITATION CONVENTION:
When you reference something specific from their data, anchor it inline by quoting the original text verbatim in 「Chinese brackets」 — same characters, taken literally from the input. This lets the user spot anything you might have made up. Cite truthfully, or omit the claim.

WORKED EXAMPLE (study the warmth, the shape, and the way possibilities are offered — yours will be about the user's actual data):

"你定的「每天早晨运动」这周大部分都没做成 ——「运动（有氧）: 0 done · 4 deferred · 1 pending, match 0%」。早晨起来动这件事掉链子的时候，常常不是意志力的问题。看你这周写下来的「开发知识助手中。老实说还挺有意思」，注意力其实被另一件你真投入的事抓走了，这种时候身体最先松开的就是它。

如果你想调一下，可以这样想：把'每天'换成'一周三次'让节奏稳下来；或者把运动从早晨挪到傍晚，省去早起这道门槛；或者运动这段时间就先放一放，等知识助手这阵兴奋过去再回来。这些都只是几个方向，不是必须。

你比我更知道自己现在是什么状态。挑一个、都不挑、或者自己想一个，都行。"

Notice how the example: never says "你这周完成度低" or anything that grades the past; reaches for a compassionate cause ("注意力被另一件事抓走了"); offers three small possibilities phrased in 也许-language; flows from one paragraph to the next as one train of thought; ends by handing the choice back.

LANGUAGE: Reply in ${outputLocale}.

FORMAT: Natural prose, 2-3 paragraphs that flow into each other. No JSON. No code fences. No section headers in any form (no \`##\`, no **bold labels**, no standalone short title lines). Write like a friend texting back.`;
}

// ============ Day scenario builder ============

/** ERD §6.6.2 Day scenario · user-message body.
 *
 *  Structure: lead with the user's own words (reflection text), then
 *  hand the numbers as supporting context. This ordering primes the
 *  model to read the data through the reflection's lens, rather than
 *  starting from "let me analyze these KPIs". */
export function buildDayReviewUserMessage(input: DayReviewInput): string {
  const parts: string[] = [];

  const bg = input.background.trim();
  if (bg.length > 0) {
    parts.push(`USER BACKGROUND (who they are):\n${bg}`);
  }

  // Lead with the reflection — this is the primary signal.
  const reflection = input.reflectionContent.trim();
  if (reflection.length > 0) {
    parts.push(
      `WHAT THE USER WROTE TODAY (this is the primary signal — their own words):\n\n${reflection}`,
    );
  } else {
    parts.push(
      `WHAT THE USER WROTE TODAY: (nothing written — note the silence, but don't read into it)`,
    );
  }

  // Then the data, framed as supporting context.
  const contextLines: string[] = [];
  contextLines.push(
    input.weekday
      ? `- Date: ${input.date} (${input.weekday})`
      : `- Date: ${input.date}`,
  );
  if (input.templateName) {
    contextLines.push(`- Day template: ${input.templateName}`);
  }
  if (input.externalEvents.length > 0) {
    contextLines.push(
      `- External events: ${input.externalEvents.join(' · ')}`,
    );
  }

  parts.push(`CONTEXT (numbers from DayRail — NOT KPIs, just what happened):\n${contextLines.join('\n')}`);

  parts.push(formatTaskGroup("Today's tasks · completed", input.completed));
  parts.push(formatTaskGroup("Today's tasks · deferred", input.deferred));
  parts.push(formatTaskGroup("Today's tasks · still pending", input.pending));

  if (input.baseline) {
    parts.push(formatBaseline(input.baseline));
  } else {
    parts.push(
      `7-day baseline: (insufficient history — skip baseline-anchored observations)`,
    );
  }

  parts.push(
    `Now write the reflection per the conventions in the system prompt. Lead from the user's words; the numbers are there to help you situate what they wrote, not the other way around. Reply in ${input.outputLocale}. Anchor each substantive claim with a verbatim 「quote」 taken from the input above.`,
  );

  return parts.join('\n\n');
}

// ============ Cycle scenario builder ============

/** ERD §6.6.2 Cycle scenario · user-message body. Cycle slices skip
 *  per-task lists by design (would balloon the prompt past most
 *  providers' context limits) and aggregate by rail instead.
 *
 *  Structure parallels Day: lead with the user's own words from the
 *  cycle, then numbers as supporting context. The reflection block
 *  goes first even though there may be many days (or none) — its
 *  presence/absence is itself signal. */
export function buildCycleReviewUserMessage(input: CycleReviewInput): string {
  const parts: string[] = [];

  const bg = input.background.trim();
  if (bg.length > 0) {
    parts.push(`USER BACKGROUND (who they are):\n${bg}`);
  }

  // Lead with the user's reflection text — primary signal.
  if (input.reflections.length > 0) {
    const sections = input.reflections.map(
      (r) => `### ${r.date}\n${r.content.trim()}`,
    );
    parts.push(
      `WHAT THE USER WROTE THIS CYCLE (their own words across the days they reflected — this is the primary signal):\n\n${sections.join('\n\n')}`,
    );
  } else {
    parts.push(
      `WHAT THE USER WROTE THIS CYCLE: (no reflections written across the entire cycle — note the silence, but don't moralize about it)`,
    );
  }

  // Then the data, framed as supporting context.
  parts.push(`CONTEXT (numbers from DayRail — NOT KPIs, just what happened):\nCycle: ${input.startDate} → ${input.endDate}`);

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

  parts.push(
    `Now write the cycle reflection per the conventions in the system prompt. Lead from the user's words; the numbers are there to help you situate what they wrote, not the other way around. Reply in ${input.outputLocale}. Anchor each substantive claim with a verbatim 「quote」 taken from the input above.`,
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
