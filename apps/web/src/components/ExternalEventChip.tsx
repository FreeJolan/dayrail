import { clsx } from 'clsx';
import type { ExternalEvent, RailColor } from '@dayrail/core';
import {
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
} from './railColors';

// ERD §14.1 — render a single ExternalEvent. Supports five kinds:
//   - holiday        · solid fill (warm)
//   - observance     · dashed outline (warm)
//   - event          · neutral (reserved; no source ships this yet)
//   - user-note      · outlined + user color (default neutral gray)
//   - makeup-workday · solid cool (slate) fill (state council 调休)
//
// Visual axes:
//   - warm vs cool      → "happy day off" vs "warning, working"
//   - solid vs outlined → "official off-day" vs "personal/cultural"
//
// The chip is intentionally compact and reuses the rail-color tokens
// so notes feel native to DayRail's palette. Users pick from the same
// 10-color set; default (no color) maps to a muted neutral.

type ChipShape = 'dot' | 'badge';

interface Props {
  event: ExternalEvent;
  /** `dot` — small color dot only (Cycle View date cell, Calendar cell);
   *  `badge` — colored chip + label text (Today Track / Calendar
   *  popover list / Review). */
  shape: ChipShape;
  className?: string;
  onClick?: () => void;
  /** Optional title override for the dot variant; defaults to event.label. */
  title?: string;
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
} {
  if (event.kind === 'holiday') {
    // Statutory off-day — solid warm fill, the most prominent style.
    return {
      background: 'rgb(var(--cta) / 0.12)',
      border: '1px solid rgb(var(--cta) / 0.55)',
      color: 'rgb(var(--cta))',
    };
  }
  if (event.kind === 'observance') {
    return {
      background: undefined,
      border: '1px dashed rgb(var(--cta) / 0.55)',
      color: 'rgb(var(--cta) / 0.85)',
    };
  }
  if (event.kind === 'user-note') {
    const railColor = resolveUserNoteColor(event);
    if (railColor) {
      return {
        background: RAIL_COLOR_STEP_4[railColor],
        border: `1px solid ${RAIL_COLOR_STEP_6[railColor]}`,
        color: RAIL_COLOR_HEX[railColor],
      };
    }
    // Default (neutral) chip — uses ink-tertiary tokens.
    return {
      background: 'rgb(var(--surface-2))',
      border: '1px solid rgb(var(--ink-tertiary) / 0.4)',
      color: 'rgb(var(--ink-secondary))',
    };
  }
  if (event.kind === 'makeup-workday') {
    // ERD §14 — "this looks like a weekend but you're working".
    // Cool slate fill contrasts the warm holiday chips so adjacent
    // days (Saturday makeup before a Spring-Festival block) read
    // distinct at a glance.
    return {
      background: RAIL_COLOR_STEP_4['slate'],
      border: `1px solid ${RAIL_COLOR_STEP_6['slate']}`,
      color: RAIL_COLOR_HEX['slate'],
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
  title,
}: Props) {
  const styles = chipStyles(event);
  const tooltipTitle = title ?? event.label;

  if (shape === 'dot') {
    // Small color marker — used in Cycle View date cell + Calendar
    // top-right indicator stack. 6px dot, kind-aware style.
    return (
      <span
        aria-hidden
        title={tooltipTitle}
        onClick={onClick}
        className={clsx(
          'inline-block h-1.5 w-1.5 rounded-full',
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
      }}
    >
      {event.label}
    </span>
  );
}

/** Render a stacked group of chips for a date cell (Cycle View use).
 *  Up to `max` dots, then a `…+N` text fold. Hover surface (label
 *  list) is the consumer's responsibility. */
export function ExternalEventDotStack({
  events,
  max = 3,
  className,
  onClick,
}: {
  events: ExternalEvent[];
  max?: number;
  className?: string;
  onClick?: (event: ExternalEvent) => void;
}) {
  if (events.length === 0) return null;
  const visible = events.slice(0, max);
  const overflow = events.length - visible.length;
  const hoverTitle = events.map((e) => e.label).join(' · ');
  return (
    <div
      title={hoverTitle}
      className={clsx('flex shrink-0 flex-col items-end gap-1', className)}
    >
      {visible.map((ev, i) => (
        <ExternalEventChip
          key={`${ev.sourceId}-${i}`}
          event={ev}
          shape="dot"
          {...(onClick && { onClick: () => onClick(ev) })}
        />
      ))}
      {overflow > 0 && (
        <span className="font-mono text-2xs text-ink-tertiary">+{overflow}</span>
      )}
    </div>
  );
}
