// Tests for the AI prompt builders (packages/core/src/ai/prompts.ts).
//
// v0.8.2 dogfood reversal: the original tests asserted the JSON schema
// + field-name discipline. Those are gone now that we've moved to
// free-form Markdown output with a citation convention. This file
// asserts the new prose convention is taught correctly + the data
// slicing fields (which kept their shape) still flow through.

import { describe, expect, it } from 'vitest';
import {
  buildCycleReviewUserMessage,
  buildDayReviewUserMessage,
  buildMessages,
  buildSystemPrompt,
  estimateTokens,
} from '../ai/prompts';

// ------------ buildSystemPrompt ------------
//
// The prompt is persona-driven (warm friend / counselor / kind elder)
// rather than rule-list-driven. These tests assert the persona +
// philosophy + worked example are intact, plus a small set of hard
// constraints (citation convention, no JSON, no headers). We do NOT
// test for an exhaustive forbidden-vocab list — that approach was
// reactive and accumulated faster than it caught patterns. Trust the
// persona + the worked example to do most of the steering.

describe('buildSystemPrompt', () => {
  it('embeds the requested output locale', () => {
    expect(buildSystemPrompt('zh-CN')).toContain('zh-CN');
    expect(buildSystemPrompt('en-US')).toContain('en-US');
  });

  it('opens by staging the SCENE (chat reply, not abstract persona)', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/^SCENE:/);
    expect(prompt).toMatch(/sent you a long-ish message in WeChat/);
    expect(prompt).toMatch(/YOU ARE NOW TYPING A REPLY TO THEM/);
  });

  it('keeps the warm-friend / counselor / kind-elder persona inside the scene', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/warm friend/i);
    expect(prompt).toMatch(/counselor|kind elder/i);
  });

  it('contrasts the chat-reply medium with reports / emails (the structural anchor)', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/ABOUT THE MEDIUM/);
    expect(prompt).toMatch(/WeChat reply, not a report or an email/);
    expect(prompt).toMatch(/people don't write status reports to friends in WeChat/i);
  });

  it('names specific dashboard openers from dogfood as "things you would not write in WeChat"', () => {
    const prompt = buildSystemPrompt('zh-CN');
    // These are the actual labels that appeared in real dogfood
    // output and survived earlier rounds.
    expect(prompt).toContain('周期回顾 YYYY-MM-DD');
    expect(prompt).toContain('用户的声音');
    expect(prompt).toContain('这段话落在什么样的一周里');
    expect(prompt).toContain('一句话给下周');
  });

  it('articulates the DayRail "missing is allowed" (允许错过) ethos', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toContain('允许错过');
    expect(prompt).toMatch(/missing is allowed/i);
    expect(prompt).toMatch(/not asking you to audit|grade their past/i);
  });

  it('teaches the three-step shape · notice warmly · offer 2-3 small possibilities · hand back the choice', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/Notice their situation warmly/i);
    expect(prompt).toMatch(/2-3 small, gentle adjustments/i);
    expect(prompt).toMatch(/Hand the choice back/i);
  });

  it('encourages compassionate hypotheses about why something might have slipped', () => {
    const prompt = buildSystemPrompt('zh-CN');
    // The list of compassionate causes to consider
    expect(prompt).toMatch(/maybe they were tired/);
    expect(prompt).toMatch(/maybe their schedule got too full/);
    expect(prompt).toMatch(/emotionally hard stretch/);
  });

  it('teaches possibility-language (也许 / 你应该) over imperative-language', () => {
    const prompt = buildSystemPrompt('zh-CN');
    // The "也许 / 不要 你应该" contrast is core to the suggestion shape
    expect(prompt).toContain('也许');
    expect(prompt).toContain('你应该');
  });

  it('lists examples of the right kind of small adjustment', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/lower the frequency/i);
    expect(prompt).toMatch(/shorten one occurrence/i);
    expect(prompt).toMatch(/move it to a different time of day/i);
  });

  it('teaches the inline citation convention with 「」 brackets', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/WHEN YOU REFERENCE THEIR DATA/);
    expect(prompt).toContain('「');
    expect(prompt).toContain('」');
    expect(prompt).toMatch(/verbatim/i);
  });

  it('includes a positive worked example demonstrating warmth + possibility-offering', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/EXAMPLE OF THE RIGHT SHAPE/);
    // Example uses possibility-language
    expect(prompt).toMatch(/也许|可以这样想|挑一个、都不挑/);
    // Example demonstrates the citation convention
    expect(prompt).toMatch(/「[^」]+」/);
    // Example explicitly hands the choice back at the end
    expect(prompt).toMatch(/你比我更知道自己/);
  });

  it('frames "what NOT to say" as friend-voice rather than rule list', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/THINGS YOU WOULDN'T SAY/);
    expect(prompt).toMatch(/a real friend wouldn't either/i);
    expect(prompt).toContain('必须');
    expect(prompt).toContain('做得不够');
  });

  it('forbids JSON / code fences / section headers in the output', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/No JSON/);
    expect(prompt).toMatch(/no code fences/i);
    expect(prompt).toMatch(/no section headers/i);
  });
});

