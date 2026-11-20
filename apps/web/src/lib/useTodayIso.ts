import { useEffect, useState } from 'react';
import { toIsoDate } from '@dayrail/core';

// Live "today" (local ISO YYYY-MM-DD) that survives midnight.
//
// Several long-lived surfaces (always-mounted drawers, dialogs that
// stay open across days in a resident desktop window) used to compute
// `today` once at mount with an empty-dep useMemo, which goes stale at
// the day boundary — overdue checks and effective-from resolution then
// keep using yesterday's date until an app restart.
//
// This hook samples the local date on a 30s tick (same cadence as
// TodayTrack's useLiveNow) but only commits state when the ISO string
// actually flips, so consumers re-render exactly once per day.
export function useTodayIso(): string {
  const [today, setToday] = useState(() => toIsoDate());
  useEffect(() => {
    const tick = () => {
      const next = toIsoDate();
      // setState with the same string is a no-op re-render-wise, but
      // be explicit: only flip at the day boundary.
      setToday((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}
