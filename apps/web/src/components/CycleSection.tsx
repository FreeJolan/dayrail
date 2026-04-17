import { clsx } from 'clsx';
import {
  type CycleDay,
  type CycleSlot,
  formatDayLabel,
  railsForDay,
} from '@/data/sampleCycle';
import {
  SAMPLE_TEMPLATES,
  fmtHHMM,
  type EditableRail,
  type TemplateKey,
} from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';
import { CycleCell } from './CycleCell';

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
  days: CycleDay[];
  slotsByKey: Map<string, CycleSlot>; // key = `${railId}|${date}`
  todayISO: string;
}

export function CycleSection({
  templateKey,
  days,
  slotsByKey,
  todayISO,
}: Props) {
  const template = SAMPLE_TEMPLATES.find((t) => t.key === templateKey)!;
  // Rails = the Rails registered in this template (sorted by start).
  // We pick any one of the days' rails — all days that use this template
  // share the same Rail set (that's the point of a template).
  const rails: EditableRail[] = railsForDay(days[0]!);

  const stripColor = RAIL_COLOR_HEX[template.color];

  return (
    <section
      aria-label={`${template.label} section`}
      className="relative overflow-hidden rounded-md bg-surface-1"
    >
      {/* 8 px left color strip (decorative, G2 whitelist) */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-2"
        style={{ background: stripColor }}
      />

      <div className="pl-5">
        <SectionMiniHeader
          template={template}
          days={days}
          stripColor={stripColor}
          todayISO={todayISO}
        />

        <table className="w-full table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-[160px]" />
            {days.map((d) => (
              <col key={d.date} />
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
                  return (
                    <td
                      key={d.date}
                      className={clsx(
                        'p-1 align-top',
                        d.date === todayISO && 'bg-surface-2/40',
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

function SectionMiniHeader({
  template,
  days,
  stripColor,
  todayISO,
}: {
  template: (typeof SAMPLE_TEMPLATES)[number];
  days: CycleDay[];
  stripColor: string;
  todayISO: string;
}) {
  return (
    <div className="flex min-h-[48px] items-center gap-0 border-b border-transparent py-2">
      <table className="w-full table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[160px]" />
          {days.map((d) => (
            <col key={d.date} />
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
                  {template.label}
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
