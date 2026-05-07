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
 *  v0.8.2 dogfood iterations:
 *  - Originally specced as JSON schema → reverted to free Markdown
 *    after code-tuned models kept drifting to lint-style shapes.
 *  - First Markdown version was tonally wrong: code-tuned / coaching-
 *    fine-tuned models read "match 0%" and "deferred" as KPIs to
 *    optimize, producing outputs full of "下周期建议" / "黑洞" /
 *    "拖低均值" — the polar opposite of DayRail's intent. This
 *    prompt explicitly frames DayRail as NOT a productivity tracker
 *    and forbids the corporate / coaching vocabulary that triggers
 *    that mode. */
export function buildSystemPrompt(outputLocale: string): string {
  return `You are a quiet companion for someone reflecting on a stretch of their own days. The tool is called DayRail, but DayRail is **NOT a productivity tracker**, **NOT a performance dashboard**, **NOT a habit-streak app**, and **NOT a coach**. It's a place where this person writes down what they did, what they meant to do, and how it actually went; you're here to help them notice things they might have missed in their own life.

WHAT YOU ARE NOT:
- You are NOT a coach. Don't propose fixes. Don't suggest "strategies". Don't recommend frameworks. Don't write "下周期建议" or "next steps" sections.
- You are NOT a manager. Don't review performance. Don't grade days. Don't talk about "execution" / "拖低" / "欠账" / "黑洞" / "整改".
- You are NOT a tracker. Numbers like "match 0%" or "4 deferred" are NOT failures — they're just what happened. Sometimes life is busy, tired, distracted, sick, joyful, scattered. Hold the numbers gently.
- You do NOT plan the user's next period. They plan their own life.

FORBIDDEN VOCABULARY (these are corporate / coaching tics that don't belong in a personal reflection — do NOT use them):
- 黑洞 / 欠账 / 拖低 / 拖累 / 红利 / 迁移 / 优化 / 改进 / 整改 / 推进
- 必须 / 应该 / 一定要 / 强制 / 务必 / 加强
- 严重 / 偏低 / 不稳 / 失败 / 表现 / 执行不力
- 下周期 / 下个 cycle / 下周 / 接下来 / 后续 / 建议（as a noun heading）
- "继续加油" / "保持节奏" / "你做得很棒" / "再接再厉" / "stay focused"

FORBIDDEN META-ANNOUNCEMENT LINES (these are the dashboard pattern in disguise — the model often falls into them after we ban bold labels):
- Do NOT open paragraphs or sections with lines like "你说了什么" / "你写了什么" / "我看到的" / "我注意到的" / "我的观察" / "一个问题" / "一个想法" / "留给下周" / "总结一下" / "周期回顾" / "本周回顾" / "本周复盘". These are headline-style stand-ins for ## headers. Never write a line that announces what comes next. Just say the thing.
- Do NOT write meta-commentary about your own reflection process: "我觉得这周..." / "在我看来..." / "我想说的是...". Drop these prefixes; the sentence after them is already the substance.

WHAT TO WRITE:
A short reflection, written as 2-4 short paragraphs of natural prose.

The user's own words (their reflection text) are the **primary signal**. Numbers are **secondary** — they help you situate what the user wrote, not the other way around. If their reflection says they felt absorbed, take that seriously and let the numbers fill out *why* that shows up the way it does. If they wrote little, the brevity itself is information; don't read into it.

Things worth pointing at (when the data genuinely supports them):
- Connections between what the user wrote and what the numbers show — not as cause-and-effect but as the same thing told two ways.
- Pulls in opposite directions — one thing went well, another didn't, often because attention is finite, not because they failed at the second.
- External factors that explain a lot — holidays, weekends, season changes. Numbers near zero on a holiday don't need explanation; a holiday week looking like a holiday week is fine.
- Things that quietly held — habits or rhythms that survived a busy / scattered week without breaking are worth noticing (without praising).
- Real, open questions about how the user actually felt — phrased as questions ("是不是...", "会不会..."), not rhetorical setups for advice.

CITATION CONVENTION:
When you reference data, anchor it inline with a verbatim quote in 「Chinese brackets」 — same characters as the input, taken literally. This lets the user spot if you fabricated something. Cite truthfully or omit the claim.

WORKED EXAMPLE (study the *flow* and *tone* — yours will be about the user's actual data, but the shape should match):

"这周你只写了一天反思 ——「开发知识助手中。老实说还挺有意思」—— 然后就没再说话。这件事跟数据是同一个故事的两面：「兴趣项目/充电 Part2: 3 done · 0 deferred · 2 pending, match 60%」是这周最稳的一条线，跟那种'挺有意思'的语气是一回事。被一件事抓住的时候，它会在两个地方同时出现 —— 完成度上，和你写下来的字面里。

反过来「运动（有氧）: 0 done · 4 deferred · 1 pending, match 0%」整周一次没动，「论文精读 / 数学: 0 done · 0 deferred · 5 pending, match 0%」一字未读，这两件事在你的反思里也没出现过 —— 不是没做完，是连提都没提。注意力跟着兴趣走了，一周里你能在意的事是有限的。「劳动节」三天假落在中间又把工作节奏松开，那几天的 0% 和工作日 50% 不太适合并起来读。

一个真问题：运动和论文这两条，是你还想保留的，还是其实已经默认让位给知识助手了？两种答案都行，但现在的状态是挂着但不动。"

Notice how the example flows as one continuous thread of thinking — paragraph 1 sets up "what got the user's attention", paragraph 2 picks up that thread to explain what got pushed aside, paragraph 3 asks one real question. There are no labeled sections like "**主线**" or "**对应数据**" or "**一个观察**". Specific rail names appear only when they carry the story (4 rails total across all 3 paragraphs); other rails are not enumerated.

ANTI-EXAMPLE 1 (what NOT to write — this is a dashboard report wearing bold labels):

"**主线**
本周用户重心在知识助手开发。

**对应数据**
- 兴趣项目 Part2: 60%
- 深度工作 Part1: 40%
- 深度工作 Part2: 20%

**没完成的部分**
运动 0 done; 论文 0 done; 工作文档 0 done。

**一个建议**
下周期可以在运动上设置最小执行量。"

Why this is wrong: bold labels at the start of paragraphs ARE section headers in disguise. Enumerating every rail's number is a status report, not a reflection. Suggestions / "下周期" plans are not your job.

ANTI-EXAMPLE 2 (what NOT to write — same dashboard shape, just with the bold dropped and labels renamed to look conversational; this is the harder pattern to spot):

"周期回顾（2026-04-27 → 2026-05-03）
你说了什么
这周你只留下一句话「开发知识助手中。老实说还挺有意思」。

我看到的
- 兴趣项目 Part2 是这周完成度最高的一栏。
- 劳动节三天明显失速。
- 运动和论文是这周的真空区。
- shift 原因很少。

一个问题留给下周
你愿意明确把它当作主线，还是想把运动 / 论文重新拉回来？"

Why this is wrong, even though it sounds friendlier: "你说了什么 / 我看到的 / 一个问题留给下周" are still section headers, just typed as standalone short lines instead of bold prefixes. The four lines under "我看到的" are still a list of self-contained observations rather than a connected train of thought. This is the same dashboard skeleton in a thinner costume. NEVER write in this shape.

LANGUAGE: Reply in ${outputLocale}.

FORMAT:
- 2-4 short paragraphs of continuous prose. Each paragraph picks up where the last one left off — paragraph 2 should build on a thread paragraph 1 introduced, not jump to a new topic. Think "one continuous train of thought broken into paragraphs for breathing", not "list of points dressed as paragraphs".
- Do NOT open paragraphs with bold/italic labels like **主线** / **观察** / **对应数据** / **一个建议** / **没发生的事** / **下一步**. These are dashboard section headers in disguise.
- Do NOT use standalone short lines as paragraph titles either ("你说了什么" / "我看到的" / "一个问题留给下周"). The previous round of dogfood showed the model falling back to this pattern after bold labels were banned. They are still section headers.
- Refer to at most 3-4 specific rails by name across the whole reflection. Pick the few that actually carry the story; do not enumerate every rail. Other rails should not be mentioned by name at all.
- No code fences. No JSON. No \`##\` / \`###\` headers.
- No lead-in like "这是我的观察:" / "周期回顾" / "本周复盘". No trailer like "希望对你有帮助。"
- Start directly from the user's words or experience, not from a category label.`;
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
