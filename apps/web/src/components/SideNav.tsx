import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Inbox,
  Layers,
  LineChart,
  ListChecks,
  Settings,
  Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';
import { selectPendingQueue, useStore } from '@dayrail/core';

// Left sticky rail nav. Default expanded (labels visible) to teach
// first-time users what each icon means; collapsible to icon-only for
// power users who know the map. Preference persisted in localStorage.

export type NavKey =
  | 'today'
  | 'cycle'
  | 'template'
  | 'tasks'
  | 'review'
  | 'calendar'
  | 'pending'
  | 'settings';

interface Item {
  key: NavKey;
  label: string;
  icon: typeof Calendar;
  path: string;
  /** A URL prefix that, when the location matches it, counts as
   *  "this tab is active". `/tasks/inbox`, `/tasks/line/xyz`, etc.
   *  all light up the Tasks tab. Defaults to `path` when omitted. */
  prefix?: string;
}

// Two groups, separated by a 16px margin. Top group = daily / planning
// consumption (the Rails you ride). Bottom group = meta / config
// (the Rails' editor + app settings).
const PRIMARY_ITEMS: Item[] = [
  { key: 'today', label: 'Today', icon: Sparkles, path: '/' },
  { key: 'cycle', label: 'Cycle', icon: Layers, path: '/cycle' },
  { key: 'tasks', label: 'Tasks', icon: ListChecks, path: '/tasks/inbox', prefix: '/tasks' },
  { key: 'review', label: 'Review', icon: LineChart, path: '/review' },
  { key: 'calendar', label: 'Calendar', icon: Calendar, path: '/calendar' },
  { key: 'pending', label: 'Unresolved', icon: Inbox, path: '/pending' },
];

const SECONDARY_ITEMS: Item[] = [
  { key: 'template', label: 'Template', icon: FileText, path: '/templates', prefix: '/templates' },
  { key: 'settings', label: 'Settings', icon: Settings, path: '/settings', prefix: '/settings' },
];

const COLLAPSE_KEY = 'dayrail.sidenav.collapsed';

function isActive(pathname: string, item: Item): boolean {
  const prefix = item.prefix ?? item.path;
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function SideNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Subscribe to the raw map; derive via useMemo so Zustand's
  // reference-equality short-circuit kicks in instead of comparing a
  // freshly-built array every tick.
  const railInstances = useStore((s) => s.railInstances);
  const pendingCount = useMemo(
    () => selectPendingQueue({ railInstances }).length,
    [railInstances],
  );

  return (
    <aside
      className={clsx(
        'sticky top-0 flex h-screen shrink-0 flex-col items-stretch bg-surface-0 py-6 transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[208px]',
      )}
    >
      <BrandHeader collapsed={collapsed} />

      <nav className="mt-8 flex flex-1 flex-col gap-0.5 px-3">
        {PRIMARY_ITEMS.map((it) => (
          <NavItem
            key={it.key}
            item={it}
            active={isActive(location.pathname, it)}
            onClick={() => navigate(it.path)}
            collapsed={collapsed}
            badgeDot={it.key === 'pending' && pendingCount > 0}
            badgeTooltip={
              it.key === 'pending' && pendingCount > 0
                ? `${pendingCount} unmarked`
                : undefined
            }
          />
        ))}
        <div aria-hidden className="mt-4" />
        {SECONDARY_ITEMS.map((it) => (
          <NavItem
            key={it.key}
            item={it}
            active={isActive(location.pathname, it)}
            onClick={() => navigate(it.path)}
            collapsed={collapsed}
            badgeDot={false}
            tier="secondary"
          />
        ))}
      </nav>

      <div
        className={clsx(
          'flex px-3 pb-0 pt-2',
          collapsed ? 'justify-center' : 'justify-end',
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand nav' : 'Collapse nav'}
          title={collapsed ? 'Expand nav' : 'Collapse nav'}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary',
            collapsed ? 'h-8 w-8 justify-center' : 'h-8 px-2',
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" strokeWidth={1.8} />
              <span className="font-mono text-2xs uppercase tracking-widest">
                收起
              </span>
            </>
          )}
        </button>
      </div>

      <BrandFooter collapsed={collapsed} />
    </aside>
  );
}

// ---------- sub-parts ----------

function BrandHeader({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={clsx(
        'flex items-center',
        collapsed ? 'h-10 justify-center' : 'h-10 gap-2.5 px-4',
      )}
    >
      <DayRailMark />
      {!collapsed && (
        <span className="font-mono text-base font-medium tracking-wide text-ink-primary">
          DayRail
        </span>
      )}
    </div>
  );
}

function BrandFooter({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 pt-2">
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
    );
  }
  return (
    <div className="px-4 pt-2">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Stay on the Rail
      </span>
    </div>
  );
}

function NavItem({
  item,
  active,
  onClick,
  collapsed,
  badgeDot,
  badgeTooltip,
  tier = 'primary',
}: {
  item: Item;
  active: boolean;
  onClick: () => void;
  collapsed: boolean;
  badgeDot: boolean;
  badgeTooltip?: string;
  tier?: 'primary' | 'secondary';
}) {
  const Icon = item.icon;
  const isSecondary = tier === 'secondary';

  // Color + stroke per tier. Secondary state is slightly retracted so
  // Template / Settings read as "config, not daily flow" without being
  // actively de-emphasized when selected.
  const tierText = active
    ? 'text-ink-primary'
    : isSecondary
      ? 'text-ink-tertiary/80 hover:text-ink-secondary'
      : 'text-ink-tertiary hover:text-ink-primary';

  const iconClass = isSecondary ? 'h-[16px] w-[16px]' : 'h-[18px] w-[18px]';
  const iconStroke = isSecondary ? 1.35 : 1.6;

  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? (badgeTooltip ?? item.label) : badgeTooltip}
      className={clsx(
        'group relative flex h-10 w-full items-center rounded-md transition',
        collapsed ? 'justify-center' : 'justify-start gap-3 px-3',
        active
          ? 'bg-surface-2'
          : 'hover:bg-surface-1',
        tierText,
      )}
    >
      <Icon className={iconClass} strokeWidth={iconStroke} />
      {!collapsed && (
        <span
          className={clsx(
            'flex-1 text-left text-sm transition-opacity',
            active
              ? 'font-medium'
              : isSecondary
                ? 'font-normal'
                : 'font-normal',
          )}
        >
          {item.label}
        </span>
      )}
      {badgeDot && (
        <span
          aria-hidden
          className={clsx(
            'h-1.5 w-1.5 rounded-full bg-cta',
            collapsed ? 'absolute right-2 top-2' : 'mr-1',
          )}
        />
      )}
      {active && (
        <span
          aria-hidden
          className="absolute left-[-12px] h-5 w-[3px] rounded-r bg-ink-primary"
        />
      )}
      {/* Tooltip only when collapsed — expanded state already shows the label inline */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full z-20 ml-3 hidden whitespace-nowrap rounded-md bg-ink-primary px-2 py-1 font-mono text-2xs uppercase tracking-widest text-surface-0 group-hover:block">
          {item.label}
        </span>
      )}
    </button>
  );
}

function DayRailMark() {
  // viewBox 28×28, content vertically centered on y=14 (the midline).
  // Baseline of the horizon sits at y=18; curves peak at y=10.
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 28 28"
      aria-label="DayRail"
      className="shrink-0 text-ink-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M4 18 C 10 10, 18 10, 24 18" />
      <path d="M8 18 C 12 12, 16 12, 20 18" />
      <line x1="3" y1="18" x2="25" y2="18" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}
