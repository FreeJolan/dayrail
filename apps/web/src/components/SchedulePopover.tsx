import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { toIsoDate, useStore, type Rail, type Task } from '@dayrail/core';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './primitives/Popover';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.5.2 — schedule popover with two mutually exclusive modes:
//   A · Bind to a Rail on the chosen date (default)
//   B · Free time window (backed by an AdhocEvent)
//
// Pre-v0.3 simplification: CalendarRule isn't wired yet, so mode A
// lists every Rail the user has — grouped by Template — regardless
// of which Template fires on the chosen date. Once Cycle → Template
// mapping lands we'll narrow the list.

type Mode = 'rail' | 'free';

interface Props {
  task: Task;
  children: React.ReactNode; // the trigger (an icon button)
}

export function SchedulePopover({ task, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[340px] p-0">
        {open && <Body task={task} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function Body({ task, onDone }: { task: Task; onDone: () => void }) {
  const railsMap = useStore((s) => s.rails);
  const templatesMap = useStore((s) => s.templates);
  const adhocsMap = useStore((s) => s.adhocEvents);
  const scheduleTaskToRail = useStore((s) => s.scheduleTaskToRail);
  const scheduleTaskFreeTime = useStore((s) => s.scheduleTaskFreeTime);
  const unscheduleTask = useStore((s) => s.unscheduleTask);

  const currentAdhoc = useMemo(
    () =>
      Object.values(adhocsMap).find(
        (a) => a.taskId === task.id && a.status === 'active',
      ),
    [adhocsMap, task.id],
  );

  // Seed form defaults: prefer current state, else today + common slot.
  const initialDate =
    task.slot?.date ?? currentAdhoc?.date ?? toIsoDate(new Date());
  const initialMode: Mode = task.slot ? 'rail' : currentAdhoc ? 'free' : 'rail';
  const initialRailId = task.slot?.railId ?? '';
  const initialStart = currentAdhoc?.startMinutes ?? 9 * 60;
  const initialDuration = currentAdhoc?.durationMinutes ?? 60;

  const [date, setDate] = useState(initialDate);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [railId, setRailId] = useState(initialRailId);
  const [startMin, setStartMin] = useState(initialStart);
  const [endMin, setEndMin] = useState(initialStart + initialDuration);

  const railOptions = useMemo(() => {
    const rails = Object.values(railsMap).sort(
      (a, b) => a.startMinutes - b.startMinutes,
    );
    // Group by templateKey for clarity.
    const groups = new Map<string, Rail[]>();
    for (const r of rails) {
      const list = groups.get(r.templateKey) ?? [];
      list.push(r);
      groups.set(r.templateKey, list);
    }
    return [...groups.entries()].map(([templateKey, rs]) => ({
      templateKey,
      templateName: templatesMap[templateKey]?.name ?? templateKey,
      rails: rs,
    }));
  }, [railsMap, templatesMap]);

  const canConfirm =
    mode === 'rail'
      ? Boolean(railId) && Boolean(date)
      : Boolean(date) && endMin > startMin;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    if (mode === 'rail') {
      // v0.3 will add a proper cycleId lookup from CalendarRule; for
      // v0.2 we stamp a date-scoped ambient id so the field has
      // something deterministic.
      await scheduleTaskToRail(task.id, {
        cycleId: `cycle-${date}`,
        date,
        railId,
      });
    } else {
      await scheduleTaskFreeTime(task.id, {
        date,
        startMinutes: startMin,
        durationMinutes: endMin - startMin,
      });
    }
    onDone();
  };

  const handleUnschedule = async () => {
    await unscheduleTask(task.id);
    onDone();
  };

  const isScheduled = Boolean(task.slot) || Boolean(currentAdhoc);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleConfirm();
      }}
      className="flex flex-col"
    >
      <header className="flex flex-col gap-0.5 border-b border-hairline/40 px-4 py-3">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Schedule
        </span>
        <span className="truncate text-sm text-ink-primary">{task.title}</span>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        <Field label="排到某天">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-hairline/60 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary outline-none transition focus:border-ink-secondary"
          />
        </Field>

        <Field label="时段">
          <ModePicker value={mode} onChange={setMode} />

          {mode === 'rail' ? (
            <div className="mt-2">
              <select
                value={railId}
                onChange={(e) => setRailId(e.target.value)}
                className="w-full rounded-md border border-hairline/60 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary outline-none transition focus:border-ink-secondary"
              >
                <option value="">选择 Rail…</option>
                {railOptions.map((g) => (
                  <optgroup key={g.templateKey} label={g.templateName}>
                    {g.rails.map((r) => (
                      <option key={r.id} value={r.id}>
                        {formatRailOption(r)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {railOptions.length === 0 && (
                <p className="mt-2 text-xs text-ink-tertiary">
                  还没有 Rail。去 Template Editor 建一条，或改成"直接指定时间"。
                </p>
              )}
              {railId && (
                <RailPreview railId={railId} rails={Object.values(railsMap)} />
              )}
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="time"
                value={minutesToHHMM(startMin)}
                onChange={(e) => setStartMin(hhmmToMinutes(e.target.value))}
                className="w-1/2 rounded-md border border-hairline/60 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary outline-none transition focus:border-ink-secondary"
              />
              <span className="shrink-0 text-ink-tertiary">→</span>
              <input
                type="time"
                value={minutesToHHMM(endMin)}
                onChange={(e) => setEndMin(hhmmToMinutes(e.target.value))}
                className="w-1/2 rounded-md border border-hairline/60 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary outline-none transition focus:border-ink-secondary"
              />
            </div>
          )}
        </Field>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-hairline/40 px-4 py-3">
        {isScheduled ? (
          <button
            type="button"
            onClick={() => void handleUnschedule()}
            className="text-xs text-ink-tertiary transition hover:text-ink-secondary"
          >
            取消排期
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-md px-3 py-1.5 text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              canConfirm
                ? 'bg-ink-primary text-surface-0 hover:bg-ink-secondary'
                : 'cursor-not-allowed bg-surface-2 text-ink-tertiary',
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            确认排期
          </button>
        </div>
      </footer>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}

function ModePicker({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  const opts: Array<{ key: Mode; label: string }> = [
    { key: 'rail', label: '排到某条 Rail' },
    { key: 'free', label: '直接指定时间' },
  ];
  return (
    <div className="flex gap-2">
      {opts.map((o) => {
        const selected = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={clsx(
              'flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left transition',
              selected
                ? 'border-ink-primary bg-surface-2'
                : 'border-hairline/60 bg-surface-0 hover:border-hairline',
            )}
          >
            <span
              aria-hidden
              className={clsx(
                'h-3 w-3 shrink-0 rounded-full border',
                selected
                  ? 'border-ink-primary bg-ink-primary'
                  : 'border-hairline/80',
              )}
            />
            <span className="text-sm text-ink-primary">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function RailPreview({
  railId,
  rails,
}: {
  railId: string;
  rails: Rail[];
}) {
  const rail = rails.find((r) => r.id === railId);
  if (!rail) return null;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-surface-1 px-2.5 py-1.5">
      <span
        aria-hidden
        className="h-3 w-1 rounded-sm"
        style={{ background: RAIL_COLOR_HEX[rail.color] }}
      />
      <span className="font-mono text-xs tabular-nums text-ink-secondary">
        {minutesToHHMM(rail.startMinutes)}–
        {minutesToHHMM(rail.startMinutes + rail.durationMinutes)}
      </span>
      <span className="truncate text-sm text-ink-primary">{rail.name}</span>
    </div>
  );
}

function formatRailOption(rail: Rail): string {
  const start = minutesToHHMM(rail.startMinutes);
  const end = minutesToHHMM(rail.startMinutes + rail.durationMinutes);
  return `${start}–${end}  ${rail.name}`;
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
