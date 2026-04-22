import { describe, expect, it } from 'vitest';
import { detectReschedule } from '../reschedule';
import type { AdhocEvent, Task } from '../types';

// §5.5.6 trigger-rule table, exhaustively. The store wires the real
// ulid + event emission; this file pins down the decision boundary so
// no future refactor accidentally fires reschedule Shifts on a plain
// same-day drag or on a first-time schedule.

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

describe('detectReschedule', () => {
  it('fires on overdue rail → new day', () => {
    const r = detectReschedule({
      priorSlot: slot('2026-04-18'),
      priorAdhoc: undefined,
      nextDate: '2026-04-24',
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: true, priorDate: '2026-04-18' });
  });

  it('fires on overdue ad-hoc → new day (no prior slot)', () => {
    const r = detectReschedule({
      priorSlot: undefined,
      priorAdhoc: adhoc('2026-04-20'),
      nextDate: '2026-04-25',
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: true, priorDate: '2026-04-20' });
  });

  it('does NOT fire on first-time schedule (no prior binding)', () => {
    const r = detectReschedule({
      priorSlot: undefined,
      priorAdhoc: undefined,
      nextDate: '2026-04-23',
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('does NOT fire on same-day drag (within-day shuffle)', () => {
    const r = detectReschedule({
      priorSlot: slot('2026-04-18'),
      priorAdhoc: undefined,
      nextDate: '2026-04-18',
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('does NOT fire when prior date is today (not overdue)', () => {
    const r = detectReschedule({
      priorSlot: slot(TODAY),
      priorAdhoc: undefined,
      nextDate: '2026-04-25',
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('does NOT fire when prior date is in the future (planning, not slippage)', () => {
    const r = detectReschedule({
      priorSlot: slot('2026-04-30'),
      priorAdhoc: undefined,
      nextDate: '2026-05-02',
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('does NOT fire for auto-habit tasks', () => {
    const r = detectReschedule({
      priorSlot: slot('2026-04-18'),
      priorAdhoc: undefined,
      nextDate: '2026-04-24',
      todayIso: TODAY,
      isAutoHabit: true,
    });
    expect(r).toEqual({ shouldEmit: false });
  });

  it('prefers slot.date over adhoc.date for priorDate when both exist', () => {
    // This shouldn't happen at runtime (the two modes are mutually
    // exclusive), but the helper must behave predictably if the store
    // ever feeds both. Slot wins because that's the authoritative rail
    // binding when present.
    const r = detectReschedule({
      priorSlot: slot('2026-04-15'),
      priorAdhoc: adhoc('2026-04-17'),
      nextDate: '2026-04-24',
      todayIso: TODAY,
      isAutoHabit: false,
    });
    expect(r).toEqual({ shouldEmit: true, priorDate: '2026-04-15' });
  });
});
