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
  const strip = isCurrent ? CTA_HEX : RAIL_COLOR_HEX[rail.color];
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
        (rail.state === 'skipped' || rail.state === 'unmarked') && 'text-ink-tertiary',
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

      <div className="relative flex flex-col gap-2 px-5 py-4 pl-6">
        <header className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <h3
              className={clsx(
                'font-mono text-xs uppercase tracking-widest',
                rail.state === 'done' && 'text-ink-tertiary',
                rail.state === 'current' && 'text-ink-primary',
                rail.state === 'pending' && 'text-ink-secondary',
                (rail.state === 'unmarked' || rail.state === 'skipped') && 'text-ink-tertiary',
              )}
            >
              {rail.name}
            </h3>
            {isCurrent && <CurrentRailChip />}
            {rail.state === 'done' && <DoneCheck />}
            {rail.state === 'skipped' && (
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                Skipped
              </span>
            )}
            {rail.state === 'unmarked' && (
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
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm bg-cta px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-cta-foreground"
      style={{ letterSpacing: '0.14em' }}
    >
      <span className="inline-block h-1.5 w-1.5 animate-[pulse_2s_ease-in-out_infinite] rounded-full bg-cta-foreground" />
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
  return (
    <div
      className={clsx(
        'mt-1 flex items-center gap-2 transition',
        'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0',
        state === 'current' && 'opacity-100 translate-y-0',
      )}
    >
      <ActionButton variant="primary" icon={Check} label="完成" />
      <ActionButton icon={SkipForward} label="跳过" />
      <ActionButton icon={RotateCw} label="Shift…" />
      <ActionButton variant="terracotta" icon={Replace} label="替换" />
    </div>
  );
}

function UndoRow({ label }: { label: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        className="rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-secondary"
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
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-mono text-2xs uppercase tracking-widest transition',
        variant === 'primary' &&
          'bg-ink-primary text-surface-0 hover:bg-ink-secondary',
        variant === 'default' &&
          'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary',
        variant === 'terracotta' &&
          'border border-cta/40 text-cta hover:bg-cta hover:text-cta-foreground',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={1.8} />
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
