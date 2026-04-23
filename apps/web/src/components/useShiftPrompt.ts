import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useStore,
  type ReschedulePayload,
  type UnschedulePayload,
} from '@dayrail/core';
import type { ReasonToastState } from './ReasonToast';
import { topTagsForRail } from './useReasonToast';

// ------------------------------------------------------------------
// Controller for the overdue-shift Reason toast (ERD §5.5.6). Handles
// both `type='reschedule'` (v0.4.1) and `type='unschedule'` (v0.4.2)
// — the store queues either into `pendingShiftPrompt` and this hook
// dispatches on the shift's `type` to pick the right toast copy +
// recommended-tags lookup.
//
// Mirrors `useReasonToast`'s shape (same ReasonToastState, same
// add-tag / close callbacks) but:
//   - Subscribes to `pendingShiftPrompt` instead of firing on a local
//     action. The store auto-records the Shift before the toast shows,
//     so tag-picking goes through `setShiftTags` (append to existing)
//     rather than `recordShift`.
//   - Hides Undo — both actions are already committed; the inverse
//     gesture is direct manipulation (drag / Schedule popover), not a
//     toast button. The noop undo still clears the prompt so the
//     toast dismisses cleanly.
// ------------------------------------------------------------------

export function useShiftPrompt(): {
  toast: ReasonToastState | null;
  onAddTag: (tag: string) => void;
  onUndo: () => void;
  onClose: () => void;
} {
  const pending = useStore((s) => s.pendingShiftPrompt);
  const tasks = useStore((s) => s.tasks);
  const shifts = useStore((s) => s.shifts);
  const setShiftTags = useStore((s) => s.setShiftTags);
  const ackShiftPrompt = useStore((s) => s.ackShiftPrompt);

  const [toast, setToast] = useState<ReasonToastState | null>(null);
  const tagsRef = useRef<string[]>([]);
  const shiftIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pending) {
      setToast(null);
      shiftIdRef.current = null;
      tagsRef.current = [];
      return;
    }
    // Same shift already on-screen? Don't churn the toast state.
    if (shiftIdRef.current === pending.id) return;

    shiftIdRef.current = pending.id;
    tagsRef.current = [];
    const task = tasks[pending.taskId];
    const title = task?.title ?? 'Task';

    if (pending.type === 'reschedule') {
      const payload = pending.payload as unknown as ReschedulePayload;
      const railIdForTags = payload.toRailId ?? payload.fromRailId;
      setToast({
        action: 'reschedule',
        instanceId: pending.id,
        // Use the railName slot to describe the task + destination so
        // the toast copy reads "已改期 · <title> → <toDate>". No
        // dedicated subtitle field on ReasonToastState.
        railName: `${title} → ${payload.toDate}`,
        isRecurring: false,
        recommendedTags: railIdForTags
          ? topTagsForRail(railIdForTags, tasks, shifts)
          : [],
      });
      return;
    }

    if (pending.type === 'unschedule') {
      const payload = pending.payload as unknown as UnschedulePayload;
      const railIdForTags = payload.fromRailId;
      setToast({
        action: 'unschedule',
        instanceId: pending.id,
        // "已取消排期 · <title>" — no destination to show since the
        // task is headed nowhere.
        railName: title,
        isRecurring: false,
        recommendedTags: railIdForTags
          ? topTagsForRail(railIdForTags, tasks, shifts)
          : [],
      });
      return;
    }

    // defer / archive don't flow through this queue — they use the
    // per-surface `useReasonToast` pipeline. If one ever leaks in,
    // drop it silently so the toast doesn't get stuck open.
    shiftIdRef.current = null;
  }, [pending, tasks, shifts]);

  const onAddTag = useCallback((tag: string) => {
    if (!tagsRef.current.includes(tag)) {
      tagsRef.current = [...tagsRef.current, tag];
    }
  }, []);

  const onUndo = useCallback(() => {
    // No programmatic undo for either overdue-shift type — provided
    // only so the ReasonToast prop contract is satisfied. Hidden in
    // the UI (`showUndo === false` for these actions).
    const id = shiftIdRef.current;
    if (id) ackShiftPrompt(id);
  }, [ackShiftPrompt]);

  const onClose = useCallback(() => {
    const id = shiftIdRef.current;
    const tags = tagsRef.current;
    setToast(null);
    shiftIdRef.current = null;
    tagsRef.current = [];
    if (!id) return;
    if (tags.length > 0) {
      void setShiftTags(id, tags);
    }
    ackShiftPrompt(id);
  }, [setShiftTags, ackShiftPrompt]);

  return { toast, onAddTag, onUndo, onClose };
}
