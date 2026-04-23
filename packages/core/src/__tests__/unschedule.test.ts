import { describe, expect, it } from 'vitest';
import { detectUnschedule } from '../unschedule';
import type { AdhocEvent, Task } from '../types';

// §5.5.6 trigger-rule table for the `type='unschedule'` path. Mirrors
// reschedule.test.ts but without the cross-day axis — clearing a
// schedule has no `nextDate`.

const TODAY = '2026-04-22';

function slot(date: string): NonNullable<Task['slot']> {
  return { cycleId: `cycle-${date}`, date, railId: 'r-morning' };
}

function adhoc(date: string): AdhocEvent {
  return {
    id: 'adhoc-1',
    date,
    startMinutes: 9 * 60,
    durationMinutes: 30,
    name: 'x',
    status: 'active',
  };
}

describe('detectUnschedule', () => {
  it('fires on overdue rail → cleared', () => {
    const r = detectUnschedule({
      priorSlot: slot('2026-04-18'),
      priorAdhoc: undefined,
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: true, priorDate: '2026-04-18' });
  });

  it('fires on overdue ad-hoc → cleared (no prior slot)', () => {
    const r = detectUnschedule({
      priorSlot: undefined,
      priorAdhoc: adhoc('2026-04-20'),
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: true, priorDate: '2026-04-20' });
  });

  it('does NOT fire when there was no prior binding', () => {
    // Defensive: unscheduleTask is a no-op in this case, but the
    // detector must not light up for "cleared nothing".
    const r = detectUnschedule({
      priorSlot: undefined,
      priorAdhoc: undefined,
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('does NOT fire when prior date is today (not overdue)', () => {
    const r = detectUnschedule({
      priorSlot: slot(TODAY),
      priorAdhoc: undefined,
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('does NOT fire when prior date is in the future (planning, not slippage)', () => {
    const r = detectUnschedule({
      priorSlot: slot('2026-04-30'),
      priorAdhoc: undefined,
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('does NOT fire for auto-habit tasks', () => {
    const r = detectUnschedule({
      priorSlot: slot('2026-04-18'),
      priorAdhoc: undefined,
      todayIso: TODAY,
      isAutoHabit: true,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('prefers slot.date over adhoc.date for priorDate when both exist', () => {
    // Two modes are mutually exclusive in practice, but the helper
    // must behave predictably if both ever land. Slot wins — that's
    // the authoritative rail binding when present.
    const r = detectUnschedule({
      priorSlot: slot('2026-04-15'),
      priorAdhoc: adhoc('2026-04-17'),
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: true, priorDate: '2026-04-15' });
  });
});
