import {
  Calendar,
  ClipboardList,
  FileText,
  Inbox,
  Layers,
  LineChart,
  Settings,
  Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';
import { CHECKIN_QUEUE } from '@/data/sample';

// Left sticky rail nav (ERD decision A/D/F: left sidebar, not top tabs).
// Collapsed variant (icon-only) for desktop ≥ 1024px. On narrow screens
// this page defaults to single-column push nav (F5), not implemented yet.

export type NavKey =
  | 'today'
  | 'cycle'
  | 'template'
  | 'projects'
  | 'review'
  | 'calendar'
  | 'pending'
  | 'settings';

interface Item {
  key: NavKey;
  label: string;
  icon: typeof Calendar;
}

const ITEMS: Item[] = [
  { key: 'today', label: 'Today', icon: Sparkles },
  { key: 'cycle', label: 'Cycle', icon: Layers },
  { key: 'template', label: 'Template', icon: FileText },
  { key: 'projects', label: 'Projects', icon: ClipboardList },
  { key: 'review', label: 'Review', icon: LineChart },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'pending', label: 'Pending', icon: Inbox },
  { key: 'settings', label: 'Settings', icon: Settings },
];

interface Props {
  active: NavKey;
  onNavigate: (next: NavKey) => void;
}

export function SideNav({ active, onNavigate }: Props) {
  const pendingCount = CHECKIN_QUEUE.length; // F3 — render `·` dot when > 0

  return (
    <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col items-stretch bg-surface-0 py-6">
      {/* Brand mark — minimal two curved rails. Replaces <DayRailMark /> placeholder. */}
      <div className="flex h-9 items-center justify-center">
        <DayRailMark />
      </div>

      <nav className="mt-10 flex flex-1 flex-col gap-1 px-3">
        {ITEMS.map((it) => (
          <NavItem
            key={it.key}
            item={it}
            active={active === it.key}
            onClick={() => onNavigate(it.key)}
            badgeDot={it.key === 'pending' && pendingCount > 0}
            pendingTooltip={
              it.key === 'pending' ? `${pendingCount} unmarked` : undefined
            }
          />
        ))}
      </nav>

      {/* Footer tag: subtitle never translates per §9.6 */}
      <div className="flex flex-col items-center gap-1 px-2">
        <span className="font-mono text-[9px] tracking-widest text-ink-tertiary">
          STAY
        </span>
        <span className="font-mono text-[9px] tracking-widest text-ink-tertiary">
          ON
        </span>
        <span className="font-mono text-[9px] tracking-widest text-ink-tertiary">
          THE RAIL
        </span>
      </div>
    </aside>
  );
}

function NavItem({
  item,
  active,
  onClick,
  badgeDot,
  pendingTooltip,
}: {
  item: Item;
  active: boolean;
  onClick: () => void;
  badgeDot: boolean;
  pendingTooltip?: string;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={pendingTooltip ?? item.label}
      className={clsx(
        'group relative flex h-11 w-full items-center justify-center rounded-md transition',
        active
          ? 'bg-surface-2 text-ink-primary'
          : 'text-ink-tertiary hover:text-ink-primary hover:bg-surface-1',
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
      {badgeDot && (
        <span
          aria-hidden
          className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cta"
        />
      )}
      {/* Selected-state left marker — G2 "decorative color strip" whitelist. */}
      {active && (
        <span
          aria-hidden
          className="absolute left-[-12px] h-5 w-[3px] rounded-r bg-ink-primary"
        />
      )}
      <span className="pointer-events-none absolute left-full z-20 ml-3 hidden whitespace-nowrap rounded-md bg-ink-primary px-2 py-1 font-mono text-2xs uppercase tracking-widest text-surface-0 group-hover:block">
        {item.label}
      </span>
    </button>
  );
}

function DayRailMark() {
  // Two curved rails meeting the horizon. SVG is intentionally minimal and
  // drawn in inline stroke so it inherits text color via `currentColor`.
  return (
    <svg
      viewBox="0 0 28 28"
      aria-label="DayRail"
      className="text-ink-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
    >
      <path d="M4 24 C 10 16, 18 16, 24 24" />
      <path d="M8 24 C 12 18, 16 18, 20 24" />
      <line x1="3" y1="24" x2="25" y2="24" strokeWidth={0.9} opacity={0.45} />
    </svg>
  );
}
