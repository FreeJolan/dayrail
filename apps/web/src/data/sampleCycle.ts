// Cycle-View type shapes. The static sample arrays (SAMPLE_CYCLE,
// SAMPLE_CYCLES, SAMPLE_BACKLOG, SAMPLE_SLOTS, et al.) were dropped
// after the live-data wire-up — the Cycle-View components read from
// cycleFromStore.deriveCycleFromStore now. This file survives so the
// exported interfaces stay co-located under `@/data/sampleCycle` and
// existing imports keep working.

import type { RailColor } from './sample';
import type { TemplateKey } from './sampleTemplate';
import type { TaskPriority } from '@dayrail/core';

export interface CycleDay {
  date: string; // ISO "YYYY-MM-DD"
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sun
  templateKey: TemplateKey;
  overridden: boolean; // user changed it from the default weekday rule
}

/** Per-task status as it appears on a Cycle cell pill. */
export type SlotTaskState =
  | 'pending'
  | 'done'
  | 'deferred'
  | 'archived';

export interface SlotTaskSummary {
  taskId: string;
  title: string;
  state: SlotTaskState;
  isAutoTask: boolean;
  /** Kept as a flag so the tooltip knows to render the note section.
   *  The actual note text is fetched via `noteSnippet` when present. */
  hasNote: boolean;
  noteSnippet?: string;
  /** Full Markdown source — used by the NoteHoverPopover so the hover
   *  preview renders structure (lists / headings / code) rather than
   *  a truncated raw string. Absent when the task has no note. */
  note?: string;
  subItemsDone: number;
  subItemsTotal: number;
  /** Full sub-items array — lets the pill tooltip list them and the
   *  per-pill popover expose a toggle checklist without each cell
   *  subscribing to the store directly. */
  subItems?: Array<{ id: string; title: string; done: boolean }>;
  milestonePercent?: number;
  priority?: TaskPriority;
}

export interface CycleSlot {
  railId: string;
  date: string;
  /** All tasks scheduled to this (date, railId). Empty array = bare
   *  slot (renders as planned-empty). Multiple entries render as a
   *  vertical pill list; each pill is styled by its own status. */
  tasks: SlotTaskSummary[];
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
