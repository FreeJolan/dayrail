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
  Wand2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { selectPendingQueue, useStore } from '@dayrail/core';
import { useSyncStatus } from '@/lib/sync/syncStore';
import { useSyncClassification } from '@/lib/sync/useSyncClassification';
import {
  formatDurationAgo,
  formatDurationLong,
  type SyncStatusClassification,
} from '@dayrail/core';
import { getLastSuccessAt } from '@/lib/sync/identity';

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
  | 'settings'
  | 'proposals';

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

// SideNav used to carry a Backlog entry that toggled the right drawer.
// It was removed because "active = drawer is open" collided with every
// other NavItem's "active = route matches" grammar and read as "you're
// on the Backlog page", which it isn't. The drawer is still reachable
// via its own collapsed handle on the right and via the `g b`
// keyboard shortcut (wired up in App.tsx, independent of this file).
interface SideNavProps {
  /** Opens the Proposals modal (ERD §6.7 — a tool, not a route). */
  onOpenStaging: () => void;
}

// Three primary groups separated by mode of use, then config below
// after a wider gap. Splitting the primary items makes the rail read
// in three distinct mental modes — plan forward (time views) → act on
// tasks → reflect — instead of mixing them in a flat list. Unresolved
// sits next to Tasks (it's the attention-driven counterpart) rather
// than at the bottom where its badge dot is easy to miss.
const PLANNING_ITEMS: Item[] = [
  { key: 'today', label: 'Today', icon: Sparkles, path: '/' },
  { key: 'cycle', label: 'Cycle', icon: Layers, path: '/cycle' },
  { key: 'calendar', label: 'Calendar', icon: Calendar, path: '/calendar' },
];

const TASK_ITEMS: Item[] = [
  { key: 'tasks', label: 'Tasks', icon: ListChecks, path: '/tasks/inbox', prefix: '/tasks' },
  { key: 'pending', label: 'Unresolved', icon: Inbox, path: '/pending' },
];

// ERD §6.7 — Proposals is a TOOL (button → modal), not a route. `path`
// is unused; clicking opens the AI parse modal (never reads as active).
const PROPOSALS_TOOL_ITEM: Item = { key: 'proposals', label: 'Proposals', icon: Wand2, path: '' };

const REFLECTION_ITEMS: Item[] = [
  { key: 'review', label: 'Review', icon: LineChart, path: '/review' },
];

const PRIMARY_GROUPS: Item[][] = [PLANNING_ITEMS, TASK_ITEMS, REFLECTION_ITEMS];

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

export function SideNav({ onOpenStaging }: SideNavProps) {
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

  // Subscribe to the raw maps; derive via useMemo so Zustand's
  // reference-equality short-circuit kicks in instead of comparing a
  // freshly-built array every tick.
  const tasks = useStore((s) => s.tasks);
  const taskOccurrences = useStore((s) => s.taskOccurrences);
  const railRevisions = useStore((s) => s.railRevisions);
  const railTombstones = useStore((s) => s.railTombstones);
  const pendingCount = useMemo(
    () =>
      selectPendingQueue({
        tasks,
        taskOccurrences,
        railRevisions,
        railTombstones,
      }).length,
    [tasks, taskOccurrences, railRevisions, railTombstones],
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
        {PRIMARY_GROUPS.map((group, gi) => (
          <div key={gi} className={clsx('flex flex-col gap-0.5', gi > 0 && 'mt-3')}>
            {group.map((it) => (
              <NavItem
                key={it.key}
                item={it}
                active={isActive(location.pathname, it)}
                onClick={() => navigate(it.path)}
                collapsed={collapsed}
                badgeDot={it.key === 'pending' && pendingCount > 0}
                badgeTooltip={
                  it.key === 'pending' && pendingCount > 0 ? `${pendingCount} unmarked` : undefined
                }
              />
            ))}
          </div>
        ))}
        <div className="mt-3">
          <NavItem
            item={PROPOSALS_TOOL_ITEM}
            active={false}
            onClick={onOpenStaging}
            collapsed={collapsed}
            badgeDot={false}
            badgeTooltip="Proposals · g a"
          />
        </div>
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

      <SyncIndicator collapsed={collapsed} />
      <BrandFooter collapsed={collapsed} />
    </aside>
  );
}

