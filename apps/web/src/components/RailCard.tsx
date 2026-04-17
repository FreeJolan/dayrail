import { Check, Replace, RotateCw, SkipForward } from 'lucide-react';
import { clsx } from 'clsx';
import type { SampleRail, RailState } from '@/data/sample';
import {
  CTA_HEX,
  RAIL_COLOR_HEX,
  RAIL_COLOR_STEP_4,
  RAIL_COLOR_STEP_6,
} from './railColors';

// Anatomy (all five states):
//  ┌──────────────────────────────────────────────────────────┐
//  │█│  overline (Rail name, Mono)        time pill (Mono)     │
//  │█│  optional subtitle (Slot.taskName)                      │
//  │█│  [ hover action row: Done · Skip · Shift… · Replace ]   │
//  └──────────────────────────────────────────────────────────┘
//
// `█` on the left is the decorative color strip (G2 whitelist):
//   - pending / done / skipped / unmarked → Rail.color step 9
//   - current → terracotta (CTA DEFAULT) — replaces Rail color per
//     "terracotta locked to Current Rail / primary CTA / Replace"

interface Props {
  rail: SampleRail;
}

export function RailCard({ rail }: Props) {
  const duration = computeDurationMinutes(rail.start, rail.end);
  const isCurrent = rail.state === 'current';
  const isDone = rail.state === 'done';
  const isSkipped = rail.state === 'skipped';
  const isUnmarked = rail.state === 'unmarked';
  // Strip fades to step-6 for "settled past" states (done / skipped) so
  // the main timeline reads past-vs-upcoming at a glance. Unmarked
  // keeps the step-9 tint — it still wants attention even when dimmed.
  const strip = isCurrent
    ? CTA_HEX
    : isDone || isSkipped
    ? RAIL_COLOR_STEP_6[rail.color]
    : RAIL_COLOR_HEX[rail.color];
  const hatching = stateHatching(rail);

  return (
    <article
      aria-label={rail.name}
      className={clsx(
        'group relative overflow-hidden rounded-md',
        // Surface layer — slight elevation from page bg via surface-1
        'bg-surface-1',
        isCurrent && 'bg-surface-2',
        // Demoted state: title dims via tertiary ink, hatching paints over.
        (isSkipped || isUnmarked) && 'text-ink-tertiary',
      )}
      style={{
        // hatching receives its color via CSS var consumed by utility classes.
        ['--hatch' as string]: hatching?.color,
      }}
    >
      {/* Decorative color strip — 4px left edge, G2 whitelist */}
      <span
        aria-hidden
        className={clsx(
          'absolute inset-y-0 left-0 w-1',
          isCurrent && 'w-1.5',
        )}
        style={{ background: strip }}
      />

      {/* Hatching overlay — sits above bg, below content. */}
      {hatching && (
        <span
          aria-hidden
          className={clsx(
            'absolute inset-0',
            hatching.kind === 'unmarked' ? 'hatch-unmarked' : 'hatch-skipped',
          )}
        />
      )}

      <div
        className={clsx(
          'relative flex flex-col gap-2 px-5 py-4 pl-6',
          // Settled/dropped states get a faded content layer so the strip
          // (and hatching, if present) read as "main info" and the text
          // as "archival". Skipped keeps full opacity — hatching already
          // carries the visual weight, and dimming would compete.
          isDone && 'opacity-70',
        )}
      >
        <header className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <h3
              className={clsx(
                'font-mono text-xs uppercase tracking-widest',
                isCurrent && 'text-ink-primary',
                rail.state === 'pending' && 'text-ink-secondary',
                (isDone || isSkipped || isUnmarked) && 'text-ink-tertiary',
                // Line-through on the title marks the rail as decided —
                // visible with or without a subtitle, which the earlier
                // sub-only line-through missed.
                (isDone || isSkipped) &&
                  'line-through decoration-ink-tertiary/60 decoration-[1.5px]',
              )}
            >
              {rail.name}
            </h3>
            {isCurrent && <CurrentRailChip />}
            {isDone && <DoneCheck />}
            {isSkipped && (
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                Skipped
              </span>
            )}
            {isUnmarked && (
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                Unmarked
              </span>
            )}
          </div>

          <time
            className={clsx(
              'shrink-0 font-mono text-xs tabular-nums',
              rail.state === 'done' || rail.state === 'skipped' || rail.state === 'unmarked'
                ? 'text-ink-tertiary'
                : 'text-ink-secondary',
            )}
            dateTime={`${rail.start}/${rail.end}`}
          >
            {rail.start} <span className="text-ink-tertiary">→</span> {rail.end}
            <span className="ml-2 text-ink-tertiary">{formatDuration(duration)}</span>
          </time>
        </header>

        {rail.subtitle && (
          <p
            className={clsx(
              'text-base',
              rail.state === 'current' && 'text-ink-primary',
              rail.state === 'done' && 'text-ink-tertiary line-through decoration-ink-tertiary/40',
              rail.state === 'pending' && 'text-ink-secondary',
              (rail.state === 'unmarked' || rail.state === 'skipped') && 'text-ink-tertiary',
            )}
          >
            {rail.subtitle}
          </p>
        )}

        {/* Hover-reveal action row on pending / current only.
            Done / skipped / unmarked get a single Undo-ish affordance. */}
        {(rail.state === 'pending' || rail.state === 'current') && (
          <ActionRow state={rail.state} />
        )}

        {rail.state === 'unmarked' && <UndoRow label="补录" />}
        {rail.state === 'skipped' && <UndoRow label="撤回跳过" />}
        {rail.state === 'done' && <UndoRow label="撤回" />}
      </div>
    </article>
  );
}

