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

// `useReasonToast` covers the defer/archive/done flows — the
// overdue-shift actions (reschedule / unschedule) are owned by
// `useShiftPrompt`. Narrow the hook's action type to that subset so
// callers can't accidentally ask this hook to fire one of those
// (which it doesn't know how to handle).
type CheckInAction = Exclude<ToastAction, 'reschedule' | 'unschedule'>;

type ReasonAction = {
  taskId: string;
  displayName: string;
  /** Used to compute recommended reason tags from past Shifts. */
  railId?: string;
  /** Keeps the write and its undo in the caller's Edit Session. */
  sessionId?: string;
  /** ERD §10.6 — set when the row represents a TaskOccurrence. The
   *  status write (and its undo) then lands on the occurrence, never
   *  on the parent Task. `defer` with an occurrenceId performs NO
   *  status write at all (occurrences carry no deferred state); the
   *  toast still surfaces so the reason tag can be captured against
   *  the parent Task. */
  occurrenceId?: string;
  action: 'defer' | 'done' | 'archive';
};

const TASK_ACTIONS = {
  done: { status: 'done', timestamp: 'doneAt' },
  defer: { status: 'deferred', timestamp: 'deferredAt' },
  archive: { status: 'archived', timestamp: 'archivedAt' },
} as const;

// Status belongs to the row's Task or TaskOccurrence (ERD §10.6).
// Signal and reason tags are still recorded against the parent Task.
export function useReasonToast(surface: Signal['surface']): {
  toast: ReasonToastState | null;
  fire: (opts: ReasonAction) => void;
  handleAddTag: (tag: string) => void;
  handleUndo: () => void;
  handleClose: () => void;
} {
  const recordShift = useStore((s) => s.recordShift);

  const [toast, setToast] = useState<ReasonToastState | null>(null);
  // Committed-on-close state; refs because they don't drive rendering.
  const tagsRef = useRef<string[]>([]);
  const taskIdRef = useRef<string | null>(null);
  const actionRef = useRef<CheckInAction | null>(null);
  const undoRef = useRef<(() => void) | null>(null);

  const fire = useCallback(
    ({ taskId, occurrenceId, displayName, railId, sessionId, action }: ReasonAction) => {
      const store = useStore.getState();
      const { tasks, shifts } = store;
      const task = tasks[taskId];
      if (!task) return;

      if (occurrenceId !== undefined) {
        const occurrence = store.taskOccurrences[occurrenceId];
        if (
          task.status === 'deleted' ||
          occurrence?.taskId !== taskId ||
          occurrence.status !== 'pending'
        ) {
          return;
        }
        if (action === 'defer') {
          // ERD §10.6 — no occurrence-level deferred state exists. This
          // is a true noop on both layers (writing the PARENT task's
          // status here was the old bug: the row never changed while
          // the task was silently marked deferred). Toast still fires
          // so the user's reason tag lands via recordShift on close.
          undoRef.current = null;
        } else {
          const timestamp = action === 'done' ? 'doneAt' : 'archivedAt';
          const write =
            action === 'done' ? store.completeTaskOccurrence : store.archiveTaskOccurrence;
          void write(occurrenceId, sessionId);
          undoRef.current = () => {
            void store.updateTaskOccurrence(
              occurrenceId,
              { status: occurrence.status, [timestamp]: occurrence[timestamp] },
              sessionId,
            );
          };
        }
      } else if (action === 'archive') {
        // §10.6 D7 — archiving a whole Task must go through
        // store.archiveTask so pending occurrences cascade with it.
        // The plain updateTask path this used to take left every
        // pending split surfacing in Today/Cycle/Pending/Backlog
        // (deriveTaskStatus keeps rolling the task up to 'pending').
        // Capture the pre-cascade pending set so undo restores both
        // the task and its cascaded occurrences.
        const pendingOccs = Object.values(store.taskOccurrences).filter(
          (o) => o.taskId === taskId && o.status === 'pending',
        );
        void store.archiveTask(taskId, sessionId);
        undoRef.current = () => {
          void store.updateTask(
            taskId,
            { status: task.status, archivedAt: task.archivedAt },
            sessionId,
          );
          for (const o of pendingOccs) {
            void store.updateTaskOccurrence(
              o.id,
              { status: 'pending', archivedAt: undefined },
              sessionId,
            );
          }
        };
      } else {
        const { status, timestamp } = TASK_ACTIONS[action];
        void store.updateTask(
          taskId,
          { status, [timestamp]: new Date().toISOString() },
          sessionId,
        );
        undoRef.current = () => {
          void store.updateTask(
            taskId,
            { status: task.status, [timestamp]: task[timestamp] },
            sessionId,
          );
        };
      }

      // Signal event — pure audit. Anchored on Task.
      void store.recordSignal(taskId, action, surface);

      tagsRef.current = [];
      taskIdRef.current = taskId;
      actionRef.current = action;
      setToast({
        action,
        instanceId: occurrenceId ?? taskId,
        railName: displayName,
        isRecurring: occurrenceId === undefined,
        recommendedTags: railId ? topTagsForRail(railId, tasks, shifts) : [],
      });
    },
    [surface],
  );

  const handleAddTag = useCallback((tag: string) => {
    if (!tagsRef.current.includes(tag)) {
      tagsRef.current = [...tagsRef.current, tag];
    }
  }, []);

  const handleUndo = useCallback(() => {
    undoRef.current?.();
    tagsRef.current = [];
    taskIdRef.current = null;
    actionRef.current = null;
    undoRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    const tags = tagsRef.current;
    const tid = taskIdRef.current;
    const action = actionRef.current;
    setToast(null);
    tagsRef.current = [];
    taskIdRef.current = null;
    actionRef.current = null;
    undoRef.current = null;
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
