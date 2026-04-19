import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TodayTrack } from './pages/TodayTrack';
import { TemplateEditor } from './pages/TemplateEditor';
import { CycleView } from './pages/CycleView';
import { Review } from './pages/Review';
import { Tasks } from './pages/Tasks';
import { Pending } from './pages/Pending';
import { Settings } from './pages/Settings';
import { Calendar } from './pages/Calendar';
import { BacklogDrawer } from './components/BacklogDrawer';
import { SideNav } from './components/SideNav';
import { ShortcutCheatsheet } from './components/ShortcutCheatsheet';
import { TooltipProvider } from './components/primitives/Tooltip';
import {
  useCheatsheetToggle,
  useGlobalShortcuts,
} from './lib/keyboardShortcuts';

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
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <Shell />
      </TooltipProvider>
    </BrowserRouter>
  );
}

// Split out so the shortcut hooks live inside <BrowserRouter> (they
// call `useNavigate`).
function Shell() {
  const cheatsheet = useCheatsheetToggle();
  const backlog = useBacklogDrawerState();
  useGlobalShortcuts(cheatsheet.show, backlog.toggle);
  return (
    <div className="flex min-h-screen w-full bg-surface-0">
      <SideNav onToggleBacklog={backlog.toggle} backlogOpen={backlog.open} />
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
    </div>
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