// ---------- sub-parts ----------

function CurrentRailChip() {
  // The pulse dot uses cta-soft (bronze step 3) for a "lamp on" look —
  // a lighter tint visible ON the bronze chip better reads as a
  // glowing indicator than a dark-on-dark slate-12 point.
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm bg-cta px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-cta-foreground"
      style={{ letterSpacing: '0.14em' }}
    >
      <span className="relative inline-flex h-1.5 w-1.5 items-center justify-center">
        <span className="absolute h-full w-full animate-ping rounded-full bg-cta-soft opacity-80" />
        <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-cta-soft" />
      </span>
      Current Rail
    </span>
  );
}

function DoneCheck() {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-primary/10 text-ink-tertiary">
      <Check className="h-3 w-3" strokeWidth={2} />
    </span>
  );
}

function ActionRow({ state }: { state: Extract<RailState, 'pending' | 'current'> }) {
  // Reveal animation eases in slightly slower than other transitions so
  // the 4 buttons feel "arrived" rather than "popped". Uses default
  // duration (180 ms) for both opacity and translate; staggered via
  // delay in the buttons themselves.
  return (
    <div
      className={clsx(
        'mt-1 flex items-center gap-2 transition duration-200',
        'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0',
        state === 'current' && 'opacity-100 translate-y-0',
      )}
    >
      <ActionButton variant="primary" icon={Check} label="完成" />
      <ActionButton icon={SkipForward} label="跳过" />
      <ActionButton icon={RotateCw} label="Shift" />
      <ActionButton variant="terracotta" icon={Replace} label="替换" />
    </div>
  );
}

function UndoRow({ label }: { label: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        className="rounded-sm px-2.5 py-1 text-xs font-medium text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-secondary"
      >
        {label}
      </button>
    </div>
  );
}

function ActionButton({
  variant = 'default',
  icon: Icon,
  label,
}: {
  variant?: 'default' | 'primary' | 'terracotta';
  icon: typeof Check;
  label: string;
}) {
  // CN-content buttons drop Mono/uppercase/tracking-widest — those are
  // for pure-Latin overlines. CN glyphs under tracking-widest look
  // disconnected and muddy under Mono fallback fonts.
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition',
        variant === 'primary' &&
          'bg-ink-primary text-surface-0 hover:bg-ink-secondary',
        variant === 'default' &&
          'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
        variant === 'terracotta' &&
          'border border-cta/40 text-cta hover:bg-cta hover:text-cta-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

// ---------- helpers ----------

function computeDurationMinutes(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh! - sh!) * 60 + (em! - sm!);
}

function formatDuration(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
}

function stateHatching(rail: SampleRail): { kind: 'unmarked' | 'skipped'; color: string } | undefined {
  if (rail.state === 'unmarked') {
    return { kind: 'unmarked', color: RAIL_COLOR_STEP_4[rail.color] };
  }
  if (rail.state === 'skipped') {
    return { kind: 'skipped', color: RAIL_COLOR_STEP_6[rail.color] };
  }
  return undefined;
}
