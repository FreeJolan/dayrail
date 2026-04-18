import { useCallback, useRef, useState } from 'react';
import {
  useStore,
  type Shift,
  type ShiftType,
  type Signal,
  type Task,
} from '@dayrail/core';
import type {
  ReasonToastState,
  ToastAction,
} from './ReasonToast';

// Shared controller for the §5.2 Reason toast. Both the check-in
// strip on Today Track and the Pending page wire into it so all
// three action surfaces behave identically.
//
// v0.4 source-of-truth rule (ERD §10.1): status lives on Task.
// This hook writes `Task.status` + stamps the matching timestamp
// (doneAt / deferredAt / archivedAt), logs a Signal event for audit
// (so the user can trace "I pressed Later at 14:32"), and commits a
// Shift record on close if the user added any tags.
//
// RailInstance is gone — Shift + Signal anchor directly to Task.

type TaskStatus = Task['status'];

export function useReasonToast(surface: Signal['surface']): {
  toast: ReasonToastState | null;
  fire: (opts: {
    taskId: string;
    /** Display label in the toast. Pass the rail name for rail-bound
     *  tasks; task title for unscheduled / ad-hoc tasks. */
    displayName: string;
    /** Optional Rail id, used to compute recommended reason tags
     *  from past Shifts on the same Rail. Omit for unscheduled tasks. */
    railId?: string;
    /** Optional Edit-Session id (§5.3.1). When set, the Task status
     *  write is tagged so the session-level undo rolls it back with
     *  the rest of the batch. Cycle View passes its session here. */
    sessionId?: string;
    action: ToastAction;
  }) => void;
  handleAddTag: (tag: string) => void;
  handleUndo: () => void;
  handleClose: () => void;
} {
  const tasks = useStore((s) => s.tasks);
  const shifts = useStore((s) => s.shifts);
  const recordSignal = useStore((s) => s.recordSignal);
  const recordShift = useStore((s) => s.recordShift);
  const updateTask = useStore((s) => s.updateTask);

  const [toast, setToast] = useState<ReasonToastState | null>(null);
  // Committed-on-close state; refs because they don't drive rendering.
  const tagsRef = useRef<string[]>([]);
  const taskIdRef = useRef<string | null>(null);
  const actionRef = useRef<ToastAction | null>(null);
  // Pre-action task snapshot so Undo restores precisely.
  const prevTaskStatusRef = useRef<TaskStatus | null>(null);

  // Session id used by Undo — captured per-fire so Cycle View can
  // pass its own and Today Track / Tasks leave it empty.
  const sessionIdRef = useRef<string | undefined>(undefined);

  const fire = useCallback(
    ({ taskId, displayName, railId, sessionId, action }: {
      taskId: string;
      displayName: string;
      railId?: string;
      sessionId?: string;
      action: ToastAction;
    }) => {
      const task = tasks[taskId];
      if (!task) return;

      prevTaskStatusRef.current = task.status;
      sessionIdRef.current = sessionId;

      const nextTaskStatus: TaskStatus =
        action === 'done'
          ? 'done'
          : action === 'defer'
            ? 'deferred'
            : 'archived';
      const nowIso = new Date().toISOString();
      const patch: Partial<Task> = { status: nextTaskStatus };
      if (action === 'done') patch.doneAt = nowIso;
      if (action === 'defer') patch.deferredAt = nowIso;
      if (action === 'archive') patch.archivedAt = nowIso;
      void updateTask(taskId, patch, sessionId);

      // Signal event — pure audit. Anchored on Task.
      void recordSignal(taskId, action, surface);

      tagsRef.current = [];
      taskIdRef.current = taskId;
      actionRef.current = action;
      setToast({
        action,
        instanceId: taskId, // the toast still uses `instanceId` as an opaque key
        railName: displayName,
        isRecurring: true,
        recommendedTags: railId ? topTagsForRail(railId, tasks, shifts) : [],
      });
    },
    [tasks, shifts, recordSignal, updateTask, surface],
  );

  const handleAddTag = useCallback((tag: string) => {
    if (!tagsRef.current.includes(tag)) {
      tagsRef.current = [...tagsRef.current, tag];
    }
  }, []);

  const handleUndo = useCallback(() => {
    const tid = taskIdRef.current;
    const prevTaskStatus = prevTaskStatusRef.current;
    const sid = sessionIdRef.current;
    if (tid && prevTaskStatus) {
      // Clear the stamp fields we may have just set so the restored
      // row is a clean revert. Pass the same sessionId so a session-
      // undo batch stays internally consistent.
      void updateTask(
        tid,
        {
          status: prevTaskStatus,
          doneAt: undefined,
          deferredAt: undefined,
          archivedAt: undefined,
        },
        sid,
      );
    }
    tagsRef.current = [];
    taskIdRef.current = null;
    actionRef.current = null;
    prevTaskStatusRef.current = null;
    sessionIdRef.current = undefined;
  }, [updateTask]);

  const handleClose = useCallback(() => {
    const tags = tagsRef.current;
    const tid = taskIdRef.current;
    const action = actionRef.current;
    setToast(null);
    tagsRef.current = [];
    taskIdRef.current = null;
    actionRef.current = null;
    prevTaskStatusRef.current = null;
    sessionIdRef.current = undefined;
    if (!tid || !action) return;
    if (action === 'done') return; // done isn't a Shift
    if (tags.length === 0) return;
    const shiftType: ShiftType = action === 'defer' ? 'defer' : 'archive';
    const shift: Shift = {
      id: `shift-${tid}-${Date.now().toString(36)}`,
      taskId: tid,
      type: shiftType,
      at: new Date().toISOString(),
      payload: {},
      tags,
    };
    void recordShift(shift);
  }, [recordShift]);

  return { toast, fire, handleAddTag, handleUndo, handleClose };
}

/** Top 3 Shift tags ever used on this Rail. v0.4: Shifts anchor to
 *  Tasks, so we join Shift.taskId → Task.slot.railId to find matches.
 *  Consumers that need this without the toast can call it directly. */
export function topTagsForRail(
  railId: string,
  tasks: Record<string, Task>,
  shifts: Record<string, Shift>,
): string[] {
  const counts = new Map<string, number>();
  for (const shift of Object.values(shifts)) {
    const task = tasks[shift.taskId];
    if (!task?.slot || task.slot.railId !== railId) continue;
    for (const tag of shift.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
}

/** Latest Shift tags for a specific Task (for the Today-Track deferred
 *  strip / Pending-page row badge). Returns the most recent Shift's
 *  tags, not an aggregate. */
export function latestTagsForTask(
  taskId: string,
  shifts: Record<string, Shift>,
): string[] {
  let latest: Shift | undefined;
  for (const shift of Object.values(shifts)) {
    if (shift.taskId !== taskId) continue;
    if (!latest || shift.at > latest.at) latest = shift;
  }
  return latest?.tags ?? [];
}
