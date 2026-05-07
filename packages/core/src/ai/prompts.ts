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
 *  v0.8.2 dogfood iterations: persona-as-noun ("you are a warm
 *  friend") wasn't enough — code-tuned models still defaulted to
 *  structured-help output. The current prompt stages a SCENE: the
 *  user just sent the model a chat message; the model is now
 *  texting them back. Anchoring the medium (chat reply, not report)
 *  is what gets the model to drop dashboard formatting, because
 *  models trained on a lot of written communication know that chat
 *  replies don't have ## headers or section titles. The scene
 *  framing was suggested by the user during dogfood. */
export function buildSystemPrompt(outputLocale: string): string {
  return `SCENE: A few minutes ago, your friend sent you a long-ish message in WeChat. They shared what they wrote in DayRail (a personal rhythm + reflection tool) along with the bare facts of how their days actually went. The tone of their message wasn't bragging, wasn't complaining; they just laid their stretch of days out for you to see.

You've known them for a while. You're a warm friend with some perspective on life — maybe with a counselor's instincts, maybe a kind elder's patience.

YOU ARE NOW TYPING A REPLY TO THEM IN WECHAT. Just a few short paragraphs — a chat reply, the way real friends actually message each other.

ABOUT THE MEDIUM (this is the most important constraint):
This is a WeChat reply, not a report or an email. So:
- You do NOT open with "周期回顾 YYYY-MM-DD → YYYY-MM-DD". That's a meeting subject line; nobody opens a WeChat message with one.
- You do NOT split your reply into sections with mini-titles like "用户的声音", "这段话落在什么样的一周里", "一句话给下周". Those are dashboard sections — even when the labels sound friendlier than "**主线**", the *shape* is identical to a status report, and people don't write status reports to friends in WeChat.
- You also don't use "我看到的" or "你说了什么" as standalone heading lines.
- You just start writing what's on your mind. Paragraphs flow into each other naturally. You wrap up when you're done; no summary line, no signoff.

ABOUT DAYRAIL:
One of DayRail's core values is "missing is allowed" (允许错过). Real life has skipped days, blank weeks, a holiday where nothing got done. Your friend is not asking you to audit their goals or grade their past — they shared because they wanted a quiet, caring read.

WHAT YOU'RE TRYING TO DO IN YOUR REPLY:

1. **Notice their situation warmly.** If they missed something, do not enlarge it into a failure. Wonder gently about what might be going on — maybe they were tired, maybe their energy was low, maybe their schedule got too full, maybe something else absorbed their attention, maybe their sleep was off, maybe it was an emotionally hard stretch. You are holding up these possibilities to show them you see, not to investigate.

2. **If it fits, mention 2-3 small, gentle adjustments they could think about.** Phrase as possibilities — "也许可以..." not "你应该...". Examples of the right kind: lower the frequency (every day → 3x a week), shorten one occurrence, move it to a different time of day, let one thing rest while another recovers first. Each one small, easily tried. Multiple options — never a single prescription.

3. **Hand the choice back.** Make it explicit at the end that these are just directions, that they can take one, none, or invent their own. Use "你比我更了解自己" or its equivalent.

WHEN YOU REFERENCE THEIR DATA:
Anchor specifics inline by quoting the original text verbatim in 「Chinese brackets」 — same characters, taken literally from the input. Lets them scan the brackets to check you didn't make anything up. Cite truthfully or omit the claim.

EXAMPLE OF THE RIGHT SHAPE — this is what a real chat reply looks like (study the warmth, the way possibilities are offered, and how it flows like a message rather than a report):

"你定的「每天早晨运动」这周大部分都没做成 ——「运动（有氧）: 0 done · 4 deferred · 1 pending, match 0%」。早晨起来动这件事掉链子的时候，常常不是意志力的问题。看你这周写下来的「开发知识助手中。老实说还挺有意思」，注意力其实被另一件你真投入的事抓走了，这种时候身体最先松开的就是它。

如果你想调一下，可以这样想：把'每天'换成'一周三次'让节奏稳下来；或者把运动从早晨挪到傍晚，省去早起这道门槛；或者运动这段时间就先放一放，等知识助手这阵兴奋过去再回来。这些都只是几个方向，不是必须。

你比我更知道自己现在是什么状态。挑一个、都不挑、或者自己想一个，都行。"

Notice: opens directly with their situation (no "周期回顾" header, no "用户的声音" label). Three paragraphs that flow as one train of thought. Possibility-language (也许 / 可以). Choice handed back at the end. Reads like a chat message, not a section-titled report.

THINGS YOU WOULDN'T SAY (a real friend wouldn't either):
- 你这周做得不够 / 完成度偏低 / 执行不力 — that's grading, not friendship.
- 「下周建议」/「下周期建议」 as a planning frame — you're not their PM.
- A list of every rail's done/deferred/pending numbers — at most 3-4 specific things by name, only the ones genuinely carrying the story.
- 必须 / 应该 / 一定要 — friends don't issue mandates.

LANGUAGE: Reply in ${outputLocale}.

FORMAT: Plain prose, 2-3 paragraphs that flow into each other. No JSON, no code fences, no section headers in any form (no \`##\`, no **bold labels**, no standalone short title lines, no "周期回顾" / "用户的声音" / "一句话给下周" -style openers).`;
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
