import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Boxes,
  Calendar,
  FileText,
  Inbox,
  Layers,
  LineChart,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
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

// Left sticky rail nav. Redesigned per Claude Design handoff
// (variant C · "action cards"): the central thesis is "views go
// somewhere, tools do something". Three signals separate the two so a
// user never reads Proposals/Backlog as another page to switch to:
//   1. mono uppercase SECTION LABELS (PLAN / TASKS / REVIEW / ACTIONS
//      / CONFIG) name each band — they're signs, not buttons.
//   2. views are flat rows that take an active state (sand-2 fill +
//      3px terracotta edge marker + terracotta icon); TOOLS are
//      two-line cards (tile icon + ↗ + hint + keystroke) and NEVER go
//      active.
//   3. collapsed (icon-only) keeps the tell: tool icons sit in a
//      tinted sand-2 tile, view icons sit on transparent.
// Default expanded to teach the icon→label map; collapse preference
// persisted in localStorage.

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

interface SideNavProps {
  /** Opens the Proposals modal (ERD §6.7 — a tool, not a route). */
  onOpenStaging: () => void;
  /** Toggles the right-docked Backlog drawer (a tool, not a route). */
  onToggleBacklog: () => void;
}

// View-nav, grouped by mode of use. Splitting the rows into labeled
// bands makes the rail read in distinct mental modes — plan forward →
// act on tasks → reflect — instead of one flat list. Unresolved sits
// in TASKS (it's the attention-driven counterpart) and carries a count.
const VIEW_GROUPS: { label: string; items: Item[] }[] = [
  {
    label: 'Plan',
    items: [
      { key: 'today', label: 'Today', icon: Sparkles, path: '/' },
      { key: 'cycle', label: 'Cycle', icon: Layers, path: '/cycle' },
      { key: 'calendar', label: 'Calendar', icon: Calendar, path: '/calendar' },
    ],
  },
  {
    label: 'Tasks',
    items: [
      { key: 'tasks', label: 'Tasks', icon: ListChecks, path: '/tasks/inbox', prefix: '/tasks' },
      { key: 'pending', label: 'Unresolved', icon: Inbox, path: '/pending' },
    ],
  },
  {
    label: 'Review',
    items: [{ key: 'review', label: 'Review', icon: LineChart, path: '/review' }],
  },
];

// CONFIG — secondary identity, demoted to the bottom and rendered in a
// retracted ink tier (config, not daily flow). Still takes an active
// state when its route is open.
const CONFIG_ITEMS: Item[] = [
  { key: 'template', label: 'Template', icon: FileText, path: '/templates', prefix: '/templates' },
  { key: 'settings', label: 'Settings', icon: Settings, path: '/settings', prefix: '/settings' },
];

interface Tool {
  key: string;
  name: string;
  icon: typeof Calendar;
  /** One-line "what this opens" copy under the name. */
  hint: string;
  /** Real DayRail bigraph shortcut (the design's ⌘P/⌘B placeholders
   *  map to our `g`-leader scheme). */
  kbd: string;
}

const COLLAPSE_KEY = 'dayrail.sidenav.collapsed';

