import { clsx } from 'clsx';
import type { ExternalEvent, RailColor } from '@dayrail/core';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
} from './railColors';

// ERD §14.1 — render a single ExternalEvent. Supports five kinds:
//   - holiday        · solid CTA fill, white text (statutory off-day)
//   - observance     · dashed CTA outline, no fill (cultural / traditional)
//   - event          · neutral (reserved; no source ships this yet)
//   - user-note      · solid user color + white text (when color set);
//                       outlined neutral (when no color)
//   - makeup-workday · solid SLATE fill, white text (state council 调休)
//
// Visual axes:
//   - warm vs cool          → holiday / observance vs makeup
//   - filled vs outlined    → official statutory vs cultural / contextual
//   - bold vs regular       → emphasized statutory presence vs subordinate
//
// Earlier iteration used a faint warm tint (`--cta` 0.12 alpha) for
// holidays — invisible on RESTDAY-tinted cells. Now holidays use a
// fully-saturated CTA fill so they read at-a-glance regardless of the
// underlying template tint, and observances stay subordinate via the
// dashed outline.

type ChipShape = 'dot' | 'badge';

interface Props {
  event: ExternalEvent;
  /** `dot` — small color dot only (Cycle View date cell, Calendar cell);
   *  `badge` — colored chip + label text (Today Track / Calendar
   *  popover list / Review). */
  shape: ChipShape;
  className?: string;
  onClick?: () => void;
}

/** Resolve the rail color for a user-note from its meta payload. */
function resolveUserNoteColor(event: ExternalEvent): RailColor | null {
  const m = event.meta;
  if (!m || typeof m !== 'object') return null;
  const c = (m as Record<string, unknown>).color;
  return typeof c === 'string' ? (c as RailColor) : null;
}

/** Visual treatment per kind. Style axes documented at the top of
 *  the file; per-kind values are the actual rendering. */
function chipStyles(event: ExternalEvent): {
  background: string | undefined;
  border: string;
  color: string;
  fontWeight?: number;
} {
  if (event.kind === 'holiday') {
    // Statutory off-day — fully-saturated warm fill, white text. The
    // most prominent style; meant to read across any underlying cell
    // tint (RESTDAY yellow / WORKDAY blue / etc.).
    return {
      background: 'rgb(var(--cta))',
      border: '1px solid rgb(var(--cta))',
      color: '#fff',
      fontWeight: 600,
    };
  }
  if (event.kind === 'observance') {
    // Cultural / traditional — outlined, subordinate to holidays.
    return {
      background: undefined,
      border: '1px dashed rgb(var(--cta) / 0.75)',
      color: 'rgb(var(--cta))',
    };
  }
  if (event.kind === 'user-note') {
    const railColor = resolveUserNoteColor(event);
    if (railColor) {
      // User picked a color — render filled with that color so user
      // notes feel as prominent as holidays. The user-color hue
      // distinguishes them from the warm CTA holiday fill.
      return {
        background: RAIL_COLOR_HEX[railColor],
        border: `1px solid ${RAIL_COLOR_HEX[railColor]}`,
        color: '#fff',
        fontWeight: 600,
      };
    }
    // Default (neutral) — outlined gray. Less prominent than a
    // colored note but still visibly editable / personal.
    return {
      background: 'rgb(var(--surface-2))',
      border: '1px solid rgb(var(--ink-tertiary) / 0.5)',
      color: 'rgb(var(--ink-secondary))',
    };
  }
  if (event.kind === 'makeup-workday') {
    // ERD §14 — "this looks like a weekend but you're working".
    // Cool slate-9 fill mirrors the holiday's prominence but in cool
    // hue, so adjacent Saturday-makeup → Spring-Festival-block reads
    // as two clearly-distinct kinds at a glance.
    return {
      background: RAIL_COLOR_HEX['slate'],
      border: `1px solid ${RAIL_COLOR_HEX['slate']}`,
      color: '#fff',
      fontWeight: 600,
    };
  }
  // 'event' — neutral
  return {
    background: 'rgb(var(--surface-2))',
    border: '1px solid rgb(var(--ink-tertiary) / 0.3)',
    color: 'rgb(var(--ink-secondary))',
  };
}

export function ExternalEventChip({
  event,
  shape,
  className,
  onClick,
}: Props) {
  const styles = chipStyles(event);

  if (shape === 'dot') {
    // Small color marker — kind-aware style. No `title` attribute on
    // purpose: the only consumer (Cycle View date cell) wraps the
    // entire button in a RadixHoverCard, and a native title would
    // produce a second grey tooltip stacked under the custom one.
    return (
      <span
        aria-hidden
        onClick={onClick}
        className={clsx(
          'inline-block h-2 w-2 rounded-full',
          onClick && 'cursor-pointer',
          className,
        )}
        style={{
          background: styles.background ?? 'transparent',
          border: styles.border,
        }}
      />
    );
  }

  // The label sits in an inner span with `truncate` (overflow:hidden +
  // text-overflow:ellipsis + whitespace:nowrap) so a `max-w-*` from the
  // caller's `className` actually clips long names like `调休·春节`
  // into `调休·春…`. Putting truncate on the outer flex container
  // doesn't work — inline-flex doesn't propagate text overflow to its
  // children.
  //
  // No `title=` attribute — surfaces that need a hover preview (Cycle
  // View date cell, Calendar month cell) wrap the chip with our own
  // RadixHoverCard. A native `title` on top of that produces a second
  // grey tooltip stacking under the custom popover.
  return (
    <span
      onClick={onClick}
      className={clsx(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs',
        onClick && 'cursor-pointer hover:brightness-95',
        className,
      )}
      style={{
        background: styles.background,
        border: styles.border,
        color: styles.color,
        ...(styles.fontWeight !== undefined && { fontWeight: styles.fontWeight }),
      }}
    >
      <span className="min-w-0 truncate">{event.label}</span>
    </span>
  );
}