function SyncIndicator({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const status = useSyncStatus();
  const classification = useSyncClassification();
  const { dot, label, tone, hoverTitle } = describeSyncStatus(
    status,
    classification,
  );
  return (
    <button
      type="button"
      onClick={() => navigate('/settings/sync')}
      title={hoverTitle ?? (collapsed ? label : undefined)}
      className={clsx(
        'group relative flex h-7 items-center rounded-md text-ink-tertiary transition hover:bg-surface-1 hover:text-ink-secondary',
        collapsed ? 'mx-3 justify-center' : 'mx-3 gap-2 px-2',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          dot,
          tone === 'syncing' && 'animate-pulse',
        )}
      />
      {!collapsed && (
        <span className="truncate text-2xs uppercase tracking-widest">
          {label}
        </span>
      )}
    </button>
  );
}

/** Pull-failure hover copy (#5). Distinct wording from
 *  `formatDurationLong` (which is push-framed "传不上去") — this is
 *  about not reaching the cloud to confirm currency. */
function formatStaleFor(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return '一直没能连上云端';
  const m = Math.floor(durationMs / 60000);
  if (m < 60) return `已 ${m} 分钟没成功连上`;
  const h = Math.floor(m / 60);
  if (h < 24) return `已 ${h} 小时没成功连上`;
  const d = Math.floor(h / 24);
  return `已 ${d} 天没成功连上`;
}

function describeSyncStatus(
  status: ReturnType<typeof useSyncStatus>,
  classification: SyncStatusClassification,
): {
  dot: string;
  label: string;
  tone: 'idle' | 'syncing' | 'warn' | 'ok';
  /** Native browser tooltip text · plain language explanation that
   *  goes deeper than the short uppercase label. ERD §7.10.5 says
   *  duration belongs in the hover, not the main label. */
  hoverTitle?: string;
} {
  if (!status.connected) {
    return { dot: 'bg-ink-tertiary/40', label: 'Local only', tone: 'idle' };
  }
  if (status.phase.kind === 'syncing') {
    return { dot: 'bg-ink-secondary', label: '同步中', tone: 'syncing' };
  }
  if (status.phase.kind === 'offline') {
    return { dot: 'bg-warn/70', label: '离线', tone: 'warn' };
  }
  // ERD §7.10.5 v0.12.7 — two-axis classification (#4–#8). The old
  // "同步断开" (driven purely by time-since-push) is retired into
  // honest, failure-specific states; an idle-but-consistent device now
  // correctly reads "已同步" instead of false-alarming "断开".
  switch (classification.kind) {
    case 'push-failure':
      // #4 — your changes can't get up. The high-stakes one; duration
      // ladder lives in the hover (§7.10.5 "duration in hover, not label").
      return {
        dot: 'bg-warn',
        label: `${classification.count} 个改动没传上去`,
        tone: 'warn',
        hoverTitle: `${formatDurationLong(classification.durationMs)} · 点击进入同步设置`,
      };
    case 'pull-failure':
      // #5 — can't reach the cloud to confirm we're current.
      return {
        dot: 'bg-warn',
        label: '连不上云端',
        tone: 'warn',
        hoverTitle: `${formatStaleFor(classification.durationMs)} · 点击排查`,
      };
    case 'queued':
      // #6 — changes queued, not failing. Transient.
      return {
        dot: 'bg-warn/70',
        label: `未同步 · ${classification.count}`,
        tone: 'warn',
      };
    case 'synced': {
      // #7 — honest "已同步". Hover spells out recency so currency is
      // visible (we never pretend to be millisecond-live).
      const anchor =
        classification.lastSuccessPullIso ?? getLastSuccessAt('push');
      return {
        dot: 'bg-ink-secondary/70',
        label: '已同步',
        tone: 'ok',
        ...(anchor && {
          hoverTitle: `刚同步过 · ${formatDurationAgo(anchor, Date.now())}`,
        }),
      };
    }
    case 'checking':
      // #8 — nothing pending, nothing failing, currency not yet
      // confirmed this session (just relaunched / first sync pending).
      // Non-alarming on purpose.
      return { dot: 'bg-ink-tertiary/40', label: '检查中', tone: 'idle' };
  }
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
