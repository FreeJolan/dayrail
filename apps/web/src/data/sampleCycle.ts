// Cycle-View type shapes. The static sample arrays (SAMPLE_CYCLE,
// SAMPLE_CYCLES, SAMPLE_BACKLOG, SAMPLE_SLOTS, et al.) were dropped
// after the live-data wire-up — the Cycle-View components read from
// cycleFromStore.deriveCycleFromStore now. This file survives so the
// exported interfaces stay co-located under `@/data/sampleCycle` and
// existing imports keep working.

import type { RailColor } from './sample';
import type { TemplateKey } from './sampleTemplate';

export interface CycleDay {
  date: string; // ISO "YYYY-MM-DD"
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sun
  templateKey: TemplateKey;
  overridden: boolean; // user changed it from the default weekday rule
}

export type SlotState =
  | 'planned-empty' // future; Rail row exists but no task assigned
  | 'planned-task' // future; a Task is scheduled
  | 'done' // completed in the past
  | 'shifted' // happened but with a postpone / swap / resize
  | 'skipped' // user marked skipped
  | 'na'; // day doesn't apply (unused Rail row for this day)

export interface CycleSlot {
  railId: string;
  date: string;
  state: SlotState;
  taskName?: string;
  /** For shifted/done states that carry a Mono meta (e.g. `→ 20:00`). */
  meta?: string;
  /** Populated when the slot is backed by a live Task (planned-task
   *  cells from the live-data path); enables slot-level actions like
   *  "移除排期". Sample-data paths can leave this undefined. */
  taskId?: string;
  /** Sub-item progress from the carrying Task. 0/0 = no sub-items.
   *  Populated by cycleFromStore; sample-data paths leave undefined. */
  subItemsDone?: number;
  subItemsTotal?: number;
  /** True when the carrying Task has a non-empty `note`. */
  hasNote?: boolean;
  /** Optional milestone percent from the carrying Task. */
  milestonePercent?: number;
  /** True when the carrying Task is a habit-materialized auto-task. */
  isAutoTask?: boolean;
}

export interface SampleCycle {
  id: string;
  label: string; // "C1"
  startDate: string;
  endDate: string;
  days: CycleDay[];
  slots: CycleSlot[];
  /** Line-level progress snapshots for the summary strip (D5). */
  topLines: Array<{
    id: string;
    name: string;
    color: RailColor;
    done: number;
    planned: number;
  }>;
}

// -- Helpers still consumed by the live-data view path --

export const formatDayLabel = (
  day: CycleDay,
  locale = 'en-US',
): { weekday: string; dayNum: string; monthAbbr: string } => {
  const dt = new Date(day.date + 'T00:00:00');
  const weekday = dt.toLocaleDateString(locale, { weekday: 'short' });
  const monthAbbr = dt.toLocaleDateString(locale, { month: 'short' });
  const dayNum = String(dt.getDate()).padStart(2, '0');
  return { weekday, dayNum, monthAbbr };
};
