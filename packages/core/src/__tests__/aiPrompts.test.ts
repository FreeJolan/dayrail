// Tests for the AI prompt builders (packages/core/src/ai/prompts.ts).
//
// Coverage focus per ERD §6.6.1 / §6.6.2:
//   - System prompt carries locale + JSON-schema directive
//   - User-background block omitted when empty / whitespace
//   - Day vs Cycle scenario shapes
//   - Token estimate is rough but monotonically increasing

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

  it('forbids code fences in the output', () => {
    const prompt = buildSystemPrompt('en-US');
    expect(prompt).toMatch(/code fences/i);
  });

  it('declares the JSON schema with three top-level keys', () => {
    const prompt = buildSystemPrompt('en-US');
    expect(prompt).toContain('observation');
    expect(prompt).toContain('patterns');
    expect(prompt).toContain('suggestions');
  });

  it('carries observation-not-judgment tone constraint', () => {
    const prompt = buildSystemPrompt('en-US');
    expect(prompt).toMatch(/observe.*judge|do not judge|judg/i);
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

  it('omits USER BACKGROUND when value is whitespace-only', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      background: '   \n  \n',
    });
    expect(out).not.toContain('USER BACKGROUND');
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

  it('marks empty task groups as "(none)" so the model knows', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).toMatch(/Completed today: \(none\)/);
    expect(out).toMatch(/Deferred today: \(none\)/);
    expect(out).toMatch(/Still pending today: \(none\)/);
  });

  it('includes external events as bulleted list when present', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      externalEvents: ['Spring Festival · zh-CN', 'Anniversary'],
    });
    expect(out).toContain('Spring Festival');
    expect(out).toContain('Anniversary');
  });

  it('marks empty reflection as "(none written)" for the model', () => {
    const out = buildDayReviewUserMessage({
      ...baseInput,
      reflectionContent: '',
    });
    expect(out).toMatch(/Daily reflection: \(none written\)/);
  });

  it('repeats the locale directive in the closing line', () => {
    const out = buildDayReviewUserMessage(baseInput);
    expect(out).toContain('zh-CN');
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
    outputLocale: 'en-US',
  };

  it('includes the cycle date range', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).toContain('2026-04-27');
    expect(out).toContain('2026-05-03');
  });

  it('renders per-rail aggregates with match% when present', () => {
    const out = buildCycleReviewUserMessage({
      ...baseInput,
      byRail: [
        {
          railName: 'Morning run',
          completed: 4,
          deferred: 1,
          pending: 2,
          matchPct: 71,
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
    expect(out).toContain('Reading');
    expect(out).not.toContain('match undefined');
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

  it('marks empty reflections as "(none written this cycle)"', () => {
    const out = buildCycleReviewUserMessage(baseInput);
    expect(out).toMatch(/none written this cycle/i);
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
