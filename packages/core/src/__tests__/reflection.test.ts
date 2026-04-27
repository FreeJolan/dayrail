import { describe, expect, it } from 'vitest';
import { selectReflection } from '../store';
import type { DailyReflection } from '../types';

// selectReflection is a thin O(1) lookup, but it's the single read
// path used by both Today Track and Review · Day. A regression here
// (e.g. accidentally returning {} instead of undefined for an unwritten
// date) would silently make the editor look "edited" on dates the user
// never touched. Kept as a hash-lookup to stay safe for direct use in
// `useStore` selectors without memoization.

function reflection(date: string, content: string): DailyReflection {
  return { date, content, updatedAt: 1_700_000_000_000 };
}

describe('selectReflection', () => {
  it('returns the row when the date has been written', () => {
    const state = {
      reflections: {
        '2026-04-27': reflection('2026-04-27', 'Slept poorly. Try earlier.'),
      },
    };
    const row = selectReflection(state, '2026-04-27');
    expect(row?.content).toBe('Slept poorly. Try earlier.');
  });

  it('returns undefined for an unwritten date — never an empty shell', () => {
    const state = { reflections: {} };
    expect(selectReflection(state, '2026-04-27')).toBeUndefined();
  });
});
