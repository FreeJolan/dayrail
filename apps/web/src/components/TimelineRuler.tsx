import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { fmtHHMM, type EditableRail } from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.4 E-group left column · per-row time strip.
//
// History note: an earlier version rendered a 06:00→24:00 fixed-pixel
// axis with rail dots placed proportionally by start-minute. That made
// the dots visually independent from the right-column cards' Y
// positions, so a 10:00 rail's dot sat near "12" on the axis while its
// card sat at the top of the list — user-reported "时间轴没跟内容对齐".
//
// New shape: one paired cell per right-column row. The parent body uses
// CSS Grid (`grid-cols-[<cell-width>_1fr]`), so each ruler cell shares
// a grid row with its rail card; their heights stay locked together
// regardless of card content. The ruler cell renders a small color
// stripe + the rail's start time, giving "where in the day am I?"
// without forcing a fixed pixel-per-minute axis.

const CELL_WIDTH_PX = 76;
export const TIMELINE_RULER_COL = `${CELL_WIDTH_PX}px` as const;

interface RailCellProps {
  rail: EditableRail;
  focused?: boolean;
  onFocus?: () => void;
}

export function TimelineRulerRailCell({
  rail,
  focused,
  onFocus,
}: RailCellProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onFocus}
      title={`${rail.name} · ${fmtHHMM(rail.startMin)}–${fmtHHMM(rail.endMin)}`}
      className={clsx(
        'group flex h-full w-full items-stretch justify-end gap-2 rounded-md text-right transition focus:outline-none',
        'cursor-pointer',
      )}
      style={{ width: CELL_WIDTH_PX }}
    >
      <div className="flex flex-1 flex-col justify-center gap-0.5 py-1.5 pr-1.5">
        <span
          className={clsx(
            'font-mono text-2xs tabular-nums transition',
            focused ? 'text-ink-primary' : 'text-ink-secondary',
          )}
        >
          {fmtHHMM(rail.startMin)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-ink-tertiary">
          {fmtHHMM(rail.endMin)}
        </span>
      </div>
      <div className="relative flex w-[3px] shrink-0 items-stretch">
        <span
          aria-hidden
          className={clsx(
            'absolute inset-y-1 right-0 rounded-sm transition',
            focused ? 'w-[5px]' : 'w-[3px] opacity-80',
          )}
          style={{ background: RAIL_COLOR_HEX[rail.color] }}
        />
      </div>
      {focused && (
        <ArrowRight
          aria-hidden
          className="self-center text-cta -mr-1 h-3 w-3 shrink-0"
          strokeWidth={2.4}
        />
      )}
    </button>
  );
}

/** Empty cell paired with a GapChip on the right. The cell is silent
 *  on purpose — the gap chip itself shows the start/end times. */
export function TimelineRulerGapCell(): JSX.Element {
  return <div aria-hidden style={{ width: CELL_WIDTH_PX }} />;
}

/** Empty cell paired with the "+ 添加 Rail" tail row. */
export function TimelineRulerAddCell(): JSX.Element {
  return <div aria-hidden style={{ width: CELL_WIDTH_PX }} />;
}