function isActive(pathname: string, item: Item): boolean {
  const prefix = item.prefix ?? item.path;
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function SideNav({ onOpenStaging, onToggleBacklog }: SideNavProps) {
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

  // Tools open overlays, not routes — so their click handlers come from
  // the shell (modal / drawer) rather than `navigate`.
  const tools: (Tool & { onClick: () => void })[] = [
    { key: 'proposals', name: 'Proposals', icon: Wand2, hint: 'Paste · parse', kbd: 'g a', onClick: onOpenStaging },
    { key: 'backlog', name: 'Backlog', icon: Boxes, hint: 'Unscheduled', kbd: 'g b', onClick: onToggleBacklog },
  ];

  return (
    <aside
      className={clsx(
        'sticky top-0 flex h-screen shrink-0 flex-col items-stretch bg-surface-0 transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[208px]',
      )}
    >
      <BrandHeader collapsed={collapsed} />

      <nav
        className={clsx(
          'flex flex-1 flex-col overflow-hidden pb-1.5 pt-0.5',
          collapsed ? 'px-1.5' : 'px-2.5',
        )}
      >
        {VIEW_GROUPS.map((group, gi) => (
          <div key={group.label} className="flex flex-col gap-px pb-1.5">
            {collapsed ? (
              gi > 0 && <div aria-hidden className="h-2" />
            ) : (
              <SectionLabel>{group.label}</SectionLabel>
            )}
            {group.items.map((it) => (
              <NavItem
                key={it.key}
                item={it}
                active={isActive(location.pathname, it)}
                onClick={() => navigate(it.path)}
                collapsed={collapsed}
                count={it.key === 'pending' ? pendingCount : undefined}
              />
            ))}
          </div>
        ))}

        {/* ACTIONS — tools, never a route. Two-line cards expanded;
            tinted icon tiles collapsed (separated by a hairline since
            the section label is gone). */}
        <div className="flex flex-col gap-0.5 pt-0.5">
          {collapsed ? (
            <div aria-hidden className="mx-1.5 mb-1.5 mt-1 h-px bg-hairline" />
          ) : (
            <SectionLabel>Actions</SectionLabel>
          )}
          {tools.map((t) =>
            collapsed ? (
              <ToolTile key={t.key} tool={t} />
            ) : (
              <ToolCard key={t.key} tool={t} />
            ),
          )}
        </div>

        {/* spacer — pushes CONFIG to the bottom of the scroll area */}
        <div aria-hidden className="min-h-[8px] flex-1" />

        <div className="flex flex-col gap-px">
          {collapsed ? (
            <div aria-hidden className="h-2" />
          ) : (
            <SectionLabel>Config</SectionLabel>
          )}
          {CONFIG_ITEMS.map((it) => (
            <NavItem
              key={it.key}
              item={it}
              active={isActive(location.pathname, it)}
              onClick={() => navigate(it.path)}
              collapsed={collapsed}
              demoted
            />
          ))}
        </div>
      </nav>

      <BottomDock
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />
    </aside>
  );
}

// ---------- section label ----------

// Mono uppercase band heading. A sign, not a button — same visual
// weight as a hairline, no chrome. JetBrains Mono, tracking-widest
// (0.18em), ink-tertiary.
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-widest text-ink-tertiary">
      {children}
    </div>
  );
}

// ---------- view item ----------

function NavItem({
  item,
  active,
  onClick,
  collapsed,
  demoted = false,
  count,
}: {
  item: Item;
  active: boolean;
  onClick: () => void;
  collapsed: boolean;
  demoted?: boolean;
  /** Unresolved gets a count: a sand-3 chip expanded, a terracotta pip
   *  collapsed. Undefined / 0 renders nothing. */
  count?: number;
}) {
  const Icon = item.icon;
  const hasCount = count != null && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={clsx(
        'group relative flex items-center rounded-md transition',
        collapsed ? 'mx-auto h-[38px] w-11 justify-center' : 'h-8 gap-2.5 px-2.5',
        active
          ? 'bg-surface-2 text-ink-primary'
          : demoted
            ? 'text-ink-tertiary hover:bg-surface-1 hover:text-ink-primary'
            : 'text-ink-secondary hover:bg-surface-1 hover:text-ink-primary',
      )}
    >
      <Icon
        className={clsx('h-[18px] w-[18px] shrink-0', active && 'text-cta')}
        strokeWidth={1.6}
      />
      {!collapsed && (
        <span className="flex-1 truncate text-left text-[13px]">{item.label}</span>
      )}
      {!collapsed && hasCount && (
        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-surface-3 px-1.5 font-mono text-[10px] font-medium text-ink-primary">
          {count}
        </span>
      )}
      {collapsed && hasCount && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cta ring-2 ring-surface-0"
        />
      )}
      {active && (
        <span
          aria-hidden
          className={clsx(
            'absolute top-1/2 w-[3px] -translate-y-1/2 rounded-r-sm bg-cta',
            collapsed ? 'left-[-6px] h-[22px]' : 'left-[-10px] h-[18px]',
          )}
        />
      )}
      {collapsed && <CollapsedTip label={item.label} />}
    </button>
  );
}

