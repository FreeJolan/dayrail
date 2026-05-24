import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useStore } from '@dayrail/core';
import {
  currentCycleEditSessionRef,
  OFF_RAIL_RAIL_ID,
} from './lib/dndContext';
import {
  DragMirrorProvider,
  useDragMirror,
  type CellMeta,
} from './lib/dragMirror';
import type { SlotTaskSummary } from './data/sampleCycle';
import { TodayTrack } from './pages/TodayTrack';
import { TemplateEditor } from './pages/TemplateEditor';
import { CycleView } from './pages/CycleView';
import { Review } from './pages/Review';
import { Tasks } from './pages/Tasks';
import { Pending } from './pages/Pending';
import { Settings } from './pages/Settings';
import { Calendar } from './pages/Calendar';
import { BacklogDrawer } from './components/BacklogDrawer';
import { StagingDialog, StagingIndicator } from './components/StagingDialog';
import { DevModeIndicator } from './components/DevModeIndicator';
import { ImportSuccessToast } from './components/ImportSuccessToast';
import { ReasonToast } from './components/ReasonToast';
import { SyncConflictPanel } from './components/SyncConflictPanel';
import { DepartureGateModal } from './components/DepartureGateModal';
import { IdentityMismatchModal } from './components/IdentityMismatchModal';
import { ModeRegressionModal } from './components/ModeRegressionModal';
import { ModeUpgradeToast } from './components/ModeUpgradeToast';
import { PendingDepartureBanner } from './components/PendingDepartureBanner';
import { ReconcileBanner } from './components/ReconcileBanner';
import { SyncStatusBanner } from './components/SyncStatusBanner';
import {
  checkModeRegressionAtBoot,
  runReconcileAtBoot,
} from './lib/sync/syncController';
import { SideNav } from './components/SideNav';
import { ShortcutCheatsheet } from './components/ShortcutCheatsheet';
import { UpdateBanner } from './components/UpdateBanner';
import { useShiftPrompt } from './components/useShiftPrompt';
import { TooltipProvider } from './components/primitives/Tooltip';
import {
  useCheatsheetToggle,
  useGlobalShortcuts,
} from './lib/keyboardShortcuts';
import { WebVersionUpdateProvider } from './lib/swRegistration';
import { DesktopVersionUpdateProvider } from './lib/desktopUpdate';
import { isTauriRuntime } from './lib/versionUpdateContext';

// ERD §15 — pick the version-update provider based on runtime context.
// PWA users get the Service Worker-based one; Tauri desktop users get
// the tauri-plugin-updater-based one. Both populate the same
// `VersionUpdateContext`, so consumers (`useVersionUpdate()` /
// `useUpgradeFlow()` / the update banner) work identically.
const VersionUpdateProvider = isTauriRuntime()
  ? DesktopVersionUpdateProvider
  : WebVersionUpdateProvider;

// ERD §5.0 App Shell · v0.2 routing (react-router-dom v6). URL scheme
// locked in `docs/v0.2-plan.md §3`:
//   /                       → Today Track
//   /cycle                  → Cycle View (anchored to current week)
//   /tasks                  → redirects to /tasks/inbox
//   /tasks/inbox
//   /tasks/line/:lineId
//   /tasks/archived
//   /tasks/trash
//   /review
//   /pending
//   /calendar
//   /templates              → redirects to /templates/workday
//   /templates/:templateKey
//   /settings               → redirects to /settings/appearance
//   /settings/:section      → section ∈ appearance / sync / ai / advanced / about
//
// Filters / search / Cycle anchorDate are deliberately not in the URL —
// see ERD change-log 2026-04-18 for the rationale.

export default function App() {
  return (
    <BrowserRouter>
      <VersionUpdateProvider>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          <DragMirrorProvider>
            <Shell />
          </DragMirrorProvider>
        </TooltipProvider>
      </VersionUpdateProvider>
    </BrowserRouter>
  );
}

