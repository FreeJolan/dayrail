import { clsx } from 'clsx';
import { useState } from 'react';
import {
  type CycleDay,
  type CycleSlot,
  formatDayLabel,
} from '@/data/sampleCycle';
import {
  fmtHHMM,
  type EditableRail,
  type TemplateKey,
} from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';
import { CycleCell } from './CycleCell';
import { TASK_DRAG_MIME } from './BacklogDrawer';

// ERD §5.3 D1-1B — per-template stacked section. Each section is a
// self-contained mini-grid. Structure:
//
//   ┌─── 8 px Template.color strip ───────────────────────────────┐
//   │  ┌─ 24 px section mini-header ───────────────────────────┐  │
//   │  │ TEMPLATE · N days  | Mon 13 | Tue 14 | ... | Thu 16   │  │
//   │  └────────────────────────────────────────────────────── ┘  │
//   │  Rail row: [name · time]  | cell | cell | cell | cell       │
//   │  ...                                                         │
//   └──────────────────────────────────────────────────────────────┘

interface Props {
  templateKey: TemplateKey;
  templateLabel: string;
  templateColor: EditableRail['color'];
  rails: EditableRail[];
  days: CycleDay[];
  slotsByKey: Map<string, CycleSlot>; // key = `${railId}|${date}`
  todayISO: string;
  onDropTask?: (taskId: string, date: string, railId: string) => void;
}

export function CycleSection({
  templateLabel,
  templateColor,
  rails,
  days,
  slotsByKey,
  todayISO,
  onDropTask,
}: Props) {
  const stripColor = RAIL_COLOR_HEX[templateColor];
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  return (
    <section
      aria-label={`${templateLabel} section`}
      className="relative overflow-hidden rounded-md bg-surface-1"
    >
      {/* 8 px left color strip (decorative, G2 whitelist) */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-2"
        style={{ background: stripColor }}
      />

      <div className="overflow-x-auto pl-5">
        <SectionMiniHeader
          templateLabel={templateLabel}
          days={days}
          stripColor={stripColor}
          todayISO={todayISO}
        />

        <table className="table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-[140px]" />
            {days.map((d) => (
              <col key={d.date} className="w-[180px]" />
            ))}
          </colgroup>

          <tbody>
            {rails.map((rail) => (
              <tr key={rail.id}>
                <th
                  scope="row"
                  className="pr-3 py-1 text-left align-top"
                >
                  <RailRowLabel rail={rail} />
                </th>
                {days.map((d) => {
                  const slot = slotsByKey.get(`${rail.id}|${d.date}`);
                  const cellKey = `${rail.id}|${d.date}`;
                  const canDrop = onDropTask != null;
                  const isHover = hoverKey === cellKey;
                  return (
                    <td
                      key={d.date}
                      onDragEnter={
                        canDrop
                          ? (e) => {
                              if (!hasTaskPayload(e)) return;
                              e.preventDefault();
                              setHoverKey(cellKey);
                            }
                          : undefined
                      }
                      onDragOver={
                        canDrop
                          ? (e) => {
                              if (!hasTaskPayload(e)) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }
                          : undefined
                      }
                      onDragLeave={
                        canDrop
                          ? () => {
                              setHoverKey((k) =>
                                k === cellKey ? null : k,
                              );
                            }
                          : undefined
                      }
                      onDrop={
                        canDrop
                          ? (e) => {
                              const taskId = e.dataTransfer.getData(
                                TASK_DRAG_MIME,
                              );
                              setHoverKey(null);
                              if (!taskId) return;
                              e.preventDefault();
                              onDropTask(taskId, d.date, rail.id);
                            }
                          : undefined
                      }
                      className={clsx(
                        'p-1 align-top transition',
                        d.date === todayISO && 'bg-surface-2/40',
                        isHover && 'bg-cta-soft/30 ring-1 ring-inset ring-cta/60',
                      )}
                    >
                      {slot ? (
                        <CycleCell
                          state={slot.state}
                          color={rail.color}
                          taskName={slot.taskName}
                          meta={slot.meta}
                        />
                      ) : (
                        <CycleCell state="planned-empty" color={rail.color} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function hasTaskPayload(e: React.DragEvent<HTMLTableCellElement>): boolean {
  return Array.from(e.dataTransfer.types).includes(TASK_DRAG_MIME);
}

function SectionMiniHeader({
  templateLabel,
  days,
  stripColor,
  todayISO,
}: {
  templateLabel: string;
  days: CycleDay[];
  stripColor: string;
  todayISO: string;
}) {
  return (
    <div className="flex min-h-[48px] items-center gap-0 border-b border-transparent py-2">
      <table className="table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[140px]" />
          {days.map((d) => (
            <col key={d.date} className="w-[180px]" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="pr-3 text-left align-middle">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-[3px] rounded-sm"
                  style={{ background: stripColor }}
                />
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
                  {templateLabel}
                </span>
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  · {days.length} days
                </span>
              </div>
            </th>
            {days.map((d) => {
              const { weekday, dayNum } = formatDayLabel(d);
              const isToday = d.date === todayISO;
              return (
                <th
                  key={d.date}
                  className="px-1 text-left align-middle"
                >
                  <div className="flex items-baseline gap-1">
                    <span
                      className={clsx(
                        'font-mono text-2xs uppercase tracking-widest',
                        isToday ? 'text-ink-primary' : 'text-ink-tertiary',
                      )}
                    >
                      {weekday}
                    </span>
                    <span
                      className={clsx(
                        'font-mono text-sm tabular-nums',
                        isToday
                          ? 'text-ink-primary font-medium'
                          : 'text-ink-secondary',
                      )}
                    >
                      {dayNum}
                    </span>
                    {d.overridden && (
                      <span
                        aria-hidden
                        title="覆盖"
                        className="h-1 w-1 rounded-full bg-cta"
                      />
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
      </table>
    </div>
  );
}

function RailRowLabel({ rail }: { rail: EditableRail }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="h-6 w-1 shrink-0 rounded-sm"
        style={{ background: RAIL_COLOR_HEX[rail.color] }}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-ink-primary">
          {rail.name}
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {fmtHHMM(rail.startMin)} → {fmtHHMM(rail.endMin)}
        </span>
      </span>
    </div>
  );
}