// ---------- tool: expanded action card ----------

// Two-line card: tile icon + name + ↗ (opens-an-overlay tell) over a
// hint line + keystroke. Reads as "a thing you trigger", never a route.
function ToolCard({ tool }: { tool: Tool & { onClick: () => void } }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={tool.onClick}
      title={`${tool.name} · ${tool.kbd}`}
      className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-surface-1"
    >
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-surface-2 text-ink-primary transition group-hover:bg-surface-3">
        <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-primary">
          {tool.name}
          <ArrowUpRight
            className="h-[11px] w-[11px] text-ink-tertiary transition group-hover:-translate-y-px group-hover:translate-x-px group-hover:text-cta"
            strokeWidth={1.9}
          />
        </span>
        <span className="flex items-center gap-2 text-[10.5px] text-ink-tertiary">
          <span className="truncate">{tool.hint}</span>
          <span className="font-mono text-[10px] tracking-wide">{tool.kbd}</span>
        </span>
      </span>
    </button>
  );
}

// ---------- tool: collapsed icon tile ----------

// Collapsed tell: the tool icon sits inside a tinted sand-2 tile, so it
// reads as a "button" against the transparent view icons above it.
function ToolTile({ tool }: { tool: Tool & { onClick: () => void } }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={tool.onClick}
      title={`${tool.name} · ${tool.kbd}`}
      className="group relative mx-auto flex h-[38px] w-11 items-center justify-center"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-ink-primary transition group-hover:bg-surface-3">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
      </span>
      <CollapsedTip label={`${tool.name} · ${tool.kbd}`} />
    </button>
  );
}

// Shared collapsed hover tooltip (label spills to the right of the rail).
function CollapsedTip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full z-20 ml-3 hidden whitespace-nowrap rounded-md bg-ink-primary px-2 py-1 font-mono text-2xs uppercase tracking-widest text-surface-0 group-hover:block">
      {label}
    </span>
  );
}

// ---------- bottom dock (sync + collapse + footer) ----------

function BottomDock({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <div
      className={clsx(
        'mt-1 border-t border-hairline pt-2.5',
        collapsed ? 'px-1.5 pb-3' : 'px-2.5 pb-3',
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5">
          <SyncIndicator collapsed />
          <CollapseButton collapsed onToggle={onToggleCollapsed} />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <SyncIndicator collapsed={false} />
            <CollapseButton collapsed={false} onToggle={onToggleCollapsed} />
          </div>
          <BrandFooter />
        </>
      )}
    </div>
  );
}

function CollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand nav' : 'Collapse nav'}
      title={collapsed ? 'Expand nav' : 'Collapse nav'}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-ink-secondary transition hover:bg-surface-1 hover:text-ink-primary"
    >
      {collapsed ? (
        <PanelLeftOpen className="h-[15px] w-[15px]" strokeWidth={1.7} />
      ) : (
        <PanelLeftClose className="h-[15px] w-[15px]" strokeWidth={1.7} />
      )}
    </button>
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
        'flex h-7 items-center rounded-sm text-ink-secondary transition hover:bg-surface-1 hover:text-ink-primary',
        collapsed ? 'w-7 justify-center' : 'min-w-0 flex-1 gap-2 px-2',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
          dot,
          tone === 'syncing' && 'animate-pulse',
        )}
      />
      {!collapsed && <span className="truncate text-[11.5px]">{label}</span>}
    </button>
  );
}

function BrandFooter() {
  return (
    <div className="px-2 pt-2">
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-tertiary/80">
        Stay on the Rail
      </span>
    </div>
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

// ---------- brand ----------

function BrandHeader({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={clsx(
        'flex items-center',
        collapsed ? 'h-12 justify-center' : 'h-12 gap-2.5 px-4',
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
