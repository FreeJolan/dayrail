import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useStore } from '@dayrail/core';
import { currentCycleEditSessionRef } from './lib/dndContext';
import { TodayTrack } from './pages/TodayTrack';
import { TemplateEditor } from './pages/TemplateEditor';
import { CycleView } from './pages/CycleView';
import { Review } from './pages/Review';
import { Tasks } from './pages/Tasks';
import { Pending } from './pages/Pending';
import { Settings } from './pages/Settings';
import { Calendar } from './pages/Calendar';
import { BacklogDrawer } from './components/BacklogDrawer';
import { DevModeIndicator } from './components/DevModeIndicator';
import { ImportSuccessToast } from './components/ImportSuccessToast';
import { ReasonToast } from './components/ReasonToast';
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
          <Shell />
        </TooltipProvider>
      </VersionUpdateProvider>
    </BrowserRouter>
  );
}

// Split out so the shortcut hooks live inside <BrowserRouter> (they
// call `useNavigate`).
function Shell() {
  const cheatsheet = useCheatsheetToggle();
  const backlog = useBacklogDrawerState();
  useGlobalShortcuts(cheatsheet.show, backlog.toggle);
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

  // Hybrid collision detection: pointer-within finds pills the
  // cursor is directly on (best for intra-slot reorder); rect-
  // intersection catches cell drops on the wider drop zone. Trying
  // pointer first and falling through covers both cases.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = (active.data.current ?? {}) as Record<string, unknown>;
    const overData = (over.data.current ?? {}) as Record<string, unknown>;
    if (activeData.type !== 'task') return;

    const taskId = String(active.id);
    const store = useStore.getState();
    const sessionId = currentCycleEditSessionRef.current ?? undefined;

    // Compute target cell from over.data. Two shapes:
    //   - over is a cell-droppable → { type: 'cell', cycleId, date, railId }
    //   - over is a sortable pill in a cell → { type: 'pill', cellKey, cycleId, date, railId, index, slotTaskIds }
    let target: { cycleId: string; date: string; railId: string } | null = null;
    let targetIndex: number | null = null;
    let slotTaskIds: string[] | null = null;
    if (overData.type === 'cell') {
      target = {
        cycleId: String(overData.cycleId),
        date: String(overData.date),
        railId: String(overData.railId),
      };
    } else if (overData.type === 'pill') {
      target = {
        cycleId: String(overData.cycleId),
        date: String(overData.date),
        railId: String(overData.railId),
      };
      targetIndex = (overData.index as number) ?? null;
      slotTaskIds = (overData.slotTaskIds as string[] | undefined) ?? null;
    }
    if (!target) return;

    const existing = store.tasks[taskId]?.slot;
    const sameSlot =
      !!existing &&
      existing.date === target.date &&
      existing.railId === target.railId;

    void (async () => {
      // Cross-slot move: schedule the task to the new (cycleId, date,
      // railId) first so its `slot` reflects the destination before we
      // touch slotOrder.
      if (!sameSlot) {
        await store.scheduleTaskToRail(taskId, target, sessionId);
      }
      // If the drop landed on a specific pill (intra-slot reorder or
      // cross-slot drop at a precise position), persist the new
      // ordered list. setSlotTaskOrder is idempotent — calling it with
      // the same order as currently stored is a no-op event.
      if (targetIndex !== null && slotTaskIds !== null) {
        const without = slotTaskIds.filter((id) => id !== taskId);
        const clamped = Math.max(0, Math.min(targetIndex, without.length));
        const ordered = [
          ...without.slice(0, clamped),
          taskId,
          ...without.slice(clamped),
        ];
        await store.setSlotTaskOrder(target, ordered, sessionId);
      }
    })();
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragEnd={handleDragEnd}
    >
    <div className="flex min-h-screen w-full bg-surface-0">
      <DevModeIndicator />
      <UpdateBanner />
      <SideNav />
      <main className="min-w-0 flex-1">
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
      <ShortcutCheatsheet open={cheatsheet.open} onClose={cheatsheet.hide} />
      <ReasonToast
        state={shiftPrompt.toast}
        onAddTag={shiftPrompt.onAddTag}
        onUndo={shiftPrompt.onUndo}
        onClose={shiftPrompt.onClose}
      />
      <ImportSuccessToast />
    </div>
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
