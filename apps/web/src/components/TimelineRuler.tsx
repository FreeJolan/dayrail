import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { fmtHHMM, type EditableRail, type TemplateSummary } from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.4 E-group left column (sticky, ~120px):
//   · 06:00 → 24:00 vertical time axis
//   · each Rail as a Rail.color step-9 block
//   · a focus arrow `▶` tracks the Rail currently focused in the right column
//   · below the axis: a passive gap-summary list
//
// Intentionally not clickable for the static mock — the interaction is
// "right column scrolls → arrow follows", but the reverse path needs a
// scroll manager we'll wire when we introduce the store.

const AXIS_START_MIN = 6 * 60; // 06:00
const AXIS_END_MIN = 24 * 60; // 24:00
const AXIS_SPAN = AXIS_END_MIN - AXIS_START_MIN;
// Pixel density: 18 hours × 18 px/15 min = 1296 px total. Feels dense but
// readable, and keeps the whole day visible on a 14" laptop without scroll.
const PX_PER_MIN = 72 / 60; // 72 px per hour
const AXIS_HEIGHT = AXIS_SPAN * PX_PER_MIN; // 1296 px

const TICK_HOURS = [6, 9, 12, 15, 18, 21, 24];

interface Props {
  rails: EditableRail[];
  summary: TemplateSummary;
  focusRailId?: string;
}

export function TimelineRuler({ rails, summary, focusRailId }: Props) {
  const focusRail = rails.find((r) => r.id === focusRailId);
  const focusTop =
    focusRail != null
      ? (focusRail.startMin - AXIS_START_MIN) * PX_PER_MIN
      : undefined;

  return (
    <aside
      aria-label="Template timeline overview"
      className="sticky top-[92px] flex w-[132px] shrink-0 flex-col gap-4 self-start pt-2"
    >
      <header className="flex items-baseline justify-between">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Timeline
        </span>
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          06 → 24
        </span>
      </header>

      <div className="relative flex">
        {/* Tick labels (06/09/12/15/18/21/24) */}
        <ul className="relative w-8 shrink-0">
          {TICK_HOURS.map((h) => {
            const top = (h * 60 - AXIS_START_MIN) * PX_PER_MIN;
            return (
              <li
                key={h}
                className="absolute right-0 font-mono text-2xs tabular-nums text-ink-tertiary"
                style={{ top: top - 7 }}
              >
                {String(h).padStart(2, '0')}
              </li>
            );
          })}
          <li
            aria-hidden
            className="pointer-events-none"
            style={{ height: AXIS_HEIGHT }}
          />
        </ul>

        {/* Axis column with Rail blocks */}
        <div
          className="relative ml-3 w-4 shrink-0 bg-surface-1"
          style={{ height: AXIS_HEIGHT }}
        >
          {TICK_HOURS.map((h) => {
            const top = (h * 60 - AXIS_START_MIN) * PX_PER_MIN;
            return (
              <span
                key={h}
                aria-hidden
                className="absolute left-0 h-px w-full bg-surface-3"
                style={{ top }}
              />
            );
          })}
          {rails.map((rail) => {
            const top = (rail.startMin - AXIS_START_MIN) * PX_PER_MIN;
            const height = (rail.endMin - rail.startMin) * PX_PER_MIN;
            return (
              <span
                key={rail.id}
                title={`${rail.name} · ${fmtHHMM(rail.startMin)}–${fmtHHMM(rail.endMin)}`}
                className="absolute inset-x-0 rounded-sharp"
                style={{
                  top,
                  height,
                  background: RAIL_COLOR_HEX[rail.color],
                  opacity: focusRailId && rail.id !== focusRailId ? 0.45 : 1,
                  transition: 'opacity 180ms',
                }}
              />
            );
          })}
        </div>

        {/* Focus arrow, absolutely positioned relative to whole ruler */}
        {focusTop !== undefined && (
          <ArrowRight
            aria-hidden
            className={clsx(
              'absolute left-[62px] h-4 w-4 text-cta transition-[top] duration-200',
            )}
            strokeWidth={2}
            style={{ top: focusTop + 4 }}
          />
        )}
      </div>

      {/* Gap-summary list (passive, non-interactive, per §5.4) */}
      <div className="flex flex-col gap-1 pt-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Gaps
        </span>
        {summary.gaps.length === 0 ? (
          <span className="font-mono text-2xs text-ink-tertiary/80">—</span>
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
