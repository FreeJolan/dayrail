import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import {
  toIsoDate,
  useStore,
  type HabitBinding,
  type Rail,
  type Task,
  type Template,
} from '@dayrail/core';
import { RAIL_COLOR_HEX } from './railColors';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';

// Shared rail-picker that surfaces *current usage* alongside each
// option. The goal is to make "this rail is already carrying things"
// visible at pick time — so the user doesn't accidentally pile a
// second habit or task onto a rail that's already packed.
//
// Usage chip format (per rail):
//   • "绑定 ×N" — active HabitBinding count for this rail
//   • "今日 ×M" — pending/in-progress tasks scheduled on this rail
//                  for today (date-scoped; v0.5 may broaden to cycle)
//   • 空 rail 不显示 chip
//
// Used by SchedulePopover (task → rail) and HabitDetail (habit → rail
// via HabitBinding).

interface Props {
  /** Candidate rails, already filtered by caller (e.g. templateKey). */
  rails: Rail[];
  /** All templates — used for group labels. */
  templates: Record<string, Template>;
  /** Current selection (railId). Empty string = none. */
  value: string;
  onChange: (railId: string) => void;
  /** Optional: highlight the group matching the date-resolved template.
   *  SchedulePopover passes the pickTemplateForDate result here. */
  activeTemplateKey?: string;
  /** Optional: ISO date used to scope the "今日 ×M" count. Defaults
   *  to today (local). */
  usageDate?: string;
  placeholder?: string;
  /** Optional className for the trigger button so callers can size it. */
  className?: string;
}

export function RailPicker({
  rails,
  templates,
  value,
  onChange,
  activeTemplateKey,
  usageDate,
  placeholder = '选择 Rail…',
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  // Subscribe to raw maps only, derive usage via useMemo — see the
  // "Zustand selectors" memory.
  const tasksMap = useStore((s) => s.tasks);
  const habitBindingsMap = useStore((s) => s.habitBindings);

  const usageByRail = useMemo(
    () =>
      computeUsage(tasksMap, habitBindingsMap, usageDate ?? toIsoDate(new Date())),
    [tasksMap, habitBindingsMap, usageDate],
  );

  const groups = useMemo(() => groupRails(rails), [rails]);
  const sortedGroups = useMemo(
    () =>
      [...groups.entries()].sort(([a], [b]) => {
        if (activeTemplateKey) {
          if (a === activeTemplateKey) return -1;
          if (b === activeTemplateKey) return 1;
        }
        return a.localeCompare(b);
      }),
    [groups, activeTemplateKey],
  );

  const selected = rails.find((r) => r.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'inline-flex items-center gap-2 rounded-md border border-hairline/60 bg-surface-0 px-2 py-1.5 text-left text-sm transition hover:border-hairline',
            className,
          )}
        >
          {selected ? (
            <>
              <span
                aria-hidden
                className="h-3 w-[3px] shrink-0 rounded-sm"
                style={{ background: RAIL_COLOR_HEX[selected.color as keyof typeof RAIL_COLOR_HEX] ?? RAIL_COLOR_HEX.slate }}
              />
              <span className="truncate text-ink-primary">{selected.name}</span>
              <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
                {formatRailTime(selected)}
              </span>
            </>
          ) : (
            <span className="text-ink-tertiary">{placeholder}</span>
          )}
          <ChevronDown
            aria-hidden
            className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-tertiary"
            strokeWidth={1.6}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="max-h-[360px] w-[340px] overflow-y-auto p-1"
      >
        {rails.length === 0 && (
          <p className="px-3 py-2 text-xs text-ink-tertiary">
            还没有 Rail。去 Template Editor 建一条。
          </p>
        )}
        {sortedGroups.map(([templateKey, list]) => {
          const tpl = templates[templateKey];
          const isActive = templateKey === activeTemplateKey;
          return (
            <div key={templateKey} className="flex flex-col">
              <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-2">
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary/80">
                  {tpl?.name ?? templateKey}
                </span>
                {isActive && (
                  <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
                    · 当天模板
                  </span>
                )}
              </div>
              {list.map((r) => {
                const active = r.id === value;
                const usage = usageByRail.get(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      onChange(r.id);
                      setOpen(false);
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition',
                      active ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-3 w-[3px] shrink-0 rounded-sm"
                      style={{
                        background:
                          RAIL_COLOR_HEX[
                            r.color as keyof typeof RAIL_COLOR_HEX
                          ] ?? RAIL_COLOR_HEX.slate,
                      }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-ink-primary">{r.name}</span>
                      <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
                        {formatRailTime(r)}
                      </span>
                    </span>
                    {usage && <UsageChips usage={usage} />}
                    {active && (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-ink-tertiary"
                        strokeWidth={2}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

interface RailUsage {
  bindings: number;
  tasksToday: number;
}

function UsageChips({ usage }: { usage: RailUsage }) {
  return (
    <span className="flex items-center gap-1">
      {usage.bindings > 0 && (
        <span
          title={`已有 ${usage.bindings} 个 habit 绑定到这条 rail`}
          className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] tabular-nums text-ink-tertiary"
        >
          绑 ×{usage.bindings}
        </span>
      )}
      {usage.tasksToday > 0 && (
        <span
          title={`这条 rail 今天还有 ${usage.tasksToday} 个未完成任务`}
          className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10px] tabular-nums text-ink-tertiary"
        >
          今 ×{usage.tasksToday}
        </span>
      )}
    </span>
  );
}

function computeUsage(
  tasksMap: Record<string, Task>,
  habitBindingsMap: Record<string, HabitBinding>,
  date: string,
): Map<string, RailUsage> {
  const out = new Map<string, RailUsage>();
  const bump = (railId: string, field: keyof RailUsage) => {
    const cur = out.get(railId) ?? { bindings: 0, tasksToday: 0 };
    cur[field]++;
    out.set(railId, cur);
  };
  for (const b of Object.values(habitBindingsMap)) bump(b.railId, 'bindings');
  for (const t of Object.values(tasksMap)) {
    if (!t.slot) continue;
    if (t.slot.date !== date) continue;
    if (t.status !== 'pending' && t.status !== 'in-progress') continue;
    bump(t.slot.railId, 'tasksToday');
  }
  return out;
}

function groupRails(rails: Rail[]): Map<string, Rail[]> {
  const sorted = [...rails].sort((a, b) => a.startMinutes - b.startMinutes);
  const groups = new Map<string, Rail[]>();
  for (const r of sorted) {
    const list = groups.get(r.templateKey) ?? [];
    list.push(r);
    groups.set(r.templateKey, list);
  }
  return groups;
}

function formatRailTime(rail: Rail): string {
  const start = minutesToHHMM(rail.startMinutes);
  const end = minutesToHHMM(rail.startMinutes + rail.durationMinutes);
  return `${start}–${end}`;
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
