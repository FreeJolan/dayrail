import { useCallback, useRef, useState } from 'react';
import {
  useStore,
  type RailInstance,
  type RailInstanceStatus,
  type Shift,
  type ShiftType,
  type Signal,
} from '@dayrail/core';
import type {
  ReasonToastState,
  ToastAction,
} from './ReasonToast';

// Shared controller for the §5.2 Reason toast. Both the check-in
// strip on Today Track and the Pending page wire into it so all
// three action surfaces behave identically: status flipped via
// `recordSignal`, optional tags collected in the toast and
// committed as a single Shift record on close, Undo reverts the
// instance back to `pending` (the Signal event stays as audit).
export function useReasonToast(surface: Signal['surface']): {
  toast: ReasonToastState | null;
  fire: (instanceId: string, action: ToastAction) => void;
  handleAddTag: (tag: string) => void;
  handleUndo: () => void;
  handleClose: () => void;
} {
  const rails = useStore((s) => s.rails);
  const railInstances = useStore((s) => s.railInstances);
  const shifts = useStore((s) => s.shifts);
  const recordSignal = useStore((s) => s.recordSignal);
  const recordShift = useStore((s) => s.recordShift);
  const markRailInstance = useStore((s) => s.markRailInstance);

  const [toast, setToast] = useState<ReasonToastState | null>(null);
  // Tags accumulated during this toast session — committed as a single
  // Shift record when the toast closes. Refs (not state) because this
  // data never drives render; only persistence at close time.
  const tagsRef = useRef<string[]>([]);
  const instanceRef = useRef<string | null>(null);
  const actionRef = useRef<ToastAction | null>(null);
  // The pre-action status. Undo restores the instance to this, not
  // to a hardcoded 'pending'. On Pending page this matters: acting on
  // a `deferred` item and then undoing should leave it `deferred`, not
  // demote it to a fresh `pending` that would drop it from the queue.
  const previousStatusRef = useRef<RailInstanceStatus | null>(null);

  const fire = useCallback(
    (instanceId: string, action: ToastAction) => {
      const inst = railInstances[instanceId];
      const rail = inst ? rails[inst.railId] : undefined;
      if (!inst || !rail) return;

      previousStatusRef.current = inst.status;
      void recordSignal(instanceId, action, surface);

      tagsRef.current = [];
      instanceRef.current = instanceId;
      actionRef.current = action;
      setToast({
        action,
        instanceId,
        railName: rail.name,
        // v0.2: every Rail has a recurrence, so archiving always means
        // "only today's instance, template still fires tomorrow".
        isRecurring: true,
        recommendedTags: topTagsForRail(rail.id, railInstances, shifts),
      });
    },
    [rails, railInstances, shifts, recordSignal, surface],
  );

  const handleAddTag = useCallback((tag: string) => {
    if (!tagsRef.current.includes(tag)) {
      tagsRef.current = [...tagsRef.current, tag];
    }
  }, []);

  const handleUndo = useCallback(() => {
    const id = instanceRef.current;
    const prev = previousStatusRef.current;
    if (id && prev) {
      void markRailInstance(id, prev);
    }
    tagsRef.current = [];
    instanceRef.current = null;
    actionRef.current = null;
    previousStatusRef.current = null;
  }, [markRailInstance]);

  const handleClose = useCallback(() => {
    const tags = tagsRef.current;
    const id = instanceRef.current;
    const action = actionRef.current;
    setToast(null);
    tagsRef.current = [];
    instanceRef.current = null;
    actionRef.current = null;
    previousStatusRef.current = null;
    if (!id || !action) return;
    if (action === 'done') return; // done isn't a Shift
    if (tags.length === 0) return;
    const shiftType: ShiftType = action === 'defer' ? 'defer' : 'archive';
    const shift: Shift = {
      id: `shift-${id}-${Date.now().toString(36)}`,
      railInstanceId: id,
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
// the toast (currently unused outside this module; ready for the
// Pending-page "why did I defer this?" preview should it ever want
// live-recomputed rankings).
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