// ------------ buildDayReviewUserMessage ------------

describe('buildDayReviewUserMessage', () => {
  const baseInput = {
    background: '',
    date: '2026-05-07',
    weekday: 'Thursday · 周四',
    externalEvents: [],
    completed: [],
    deferred: [],
    pending: [],
    reflectionContent: 'Felt focused this morning.',
    outputLocale: 'zh-CN',
  };

  it('includes the date header', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).toContain('2026-05-07');
    expect(out).toContain('Thursday · 周四');
  });

  it('includes the day template name when provided', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      templateName: 'workday',
    });
    expect(out).toMatch(/Day template: workday/);
  });

  it('omits USER BACKGROUND block when background is empty', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).not.toContain('USER BACKGROUND');
  });

  it('includes USER BACKGROUND block when non-empty', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      background: 'I am a grad student preparing for thesis defense.',
    });
    expect(out).toContain('USER BACKGROUND');
    expect(out).toContain('grad student');
  });

  it('renders task groups with title / line / time bullets', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      completed: [
        { title: 'Morning run', line: 'Habits', time: '06:30–07:00' },
        { title: 'Thesis section 3' },
      ],
      deferred: [{ title: 'Email reply', line: 'Inbox' }],
    });
    expect(out).toContain('Morning run');
    expect(out).toContain('Habits');
    expect(out).toContain('06:30–07:00');
    expect(out).toContain('Thesis section 3');
    expect(out).toContain('Email reply');
    expect(out).toContain('Inbox');
  });

  it('appends shift reason tags to deferred tasks', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      deferred: [
        {
          title: 'Email reply',
          line: 'Inbox',
          shiftTags: ['会议冲突', '状态不佳'],
        },
      ],
    });
    expect(out).toContain('Email reply');
    expect(out).toContain('shift tag: 会议冲突, 状态不佳');
  });

  it('appends habit phase context to auto-task lines', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      pending: [
        {
          title: '晨跑',
          line: 'Habits',
          time: '06:30–07:00',
          habitContext: '晨跑 · 冲刺期',
        },
      ],
    });
    expect(out).toContain('habit: 晨跑 · 冲刺期');
  });

  it('marks empty task groups as "(none)" so the model knows', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).toMatch(/Today's tasks · completed: \(none\)/);
    expect(out).toMatch(/Today's tasks · deferred: \(none\)/);
    expect(out).toMatch(/Today's tasks · still pending: \(none\)/);
  });

  it('leads with the reflection text (primary signal framing)', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      reflectionContent: 'Felt focused this morning.',
    });
    const reflectionIdx = out.indexOf('Felt focused this morning');
    const tasksIdx = out.indexOf("Today's tasks");
    expect(reflectionIdx).toBeGreaterThan(-1);
    expect(tasksIdx).toBeGreaterThan(-1);
    expect(reflectionIdx).toBeLessThan(tasksIdx);
  });

  it('renders the 7-day baseline block when supplied', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      baseline: {
        daysObserved: 7,
        avgDone: 4.2,
        maxDone: 6,
        minDone: 2,
        avgDeferred: 1.1,
        recurringShiftTags: [
          { tag: '会议冲突', count: 8 },
          { tag: '状态不佳', count: 3 },
        ],
      },
    });
    expect(out).toMatch(/7-day baseline/);
    expect(out).toContain('avg 4.2');
    expect(out).toContain('max 6');
    expect(out).toContain('min 2');
    expect(out).toContain('会议冲突 (8x)');
    expect(out).toContain('状态不佳 (3x)');
  });

  it('marks the baseline as insufficient when omitted', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).toMatch(/insufficient history/i);
  });

  it('marks empty reflection with neutral note (not moralized)', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      reflectionContent: '',
    });
    expect(out).toMatch(/nothing written/);
    expect(out).toMatch(/don't read into it/i);
  });

  it('reminds the model to cite verbatim quotes in the closing line', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).toMatch(/verbatim/i);
    expect(out).toContain('「');
  });

  it('does not mention JSON in the closing line', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).not.toMatch(/JSON/);
  });
});

