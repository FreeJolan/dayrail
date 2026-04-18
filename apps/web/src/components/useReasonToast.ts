import { useCallback, useRef, useState } from 'react';
import {
  useStore,
  type RailInstance,
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
// v0.4 source-of-truth rule (ERD §10.1): status lives on Task. This
// hook writes `Task.status` as the primary effect; RailInstance.status
// gets a dual-write for parity with legacy surfaces that still read
// it, and a Signal event is recorded for audit. A Shift record lands
// on close if the user added any tags.
//
// The Undo path restores Task.status AND RailInstance.status to the
// pre-action values so both halves of the dual-write unwind together.

type TaskStatus = Task['status'];

export function useReasonToast(surface: Signal['surface']): {
  toast: ReasonToastState | null;
  fire: (opts: {
    taskId: string;
    railInstanceId?: string;
    railName: string;
    railId: string;
    action: ToastAction;
  }) => void;
  handleAddTag: (tag: string) => void;
  handleUndo: () => void;
  handleClose: () => void;
} {
  const railInstances = useStore((s) => s.railInstances);
  const tasks = useStore((s) => s.tasks);
  const shifts = useStore((s) => s.shifts);
  const recordSignal = useStore((s) => s.recordSignal);
  const recordShift = useStore((s) => s.recordShift);
  const markRailInstance = useStore((s) => s.markRailInstance);
  const updateTask = useStore((s) => s.updateTask);

  const [toast, setToast] = useState<ReasonToastState | null>(null);
  // Committed-on-close state; refs because they don't drive rendering.
  const tagsRef = useRef<string[]>([]);
  const taskIdRef = useRef<string | null>(null);
  const instanceIdRef = useRef<string | null>(null);
  const actionRef = useRef<ToastAction | null>(null);
  // Pre-action snapshots so Undo restores precisely (not a hardcoded
  // 'pending'). Matters on Pending page: acting on a `deferred` item
  // and undoing should go back to `deferred`, not demote to `pending`.
  const prevTaskStatusRef = useRef<TaskStatus | null>(null);
  const prevInstanceStatusRef = useRef<RailInstance['status'] | null>(null);

  const fire = useCallback(
    ({ taskId, railInstanceId, railName, railId, action }: {
      taskId: string;
      railInstanceId?: string;
      railName: string;
      railId: string;
      action: ToastAction;
    }) => {
      const task = tasks[taskId];
      if (!task) return;

      prevTaskStatusRef.current = task.status;

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
      void updateTask(taskId, patch);

      // Dual-write to RailInstance.status (deprecated, cleaned up in
      // v0.5) + record the Signal event for audit.
      if (railInstanceId) {
        const inst = railInstances[railInstanceId];
        prevInstanceStatusRef.current = inst?.status ?? null;
        void recordSignal(railInstanceId, action, surface);
      }

      tagsRef.current = [];
      taskIdRef.current = taskId;
      instanceIdRef.current = railInstanceId ?? null;
      actionRef.current = action;
      setToast({
        action,
        instanceId: railInstanceId ?? taskId,
        railName,
        isRecurring: true,
        recommendedTags: railInstanceId
          ? topTagsForRail(railId, railInstances, shifts)
          : [],
      });
    },
    [tasks, railInstances, shifts, recordSignal, updateTask, surface],
  );

  const handleAddTag = useCallback((tag: string) => {
    if (!tagsRef.current.includes(tag)) {
      tagsRef.current = [...tagsRef.current, tag];
    }
  }, []);

  const handleUndo = useCallback(() => {
    const tid = taskIdRef.current;
    const prevTaskStatus = prevTaskStatusRef.current;
    if (tid && prevTaskStatus) {
      const patch: Partial<Task> = { status: prevTaskStatus };
      // Clear the stamps we may have just set so the restored row is
      // a clean revert (no orphan doneAt/deferredAt/archivedAt).
      patch.doneAt = undefined;
      patch.deferredAt = undefined;
      patch.archivedAt = undefined;
      void updateTask(tid, patch);
    }
    const iid = instanceIdRef.current;
    const prevInstanceStatus = prevInstanceStatusRef.current;
    if (iid && prevInstanceStatus) {
      void markRailInstance(iid, prevInstanceStatus);
    }
    tagsRef.current = [];
    taskIdRef.current = null;
    instanceIdRef.current = null;
    actionRef.current = null;
    prevTaskStatusRef.current = null;
    prevInstanceStatusRef.current = null;
  }, [markRailInstance, updateTask]);

  const handleClose = useCallback(() => {
    const tags = tagsRef.current;
    const iid = instanceIdRef.current;
    const action = actionRef.current;
    setToast(null);
    tagsRef.current = [];
    taskIdRef.current = null;
    instanceIdRef.current = null;
    actionRef.current = null;
    prevTaskStatusRef.current = null;
    prevInstanceStatusRef.current = null;
    if (!iid || !action) return;
    if (action === 'done') return; // done isn't a Shift
    if (tags.length === 0) return;
    const shiftType: ShiftType = action === 'defer' ? 'defer' : 'archive';
    const shift: Shift = {
      id: `shift-${iid}-${Date.now().toString(36)}`,
      railInstanceId: iid,
      type: shiftType,
      at: new Date().toISOString(),
      payload: {},
      tags,
    };
    void recordShift(shift);
  }, [recordShift]);

  return { toast, fire, handleAddTag, handleUndo, handleClose };
}

// Exposed for callers that need the same ranking without going through
// the toast.
export function topTagsForRail(
  railId: string,
  railInstances: Record<string, RailInstance>,
  shifts: Record<string, Shift>,
): string[] {
  const counts = new Map<string, number>();
  for (const shift of Object.values(shifts)) {
    const inst = railInstances[shift.railInstanceId];
    if (!inst || inst.railId !== railId) continue;
    for (const tag of shift.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
}
