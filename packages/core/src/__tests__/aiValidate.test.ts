// Tests for the lenient observation-JSON validator
// (packages/core/src/ai/validate.ts).
//
// The validator absorbs predictable schema drift instead of failing
// the whole call when the model uses "finding" instead of "claim",
// adds extra fields like "severity", or forgets the headline. This
// matters in practice: code-tuned models (Claude / OpenAI variants
// via local bridges) routinely substitute their lint-style schema.

import { describe, expect, it } from 'vitest';
import { AiClientError } from '../ai/client';
import { validateObservationJson } from '../ai/validate';

describe('validateObservationJson · canonical shape', () => {
  it('passes the canonical citation-bound JSON through untouched', () => {
    const out = validateObservationJson({
      headline: '本周节奏受会议冲突影响',
      observations: [
        {
          claim: '会议把训练时段挤掉',
          from_data: 'shift tag: 会议冲突',
        },
      ],
      questions_to_sit_with: ['是否需要把会议挡在周末之外？'],
    });
    expect(out.headline).toBe('本周节奏受会议冲突影响');
    expect(out.observations).toEqual([
      { claim: '会议把训练时段挤掉', from_data: 'shift tag: 会议冲突' },
    ]);
    expect(out.questions_to_sit_with).toEqual([
      '是否需要把会议挡在周末之外？',
    ]);
  });

  it('defaults missing observations / questions_to_sit_with to []', () => {
    const out = validateObservationJson({ headline: 'sparse data' });
    expect(out.observations).toEqual([]);
    expect(out.questions_to_sit_with).toEqual([]);
  });
});

describe('validateObservationJson · alias mapping', () => {
  it('maps "finding" → "claim"', () => {
    const out = validateObservationJson({
      headline: 'h',
      observations: [{ finding: '运动 0 完成', from_data: 'match 0%' }],
    });
    expect(out.observations[0]?.claim).toBe('运动 0 完成');
    expect(out.observations[0]?.from_data).toBe('match 0%');
  });

  it('maps "evidence" / "quote" → "from_data"', () => {
    const out = validateObservationJson({
      headline: 'h',
      observations: [
        { claim: 'A', evidence: 'evidence-x' },
        { claim: 'B', quote: 'quote-y' },
      ],
    });
    expect(out.observations[0]?.from_data).toBe('evidence-x');
    expect(out.observations[1]?.from_data).toBe('quote-y');
  });

  it('maps "summary" / "takeaway" / "title" → "headline"', () => {
    expect(validateObservationJson({ summary: 'sum' }).headline).toBe('sum');
    expect(validateObservationJson({ takeaway: 'take' }).headline).toBe('take');
    expect(validateObservationJson({ title: 'tit' }).headline).toBe('tit');
  });

  it('maps "questions" / "next_steps" → "questions_to_sit_with"', () => {
    const out = validateObservationJson({
      headline: 'h',
      questions: ['q1', 'q2'],
    });
    expect(out.questions_to_sit_with).toEqual(['q1', 'q2']);
  });

  it('maps "findings" → "observations" array', () => {
    const out = validateObservationJson({
      headline: 'h',
      findings: [{ finding: 'a', evidence: 'b' }],
    });
    expect(out.observations).toEqual([{ claim: 'a', from_data: 'b' }]);
  });
});

describe('validateObservationJson · drift tolerance', () => {
  it('drops unknown fields like "severity" / "priority" / "type"', () => {
    const out = validateObservationJson({
      headline: 'h',
      observations: [
        {
          finding: 'x',
          from_data: 'y',
          severity: 'high',
          priority: 1,
          type: 'lint',
          confidence_score: 0.9,
        },
      ],
    });
    expect(out.observations[0]).toEqual({ claim: 'x', from_data: 'y' });
  });

  it('synthesizes headline from first observation when missing', () => {
    const out = validateObservationJson({
      observations: [
        { claim: '本周完成度持续低于 50%', from_data: 'match 41%' },
      ],
    });
    expect(out.headline).toBe('本周完成度持续低于 50%');
  });

  it('truncates long synthesized headlines to ~60 chars', () => {
    const long = '这是一个故意非常非常长的 claim '.repeat(8);
    const out = validateObservationJson({
      observations: [{ claim: long, from_data: 'x' }],
    });
    expect(out.headline.length).toBeLessThanOrEqual(60);
    expect(out.headline.endsWith('…')).toBe(true);
  });

  it('accepts bare-string entries by treating them as claim with empty from_data', () => {
    const out = validateObservationJson({
      headline: 'h',
      observations: ['raw claim 1', 'raw claim 2'],
    });
    expect(out.observations).toEqual([
      { claim: 'raw claim 1', from_data: '' },
      { claim: 'raw claim 2', from_data: '' },
    ]);
  });

  it('drops entries that have no claim-like field', () => {
    const out = validateObservationJson({
      headline: 'h',
      observations: [
        { claim: 'kept' },
        { from_data: 'orphan' },
        { something_unknown: 'x' },
        null,
      ],
    });
    expect(out.observations).toEqual([{ claim: 'kept', from_data: '' }]);
  });

  it('filters non-string and empty-string entries from questions list', () => {
    const out = validateObservationJson({
      headline: 'h',
      questions_to_sit_with: ['q1', '', '   ', 42, null, 'q2'],
    });
    expect(out.questions_to_sit_with).toEqual(['q1', 'q2']);
  });
});

describe('validateObservationJson · failure cases', () => {
  it('throws parse-error on non-object input', () => {
    expect(() => validateObservationJson('plain string')).toThrow(AiClientError);
    expect(() => validateObservationJson(42)).toThrow(AiClientError);
    expect(() => validateObservationJson(null)).toThrow(AiClientError);
  });

  it('throws parse-error when "observations" is present but not an array', () => {
    try {
      validateObservationJson({ headline: 'h', observations: 'not an array' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('parse-error');
    }
  });

  it('throws parse-error when there is neither headline nor any usable observation', () => {
    try {
      validateObservationJson({ unrelated: 'value' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AiClientError);
      expect((err as AiClientError).kind).toBe('parse-error');
    }
  });
});

// Real-world regression case from PR #10 dogfood: claude-opus-4-7 via
// claude-bridge returned a lint-style schema { findings: [{ finding,
// from_data, severity }] } with no headline / questions. The lenient
// validator should rescue it.
describe('validateObservationJson · regression', () => {
  it('rescues the dogfood case verbatim (claude-opus-4-7 via claude-bridge)', () => {
    const raw = {
      observations: [
        {
          finding: '运动类任务完成率极低',
          from_data: '运动（有氧）: 0 done · 4 deferred · 1 pending, match 0%',
          severity: 'high',
        },
        {
          finding: '论文精读/数学整周零推进',
          from_data: '论文精读 / 数学: 0 done · 0 deferred · 5 pending, match 0%',
          severity: 'high',
        },
      ],
    };
    const out = validateObservationJson(raw);
    expect(out.observations).toHaveLength(2);
    expect(out.observations[0]?.claim).toBe('运动类任务完成率极低');
    expect(out.observations[0]?.from_data).toBe(
      '运动（有氧）: 0 done · 4 deferred · 1 pending, match 0%',
    );
    expect(out.observations[0]).not.toHaveProperty('severity');
    expect(out.headline.length).toBeGreaterThan(0);
    expect(out.questions_to_sit_with).toEqual([]);
  });
});