// ------------ buildCycleReviewUserMessage ------------

describe('buildCycleReviewUserMessage', () => {
  const baseInput = {
    background: '',
    startDate: '2026-04-27',
    endDate: '2026-05-03',
    byRail: [],
    externalEventSummary: '',
    reflections: [],
    shiftTagDistribution: [],
    dailyMatchTrajectory: [],
    habitPhaseBoundaries: [],
    outputLocale: 'en-US',
  };

  it('includes the cycle date range', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).toContain('2026-04-27');
    expect(out).toContain('2026-05-03');
  });

  it('renders per-rail aggregates with match% and habit phase when present', () => {
    const out = buildCycleReviewUserMessage({
      ...baseInput,
      byRail: [
        {
          railName: 'Morning run',
          completed: 4,
          deferred: 1,
          pending: 2,
          matchPct: 71,
          habitPhase: '冲刺期',
        },
        {
          railName: 'Reading',
          completed: 6,
          deferred: 0,
          pending: 1,
        },
      ],
    });
    expect(out).toContain('Morning run');
    expect(out).toContain('4 done');
    expect(out).toContain('1 deferred');
    expect(out).toContain('match 71%');
    expect(out).toContain('phase: 冲刺期');
    expect(out).toContain('Reading');
    expect(out).not.toContain('match undefined');
  });

  it('renders the day-by-day match% trajectory', () => {
    const out = buildCycleReviewUserMessage({
      ...baseInput,
      dailyMatchTrajectory: [
        { date: '2026-04-27', matchPct: 71 },
        { date: '2026-04-28', matchPct: 86 },
        { date: '2026-04-29' },
      ],
    });
    expect(out).toContain('Day-by-day match% trajectory');
    expect(out).toContain('2026-04-27: 71%');
    expect(out).toContain('2026-04-28: 86%');
    expect(out).toContain('2026-04-29: —');
  });

  it('renders the shift tag distribution when present', () => {
    const out = buildCycleReviewUserMessage({
      ...baseInput,
      shiftTagDistribution: [
        { tag: '会议冲突', count: 5 },
        { tag: '状态不佳', count: 3 },
      ],
    });
    expect(out).toContain('Shift reason tag distribution');
    expect(out).toContain('会议冲突: 5 times');
    expect(out).toContain('状态不佳: 3 times');
  });

  it('marks empty shift tag distribution explicitly', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).toMatch(/Shift reason tags: \(no shifts this cycle\)/);
  });

  it('renders habit phase boundaries when present', () => {
    const out = buildCycleReviewUserMessage({
      ...baseInput,
      habitPhaseBoundaries: [
        { habitName: '晨跑', date: '2026-04-29', newPhase: '冲刺期' },
      ],
    });
    expect(out).toContain('Habit phase boundaries');
    expect(out).toContain('2026-04-29: 晨跑 → 冲刺期');
  });

  it('omits the phase-boundary block when there are none', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).not.toContain('Habit phase boundaries');
  });

  it('marks empty rails as "(no rails active)"', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).toMatch(/no rails active/i);
  });

  it('joins multiple reflections with chronological headers', () => {
    const out = buildCycleReviewUserMessage({
      ...baseInput,
      reflections: [
        { date: '2026-04-27', content: 'Slow start.' },
        { date: '2026-04-28', content: 'Better.' },
      ],
    });
    expect(out).toContain('### 2026-04-27');
    expect(out).toContain('Slow start.');
    expect(out).toContain('### 2026-04-28');
    expect(out).toContain('Better.');
  });

  it('reminds the model to cite verbatim quotes in the closing line', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).toMatch(/verbatim/i);
    expect(out).toContain('「');
  });

  it('does not mention JSON in the closing line', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).not.toMatch(/JSON/);
  });
});

// ------------ buildMessages ------------

describe('buildMessages', () => {
  it('returns one system + one user message in order', () => {
    const msgs = buildMessages('SYS', 'USR');
    expect(msgs).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
  });
});

// ------------ estimateTokens ------------

describe('estimateTokens', () => {
  it('returns roughly chars / 4', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('1234567812345678')).toBe(4);
  });

  it('grows monotonically with content length', () => {
    const a = estimateTokens('hello');
    const b = estimateTokens('hello world hello world');
    expect(b).toBeGreaterThan(a);
  });
});
