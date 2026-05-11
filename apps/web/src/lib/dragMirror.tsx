import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import type { SlotTaskSummary } from '@/data/sampleCycle';

// Multi-container sortable mirror.
//
// Why this exists: dnd-kit's `SortableContext` is single-container by
// design — the sort strategy only handles within-container reorder.
// The Cycle view has one SortableContext per cell, so when a pill is
// dragged from cell A to cell B, A's context still thinks the active
// belongs to it (visual gap stays at the source) and B's context has
// no idea the active is heading its way (no insertion preview).
//
// The canonical dnd-kit fix is the "multipleContainers" pattern: keep
// a state object that mirrors the per-cell taskIds, and on dragOver,
// move the active id between containers so each container's items
// prop reflects the active's current logical location. The dragged
// React component re-mounts under the new SortableContext (dnd-kit
// tracks the drag by activeId globally, so the re-mount is safe).
//
// During a drag:
//   - `orders[cellKey]` overrides the cell's taskIds when present
//   - `taskData[taskId]` lets a destination cell render a pill for a
//     task that isn't natively in its slot (cross-cell or backlog
//     source). Source-cell renders look up summaries from their own
//     slot first and fall back to taskData only for foreign ids.
//   - `cellMeta[cellKey]` keeps the (cycleId, date, railId) of cells
//     we've touched so handleDragEnd can commit without re-deriving.
//   - `activeCellKey` points at whichever cell currently "owns" the
//     active in the mirror.

export type CellMeta = {
  cycleId: string;
  date: string;
  railId: string;
};

export type DragMirrorState = {
  activeId: string;
  activeCellKey: string | null;
  orders: Record<string, string[]>;
  taskData: Record<string, SlotTaskSummary>;
  cellMeta: Record<string, CellMeta>;
} | null;

type Ctx = {
  mirror: DragMirrorState;
  setMirror: Dispatch<SetStateAction<DragMirrorState>>;
};

const DragMirrorContext = createContext<Ctx>({
  mirror: null,
  setMirror: () => {},
});

export function DragMirrorProvider({ children }: { children: ReactNode }) {
  const [mirror, setMirror] = useState<DragMirrorState>(null);
  return (
    <DragMirrorContext.Provider value={{ mirror, setMirror }}>
      {children}
    </DragMirrorContext.Provider>
  );
}

export function useDragMirror() {
  return useContext(DragMirrorContext);
}
