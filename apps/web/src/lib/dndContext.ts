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
