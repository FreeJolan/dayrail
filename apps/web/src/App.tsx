import { useState } from 'react';
import { TodayTrack } from './pages/TodayTrack';
import { TemplateEditor } from './pages/TemplateEditor';
import { CycleView } from './pages/CycleView';
import { Review } from './pages/Review';
import { Projects } from './pages/Projects';
import { Pending } from './pages/Pending';
import { Settings } from './pages/Settings';
import { SideNav, type NavKey } from './components/SideNav';

// Simple state-based routing for the static-mock phase. When we add
// real persistence + proper routing, swap this for `react-router` or
// the App Router equivalent — but for now a single `useState` is
// smaller than a dependency.

export default function App() {
  const [page, setPage] = useState<NavKey>('today');

  return (
    <div className="flex min-h-screen w-full bg-surface-0">
      <SideNav active={page} onNavigate={setPage} />
      <main className="flex-1">
        {page === 'today' && <TodayTrack />}
        {page === 'template' && <TemplateEditor />}
        {page === 'cycle' && <CycleView />}
        {page === 'review' && <Review />}
        {page === 'projects' && <Projects />}
        {page === 'pending' && <Pending />}
        {page === 'settings' && <Settings />}
        {page !== 'today' &&
          page !== 'template' &&
          page !== 'cycle' &&
          page !== 'review' &&
          page !== 'projects' &&
          page !== 'pending' &&
          page !== 'settings' && <ComingSoon page={page} />}
      </main>
    </div>
  );
}

function ComingSoon({ page }: { page: NavKey }) {
  return (
    <div className="flex w-full items-center pl-14 pt-24">
      <div className="max-w-md">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Next milestone
        </span>
        <h2 className="mt-2 font-mono text-2xl tabular-nums text-ink-primary">
          {labelFor(page)}
        </h2>
        <p className="mt-3 text-sm text-ink-secondary">
          未实装。先把 Today 与 Template Editor 两屏打磨到位，再按 ERD §5.2/§5.3/§5.5/§5.7/§5.8/§5.9 的顺序补齐。
        </p>
      </div>
    </div>
  );
}

function labelFor(page: NavKey): string {
  switch (page) {
    case 'today':
      return 'Today Track';
    case 'template':
      return 'Template Editor';
    case 'cycle':
      return 'Cycle View (§5.3)';
    case 'projects':
      return 'Projects / Lines (§5.5)';
    case 'review':
      return 'Review (§5.8)';
    case 'calendar':
      return 'Calendar (§5.4 Calendar)';
    case 'pending':
      return 'Pending queue (§5.7)';
    case 'settings':
      return 'Settings (§5.9)';
  }
}