// Lightweight drag preview rendered inside <DragOverlay>. dnd-kit
// doesn't move the source element under the pointer — it stays in
// place (we mark it `isDragging` for the opacity dim). The overlay
// is the visual the user actually sees following their cursor.
//
// We resolve the task from the store on demand so the preview stays
// in sync with title edits / state changes during a drag (rare but
// cheap). Subscribe to the raw `tasks` map and pick the one we need
// via useMemo — per the project's Zustand selector rule.
// Drag overlay preview. ERD §10.6 v0.11 — `id` may be either a Task
// id (legacy backlog row, cycle pill of a non-managed task) OR a
// TaskOccurrence id (occurrence-managed cycle pill, occurrence
// sub-row in Backlog). Resolve in that order so the dragged ghost is
// always visible regardless of source.
function TaskDragPreview({ taskId: id }: { taskId: string }) {
  const tasksMap = useStore((s) => s.tasks);
  const occurrencesMap = useStore((s) => s.taskOccurrences);
  const { label, title } = useMemo(() => {
    const occ = occurrencesMap[id];
    if (occ) {
      const parent = tasksMap[occ.taskId];
      return {
        label: occ.label?.trim() || parent?.title || '未命名任务',
        title: parent?.title ?? '',
      };
    }
    const task = tasksMap[id];
    if (task) return { label: task.title || '未命名任务', title: '' };
    return { label: null as string | null, title: '' };
  }, [tasksMap, occurrencesMap, id]);
  if (label == null) return null;
  return (
    <div className="pointer-events-none max-w-[240px] rounded-sm bg-surface-1 px-2 py-1.5 text-xs leading-snug text-ink-primary shadow-lg ring-1 ring-black/10">
      <div>{label}</div>
      {title && title !== label && (
        <div className="truncate text-2xs text-ink-tertiary">{title}</div>
      )}
    </div>
  );
}

