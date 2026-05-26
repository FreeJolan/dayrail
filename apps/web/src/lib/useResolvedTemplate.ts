import { useMemo } from 'react';
import { useStore } from '@dayrail/core';
import { pickTemplateForDate } from '@/pages/cycleFromStore';

// ERD §6.7.9 — shared resolver for "which template does this date fall
// under?" (CalendarRule → weekday heuristic). Every "schedule a task /
// occurrence onto a rail on a date" surface uses this to (a) show the
// template explicitly as a derived step and (b) scope the rail list to
// that template. Subscribes to the raw calendar maps and derives via
// useMemo (see the "Zustand selectors" memory). Returns null when no
// date is given or no template resolves — callers then fall back to
// showing all rails grouped.
export function useResolvedTemplateKey(
  date: string | undefined | null,
): string | null {
  const templates = useStore((s) => s.templates);
  const calendarRules = useStore((s) => s.calendarRules);
  const calendarRuleRevisions = useStore((s) => s.calendarRuleRevisions);
  const calendarRuleTombstones = useStore((s) => s.calendarRuleTombstones);
  const userDayNotes = useStore((s) => s.userDayNotes);
  const userProfile = useStore((s) => s.userProfile);

  return useMemo(() => {
    if (!date) return null;
    return (
      pickTemplateForDate(
        {
          templates,
          calendarRules,
          calendarRuleRevisions,
          calendarRuleTombstones,
          userDayNotes,
          userProfile,
        },
        date,
      ) ?? null
    );
  }, [
    date,
    templates,
    calendarRules,
    calendarRuleRevisions,
    calendarRuleTombstones,
    userDayNotes,
    userProfile,
  ]);
}
