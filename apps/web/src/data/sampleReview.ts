// Review-view typing. Sample data was dropped when the view went
// live; kept the file (+ name) so existing imports don't churn.
// Rename to `reviewTypes.ts` next time this area gets refactored.

import type { RailColor } from './sample';

export type HeatmapState =
  | 'done' // completed
  | 'shifted' // happened with a postpone / swap / resize
  | 'skipped' // explicitly skipped / archived
  | 'unmarked' // past-day with no decision — §5.7 territory
  | 'empty'; // Rail didn't apply this day (not counted)

export interface HeatmapRow {
  railId: string;
  railName: string;
  color: RailColor;
  /** Template this rail belongs to — used by RhythmHeatmap to group
   *  rows under a template subheader (workday / restday / etc.). */
  templateKey: string;
  templateName: string;
  /** Date (ISO) → status. Dates not present render as `empty`. */
  byDate: Record<string, HeatmapState>;
}

export interface ShiftTagStat {
  name: string;
  count: number;
}

export interface AdhocHint {
  eventName: string;
  weekdayLabel: string;
  occurrences: number;
}

// "cycle" scope (not "week") ties Review's period to the DayRail Cycle
// unit (§A `C1/C2/C3` notation), not calendar weeks.
export interface ReviewScopeData {
  scope: 'day' | 'cycle' | 'month';
  /** Short period label, e.g. "Thu · 16 Apr 2026" or "Apr 13 – Apr 19". */
  label: string;
  dates: string[]; // ISO dates that form the heatmap columns
  rows: HeatmapRow[];
  shiftTags: ShiftTagStat[];
  adhocHint?: AdhocHint;
  totalDone: number;
  totalSlots: number;
  /** Rhythm match % (`done` / non-empty slots). */
  rhythmMatchPct: number;
}