// Split out so the shortcut hooks live inside <BrowserRouter> (they
// call `useNavigate`).
function Shell() {
  const cheatsheet = useCheatsheetToggle();
  const backlog = useBacklogDrawerState();
  const [stagingOpen, setStagingOpen] = useState(false);
  useGlobalShortcuts(cheatsheet.show, backlog.toggle, () => setStagingOpen((o) => !o));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const { mirror, setMirror } = useDragMirror();

  // Boot-time mode regression check (ERD §7.10.6 · v0.12 P3). Fires
  // once per page load · cache is hydrated by the time Shell mounts
  // because boot.ts awaits loadSyncMetaCache before rendering App.
  useEffect(() => {
    checkModeRegressionAtBoot();
    // ERD §7.10.4 · v0.12 P4 · also kick off the heartbeat reconcile.
    // Fire-and-forget; the ReconcileBanner reads syncStore.bootReconcile.
    void runReconcileAtBoot();
  }, []);
  // Global overdue-shift Reason toast (§5.5.6). Mounted at the shell
  // level so every schedule surface (CycleCell drag, SchedulePopover,
  // TaskDetailDrawer, BacklogDrawer, Tasks-page reschedules) gets the
  // toast without each having to mount its own. Handles both
  // `type='reschedule'` and `type='unschedule'` shifts.
  const shiftPrompt = useShiftPrompt();

  // App-level DndContext (dnd-kit migration). Wraps both CycleView
  // (cells as drop targets + their pills as sortables) AND
  // BacklogDrawer (pills as drag sources) so cross-surface drags
  // share one gesture system. PointerSensor with a 4px activation
  // distance keeps plain clicks (e.g. open-task-detail) from being
  // misread as drag starts.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Hybrid collision detection.
  //
  // 1. pointer-within first — when the cursor is directly on a pill,
  //    that's our most precise signal (lets us pick up the insertion
  //    index for sortable reorder).
  // 2. When pointer-within returns BOTH a cell-droppable (the td) and
  //    a pill (the sortable inside), pick the pill. Without this filter
  //    dnd-kit picks the first registered droppable, which is the td —
  //    drag-end then enters the cell branch and we lose the per-pill
  //    insertion index (cross-cell drops always landed at end).
  // 3. Fall back to rect-intersection when nothing's directly under the
  //    cursor (covers drops on cell padding / between pills).
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const pills = pointer.filter((c) => {
        const data =
          ((c.data as { droppableContainer?: { data?: { current?: unknown } } })
            ?.droppableContainer?.data?.current ?? {}) as Record<string, unknown>;
        return data.type === 'task';
      });
      return pills.length > 0 ? pills : pointer;
    }
    return rectIntersection(args);
  }, []);

  // Helper · derive (overCellKey, overIndex, overMeta, overSlotTaskIds)
  // from an over.data payload. Returns null when over isn't something
  // we know how to handle (e.g. a non-cell droppable elsewhere). Shared
  // between handleDragOver and handleDragEnd so the source-of-truth for
  // "which cell does this over belong to" lives in one place.
  const resolveOver = useCallback(
    (overData: Record<string, unknown>) => {
      if (overData.type === 'cell') {
        return {
          cellKey: String(overData.cellKey),
          meta: {
            cycleId: String(overData.cycleId),
            date: String(overData.date),
            railId: String(overData.railId),
          } as CellMeta,
          slotTaskIds:
            (overData.slotTaskIds as string[] | undefined) ?? null,
          index: null as number | null,
        };
      }
      if (overData.type === 'task' && overData.source === 'cell') {
        return {
          cellKey: String(overData.cellKey),
          meta: {
            cycleId: String(overData.cycleId),
            date: String(overData.date),
            railId: String(overData.railId),
          } as CellMeta,
          slotTaskIds:
            (overData.slotTaskIds as string[] | undefined) ?? null,
          index: (overData.index as number | undefined) ?? null,
        };
      }
      return null;
    },
    [],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = (event.active.data.current ?? {}) as Record<string, unknown>;
      if (data.type !== 'task') return;
      const id = String(event.active.id);
      setActiveTaskId(id);

      // Seed the multi-container mirror. For cell sources we know the
      // source cell's full taskId list (carried in drag data); for
      // backlog sources we don't yet have a cell — handleDragOver will
      // populate the first one we cross into.
      const summary = data.summary as SlotTaskSummary | undefined;
      if (!summary) {
        setMirror(null);
        return;
      }
      const orders: Record<string, string[]> = {};
      const cellMeta: Record<string, CellMeta> = {};
      let activeCellKey: string | null = null;
      if (data.source === 'cell' && typeof data.cellKey === 'string') {
        const cellKey = data.cellKey;
        const slotTaskIds =
          (data.slotTaskIds as string[] | undefined) ?? [];
        orders[cellKey] = [...slotTaskIds];
        cellMeta[cellKey] = {
          cycleId: String(data.cycleId),
          date: String(data.date),
          railId: String(data.railId),
        };
        activeCellKey = cellKey;
      }
      setMirror({
        activeId: id,
        activeCellKey,
        orders,
        taskData: { [id]: summary },
        cellMeta,
      });
    },
    [setMirror],
  );

  // Cross-container move only. Following dnd-kit's official
  // multipleContainers pattern: handleDragOver moves the active
  // between containers (so each container's items prop re-flects
  // its current logical state), while intra-container visual
  // reorder is left to the SortableContext's strategy (it applies
  // CSS transforms based on active/over indices). Doing intra-
  // container moves here too would oscillate — every mutation re-
  // renders the cell, which can shift what's under the cursor,
  // which fires dragOver again.
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeData = (active.data.current ?? {}) as Record<string, unknown>;
      if (activeData.type !== 'task') return;
      const activeId = String(active.id);
      const overData = (over.data.current ?? {}) as Record<string, unknown>;
      const resolved = resolveOver(overData);
      if (!resolved) return;

      setMirror((prev) => {
        if (!prev) return prev;
        const { cellKey: overCellKey, meta, slotTaskIds, index } = resolved;
        // Intra-container: defer to sortable strategy
        if (prev.activeCellKey === overCellKey) return prev;

        const newOrders = { ...prev.orders };
        if (prev.activeCellKey) {
          newOrders[prev.activeCellKey] = (
            newOrders[prev.activeCellKey] ?? []
          ).filter((id) => id !== activeId);
        }
        if (!newOrders[overCellKey]) {
          newOrders[overCellKey] = slotTaskIds ? [...slotTaskIds] : [];
        }
        const withoutActive = newOrders[overCellKey].filter(
          (id) => id !== activeId,
        );
        const insertAt =
          index === null
            ? withoutActive.length
            : Math.max(0, Math.min(index, withoutActive.length));
        newOrders[overCellKey] = [
          ...withoutActive.slice(0, insertAt),
          activeId,
          ...withoutActive.slice(insertAt),
        ];
        return {
          ...prev,
          orders: newOrders,
          cellMeta: { ...prev.cellMeta, [overCellKey]: meta },
          activeCellKey: overCellKey,
        };
      });
    },
    [resolveOver, setMirror],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTaskId(null);
    setMirror(null);
  }, [setMirror]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTaskId(null);
      const finalMirror = mirror;
      setMirror(null);

      const { active, over } = event;
      if (!over || !finalMirror || !finalMirror.activeCellKey) return;
      const activeData = (active.data.current ?? {}) as Record<string, unknown>;
      if (activeData.type !== 'task') return;

      // Destination cell came from mirror (set by the last cross-
      // container move in handleDragOver). For the final intra-cell
      // index, read over.data — handleDragOver doesn't track intra-
      // cell shuffles, so the mirror's order for the destination is
      // a "stale" snapshot from the moment active entered it.
      const finalKey = finalMirror.activeCellKey;
      const finalMeta = finalMirror.cellMeta[finalKey];
      if (!finalMeta) return;
      // The off-rail row's pills are sortable (so they register as
      // droppables) but the row is NOT a real schedule destination —
      // its `railId` is the synthetic OFF_RAIL_RAIL_ID. If the drag
      // ends there (e.g. an off-rail pill dropped back onto itself or a
      // sibling), bail without writing: scheduleTaskTo* would otherwise
      // persist `railId: '__offrail__'` onto the slot, destroying the
      // task's real rail association (and it stays masked because the
      // task keeps bucketing off-rail). Clearing the mirror above
      // already reverted the visual. See the off-rail comment in
      // CycleSection / the OFF_RAIL_RAIL_ID definition.
      if (finalMeta.railId === OFF_RAIL_RAIL_ID) return;
      const taskId = String(active.id);
      const overData = (over.data.current ?? {}) as Record<string, unknown>;
      const overResolved = resolveOver(overData);
      const baseOrder = finalMirror.orders[finalKey] ?? [];
      const withoutActive = baseOrder.filter((id) => id !== taskId);
      let finalOrder: string[];
      if (
        overResolved &&
        overResolved.cellKey === finalKey &&
        overResolved.index !== null
      ) {
        const clamped = Math.max(
          0,
          Math.min(overResolved.index, withoutActive.length),
        );
        finalOrder = [
          ...withoutActive.slice(0, clamped),
          taskId,
          ...withoutActive.slice(clamped),
        ];
      } else {
        // Drop on cell padding or otherwise → keep mirror's order
        finalOrder = baseOrder;
      }

      const store = useStore.getState();
      const sessionId = currentCycleEditSessionRef.current ?? undefined;

      // ERD §10.6 v0.11 — when the dragged pill represents a
      // TaskOccurrence (id matches an entry in taskOccurrences), route
      // to scheduleTaskOccurrence instead of scheduleTaskToRail. Per-
      // slot reorder via setSlotTaskOrder doesn't apply to occurrences
      // in v0.11 (occurrence.order is task-relative, not slot-relative)
      // and is skipped on this branch — visual ordering follows the
      // occurrence.order set in the Task detail drawer.
      const occ = store.taskOccurrences[taskId];
      if (occ) {
        const existingOccSlot = occ.slot;
        const sameOccSlot =
          !!existingOccSlot &&
          existingOccSlot.date === finalMeta.date &&
          existingOccSlot.railId === finalMeta.railId;
        if (!sameOccSlot) {
          void store.scheduleTaskOccurrence(occ.id, finalMeta, sessionId);
        }
        return;
      }

      const existing = store.tasks[taskId]?.slot;
      const sameSlot =
        !!existing &&
        existing.date === finalMeta.date &&
        existing.railId === finalMeta.railId;

      void (async () => {
        if (!sameSlot) {
          await store.scheduleTaskToRail(taskId, finalMeta, sessionId);
        }
        await store.setSlotTaskOrder(finalMeta, finalOrder, sessionId);
      })();
    },
    [mirror, setMirror, resolveOver],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
    <div className="flex min-h-screen w-full bg-surface-0">
      <DevModeIndicator />
      <UpdateBanner />
      <SideNav />
      <main className="min-w-0 flex-1">
        <PendingDepartureBanner />
        <ModeUpgradeToast />
        <ReconcileBanner />
        <SyncStatusBanner />
        <Routes>
          <Route path="/" element={<TodayTrack />} />
          <Route path="/cycle" element={<CycleView />} />
          <Route path="/tasks" element={<Navigate to="/tasks/inbox" replace />} />
          <Route path="/tasks/inbox" element={<Tasks />} />
          <Route path="/tasks/line/:lineId" element={<Tasks />} />
          <Route path="/tasks/archived" element={<Tasks />} />
          <Route path="/tasks/trash" element={<Tasks />} />
          <Route path="/review" element={<Review />} />
          <Route path="/review/:scope" element={<Review />} />
          <Route path="/review/:scope/:anchor" element={<Review />} />
          <Route path="/pending" element={<Pending />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/templates" element={<TemplateEditor />} />
          <Route path="/templates/:templateKey" element={<TemplateEditor />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:section" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BacklogDrawer open={backlog.open} onToggle={backlog.toggle} />
      <StagingDialog open={stagingOpen} onClose={() => setStagingOpen(false)} />
      <StagingIndicator onOpen={() => setStagingOpen(true)} />
      <ShortcutCheatsheet open={cheatsheet.open} onClose={cheatsheet.hide} />
      <ReasonToast
        state={shiftPrompt.toast}
        onAddTag={shiftPrompt.onAddTag}
        onUndo={shiftPrompt.onUndo}
        onClose={shiftPrompt.onClose}
      />
      <ImportSuccessToast />
      <SyncConflictPanel />
      <IdentityMismatchModal />
      <ModeRegressionModal />
      <DepartureGateModal />
    </div>
    <DragOverlay dropAnimation={null}>
      {activeTaskId ? <TaskDragPreview taskId={activeTaskId} /> : null}
    </DragOverlay>
    </DndContext>
  );
}

const BACKLOG_OPEN_KEY = 'dayrail.backlog.open';

function useBacklogDrawerState(): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    // Default CLOSED — the drawer is right-docked and takes 320px when
    // open; collapsed edge is always visible for discoverability.
    return window.localStorage.getItem(BACKLOG_OPEN_KEY) === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BACKLOG_OPEN_KEY, open ? '1' : '0');
  }, [open]);
  return { open, toggle: () => setOpen((v) => !v) };
}

