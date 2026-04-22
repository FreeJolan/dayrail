import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useStore,
  type ReschedulePayload,
} from '@dayrail/core';
import type { ReasonToastState } from './ReasonToast';
import { topTagsForRail } from './useReasonToast';

// ------------------------------------------------------------------
// Controller for the reschedule Reason toast (ERD §5.5.6). Mirrors
// `useReasonToast`'s shape — same ReasonToastState, same add-tag /
// close callbacks — but:
//   - Subscribes to `pendingReschedulePrompt` instead of firing on a
//     local action. The store auto-records the Shift before the
//     toast shows up, so the tag-picking path goes through
//     `setShiftTags` (append to existing) rather than `recordShift`.
//   - Hides Undo (the schedule mutation is already committed; the
//     inverse gesture is "drag it back", not a toast button). The
//     noop undo still clears the prompt so the toast dismisses.
// ------------------------------------------------------------------

export function useReschedulePrompt(): {
  toast: ReasonToastState | null;
  onAddTag: (tag: string) => void;
  onUndo: () => void;
  onClose: () => void;
} {
  const pending = useStore((s) => s.pendingReschedulePrompt);
  const tasks = useStore((s) => s.tasks);
  const shifts = useStore((s) => s.shifts);
  const setShiftTags = useStore((s) => s.setShiftTags);
  const ackReschedulePrompt = useStore((s) => s.ackReschedulePrompt);

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
    const payload = pending.payload as unknown as ReschedulePayload;
    const task = tasks[pending.taskId];
    const railIdForTags = payload.toRailId ?? payload.fromRailId;
    setToast({
      action: 'reschedule',
      instanceId: pending.id,
      // Use the railName slot to describe the task + destination so
      // the toast copy reads "已改期 · <title> → <toDate>". No
      // dedicated subtitle field on ReasonToastState.
      railName: `${task?.title ?? 'Task'} → ${payload.toDate}`,
      isRecurring: false,
      recommendedTags: railIdForTags
        ? topTagsForRail(railIdForTags, tasks, shifts)
        : [],
    });
  }, [pending, tasks, shifts]);

  const onAddTag = useCallback((tag: string) => {
    if (!tagsRef.current.includes(tag)) {
      tagsRef.current = [...tagsRef.current, tag];
    }
  }, []);

  const onUndo = useCallback(() => {
    // v0.4.1 doesn't support programmatic undo for reschedule —
    // provided only so the ReasonToast prop contract is satisfied.
    // Hidden in the UI (`showUndo === false` for this action).
    const id = shiftIdRef.current;
    if (id) ackReschedulePrompt(id);
  }, [ackReschedulePrompt]);

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
    ackReschedulePrompt(id);
  }, [setShiftTags, ackReschedulePrompt]);

  return { toast, onAddTag, onUndo, onClose };
}
