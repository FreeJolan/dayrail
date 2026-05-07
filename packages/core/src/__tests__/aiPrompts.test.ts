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

describe('buildSystemPrompt', () => {
  it('embeds the requested output locale', () => {
    expect(buildSystemPrompt('zh-CN')).toContain('zh-CN');
    expect(buildSystemPrompt('en-US')).toContain('en-US');
  });

  it('asks for prose, not JSON', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/short reflection/i);
    expect(prompt).toMatch(/Not JSON/);
    expect(prompt).toMatch(/No code fences/);
  });

  it('teaches the inline citation convention with 「」 brackets', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/CITATION CONVENTION/);
    expect(prompt).toContain('「');
    expect(prompt).toContain('」');
    expect(prompt).toMatch(/verbatim/i);
  });

  it('includes a worked example of the citation pattern', () => {
    const prompt = buildSystemPrompt('zh-CN');
    expect(prompt).toMatch(/Worked example/i);
    // Example contains an actual 「」-bracketed citation
    expect(prompt).toMatch(/「[^」]+」/);
  });

  it('keeps the observation-not-judgment tone constraint', () => {
    const prompt = buildSystemPrompt('en-US');
    expect(prompt).toMatch(/Observe, do not judge/i);
  });

  it('forbids productivity-coach platitudes by example', () => {
    const prompt = buildSystemPrompt('en-US');
    expect(prompt).toMatch(/great job/i);
    expect(prompt).toMatch(/试试番茄钟|Pomodoro/i);
  });

  it('forbids restating UI facts (no productivity-coach summary)', () => {
    const prompt = buildSystemPrompt('en-US');
    expect(prompt).toMatch(/Do not restate facts the user can read/i);
  });

  it('forbids generic lead-ins / trailers', () => {
    const prompt = buildSystemPrompt('en-US');
    expect(prompt).toMatch(/start directly with the substance/i);
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
    expect(out).toMatch(/Completed today: \(none\)/);
    expect(out).toMatch(/Deferred today: \(none\)/);
    expect(out).toMatch(/Still pending today: \(none\)/);
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

  it('marks empty reflection as "(none written)" for the model', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      reflectionContent: '',
    });
    expect(out).toMatch(/Daily reflection: \(none written\)/);
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
