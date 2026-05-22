// Cross-component refs for the dnd-kit migration.
//
// Why a plain ref object instead of Zustand / React Context: drag-end
// dispatch happens in App.tsx (because BacklogDrawer pills live there
// and must be inside the same DndContext as CycleView cells). But the
// edit-session ID needed to tag those mutations lives inside the
// CycleView component's local state, which opens a 'cycle-planner'
// session on mount. Reading it from App needs a stable channel that
// doesn't cause re-renders (the drag handler reads imperatively).
//
// CycleView writes its sessionId here on every change; the
// handleDragEnd in App reads `.current` at drop time. When CycleView
// unmounts (user navigates away), it clears the ref.

export const currentCycleEditSessionRef: { current: string | null } = {
  current: null,
};

// Synthetic railId for the Cycle View "off-rail" row — tasks whose
// stored slot.railId isn't an active rail on that date get bucketed
// here for display (see cycleFromStore `offRailByDate`). It is a
// RENDER-ONLY value: it must NEVER be persisted to a Task/Occurrence
// slot. The off-rail row carries it on its pills' drag data, so
// `handleDragEnd` guards against it being used as a drop destination
// (dropping an off-rail pill back onto the off-rail row would
// otherwise overwrite the task's real railId with this synthetic id —
// silent data loss, since the task keeps rendering off-rail). Defined
// here so the producer (CycleSection) and the guard (App) share one
// source of truth and can't drift.
export const OFF_RAIL_RAIL_ID = '__offrail__';
