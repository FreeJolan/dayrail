import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { fmtHHMM, type EditableRail, type TemplateSummary } from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.4 E-group left column. Purpose: "where in the day is my focus?"
// It does NOT try to render a parallel rail list aligned with the right
// column — natural-height cards on the right can't share a pixel scale
// with a time-proportional ruler, so we simplified:
//
//   · thin 06:00→24:00 axis with hour ticks
//   · one small dot per Rail at its start-minute, colored by Rail.color
//   · focus arrow `▶` points to the middle of the focused Rail block
//   · gap-summary list below the axis

const AXIS_START_MIN = 6 * 60; // 06:00
const AXIS_END_MIN = 24 * 60; // 24:00
const AXIS_SPAN = AXIS_END_MIN - AXIS_START_MIN;
const PX_PER_MIN = 60 / 60; // 60 px per hour — more compact than before
const AXIS_HEIGHT = AXIS_SPAN * PX_PER_MIN; // 1080 px

const TICK_HOURS = [6, 9, 12, 15, 18, 21, 24];

interface Props {
  rails: EditableRail[];
  summary: TemplateSummary;
  focusRailId?: string;
}

export function TimelineRuler({ rails, summary, focusRailId }: Props) {
  const focusRail = rails.find((r) => r.id === focusRailId);
  const focusMid =
    focusRail != null
      ? (focusRail.startMin +
          (focusRail.endMin - focusRail.startMin) / 2 -
          AXIS_START_MIN) *
        PX_PER_MIN
      : undefined;

  return (
    <aside
      aria-label="Template timeline overview"
      className="sticky top-[92px] flex w-[96px] shrink-0 flex-col gap-4 self-start pt-2"
    >
      <header className="flex items-baseline gap-2">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Axis
        </span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          06→24
        </span>
      </header>

      <div className="relative flex" style={{ height: AXIS_HEIGHT }}>
        {/* Tick labels 06/09/12/15/18/21/24 */}
        <ul className="relative w-6 shrink-0">
          {TICK_HOURS.map((h) => {
            const top = (h * 60 - AXIS_START_MIN) * PX_PER_MIN;
            return (
              <li
                key={h}
                className="absolute right-0 font-mono text-2xs tabular-nums text-ink-tertiary"
                style={{ top: top - 6 }}
              >
                {String(h).padStart(2, '0')}
              </li>
            );
          })}
        </ul>

        {/* Thin axis line with tick marks */}
        <div className="relative ml-3 h-full w-px shrink-0 bg-surface-3">
          {TICK_HOURS.map((h) => {
            const top = (h * 60 - AXIS_START_MIN) * PX_PER_MIN;
            return (
              <span
                key={h}
                aria-hidden
                className="absolute -left-1 h-px w-3 bg-surface-3"
                style={{ top }}
              />
            );
          })}

          {/* Each Rail as a small dot at its start time. The block-height
              version was dropped because it couldn't align with the
              right column's natural-height cards. */}
          {rails.map((rail) => {
            const top = (rail.startMin - AXIS_START_MIN) * PX_PER_MIN;
            const height = (rail.endMin - rail.startMin) * PX_PER_MIN;
            const isFocused = focusRailId === rail.id;
            return (
              <span
                key={rail.id}
                title={`${rail.name} · ${fmtHHMM(rail.startMin)}–${fmtHHMM(rail.endMin)}`}
                aria-hidden
                className={clsx(
                  'absolute -left-[2.5px] w-[5px] rounded-sm transition',
                  isFocused ? 'scale-150' : 'opacity-80',
                )}
                style={{
                  top,
                  height: Math.max(height, 5),
                  background: RAIL_COLOR_HEX[rail.color],
                }}
              />
            );
          })}
        </div>

        {/* Focus arrow — points at the middle of the focused Rail */}
        {focusMid !== undefined && (
          <ArrowRight
            aria-hidden
            className="absolute left-[44px] h-3.5 w-3.5 text-cta transition-[top] duration-200"
            strokeWidth={2.4}
            style={{ top: focusMid - 7 }}
          />
        )}
      </div>

      {/* Gap-summary list (passive, non-interactive, per §5.4) */}
      <div className="flex flex-col gap-1 pt-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Gaps
        </span>
        {summary.gaps.length === 0 ? (
          <span className="text-xs text-ink-tertiary/80">—</span>
        ) : (
          <ul className="flex flex-col gap-0.5 font-mono text-2xs tabular-nums text-ink-secondary">
            {summary.gaps.map((g) => (
              <li key={`${g.startMin}-${g.endMin}`}>
                {fmtHHMM(g.startMin)}–{fmtHHMM(g.endMin)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
