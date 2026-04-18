import { Archive, Check, Clock } from 'lucide-react';
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
  /** Pending / current rows: hover action bar (Done / Later / Archive). */
  onAction?: (action: 'done' | 'defer' | 'archive') => void;
  /** Done / deferred / archived / unmarked rows: the inline undo button
   *  reverts `status` back to 'pending' (no Reason toast — this is an
   *  explicit "I pressed the wrong thing" gesture). */
  onUndo?: () => void;
  /** Click the card body to open the Task detail drawer. Only fired
   *  when a carrying Task exists (the parent enables / disables). */
  onOpenDetail?: () => void;
  /** Shift tags from the most recent Shift for this rail's carrying
   *  Task. Rendered inline on done / deferred / archived rows so the
   *  user can see why at a glance. */
  tags?: string[];
}

export function RailCard({ rail, onAction, onUndo, onOpenDetail, tags }: Props) {
  const duration = computeDurationMinutes(rail.start, rail.end);
  const isCurrent = rail.state === 'current';
  const isDone = rail.state === 'done';
  const isDeferred = rail.state === 'deferred';
  const isArchived = rail.state === 'archived';
  const isUnmarked = rail.state === 'unmarked';
  // Strip fades to step-6 for "settled past" states (done / archived) so
  // the main timeline reads past-vs-upcoming at a glance. Deferred
  // keeps the step-9 tint so the row still reads as "pending somewhere
  // else". Unmarked keeps step-9 — it wants attention.
  const strip = isCurrent
    ? CTA_HEX
    : isDone || isArchived
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
        (isDeferred || isArchived || isUnmarked) && 'text-ink-tertiary',
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
        onClick={onOpenDetail}
        role={onOpenDetail ? 'button' : undefined}
        tabIndex={onOpenDetail ? 0 : undefined}
        onKeyDown={
          onOpenDetail
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenDetail();
                }
              }
            : undefined
        }
        className={clsx(
          'relative flex flex-col gap-2 px-5 py-4 pl-6',
          // Settled states get a faded content layer so the strip reads
          // as primary info and text as archival. Deferred keeps fuller
          // opacity — its hatching already carries weight and dimming
          // would make it look identical to archived.
          isDone && 'opacity-70',
          isArchived && 'opacity-60',
          onOpenDetail && 'cursor-pointer',
        )}
      >
        <header className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <h3
              className={clsx(
                'font-mono text-xs uppercase tracking-widest',
                isCurrent && 'text-ink-primary',
                rail.state === 'pending' && 'text-ink-secondary',
                (isDone || isDeferred || isArchived || isUnmarked) && 'text-ink-tertiary',
                // Line-through on the title marks the rail as decided.
                (isDone || isArchived) &&
                  'line-through decoration-ink-tertiary/60 decoration-[1.5px]',
              )}
            >
              {rail.name}
            </h3>
            {isCurrent && <CurrentRailChip />}
            {isDone && <DoneCheck />}
            {isDeferred && (
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                Later
              </span>
            )}
            {isArchived && (
              <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                Archived
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
              isDone || isDeferred || isArchived || isUnmarked
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
              isCurrent && 'text-ink-primary',
              isDone && 'text-ink-tertiary line-through decoration-ink-tertiary/40',
              rail.state === 'pending' && 'text-ink-secondary',
              (isDeferred || isArchived || isUnmarked) && 'text-ink-tertiary',
            )}
          >
            {rail.subtitle}
          </p>
        )}

        {tags && tags.length > 0 && (isDone || isDeferred || isArchived) && (
          <div className="flex flex-wrap items-center gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-ink-tertiary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Hover-reveal action row on pending / current only.
            Done / deferred / archived / unmarked get a single Undo-ish affordance. */}
        {(rail.state === 'pending' || isCurrent) && (
          <ActionRow
            state={rail.state as Extract<RailState, 'pending' | 'current'>}
            onAction={onAction}
          />
        )}

        {isUnmarked && <UndoRow label="补录" onClick={onUndo} />}
        {isDeferred && <UndoRow label="取消以后再说" onClick={onUndo} />}
        {isArchived && <UndoRow label="取消归档" onClick={onUndo} />}
        {isDone && <UndoRow label="撤回完成" onClick={onUndo} />}
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

function ActionRow({
  state,
  onAction,
}: {
  state: Extract<RailState, 'pending' | 'current'>;
  onAction?: (action: 'done' | 'defer' | 'archive') => void;
}) {
  // Reveal animation eases in slightly slower than other transitions
  // so the three buttons feel "arrived" rather than "popped". Default
  // 180 ms duration for both opacity and translate.
  return (
    <div
      className={clsx(
        'mt-1 flex items-center gap-2 transition duration-200',
        'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0',
        state === 'current' && 'opacity-100 translate-y-0',
      )}
    >
      <ActionButton
        variant="primary"
        icon={Check}
        label="完成"
        onClick={(e) => {
          e.stopPropagation();
          onAction?.('done');
        }}
      />
      <ActionButton
        icon={Clock}
        label="以后再说"
        onClick={(e) => {
          e.stopPropagation();
          onAction?.('defer');
        }}
      />
      <ActionButton
        icon={Archive}
        label="归档"
        onClick={(e) => {
          e.stopPropagation();
          onAction?.('archive');
        }}
      />
    </div>
  );
}

function UndoRow({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <div className="mt-1 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
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
  onClick,
}: {
  variant?: 'default' | 'primary' | 'terracotta';
  icon: typeof Check;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  // CN-content buttons drop Mono/uppercase/tracking-widest — those are
  // for pure-Latin overlines. CN glyphs under tracking-widest look
  // disconnected and muddy under Mono fallback fonts.
  return (
    <button
      type="button"
      onClick={onClick}
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

// Hatching pattern — per ERD §5.8 three-part semantics:
//   unmarked → step 4 (faintest, "still undecided")
//   deferred → step 6 (mid, "pushed off, lives in Pending")
//   archived → also uses the skipped-weight hatching (step 6) so the
//              card reads demoted; the extra line-through on title and
//              stronger opacity differentiates it from deferred.
function stateHatching(
  rail: SampleRail,
): { kind: 'unmarked' | 'skipped'; color: string } | undefined {
  if (rail.state === 'unmarked') {
    return { kind: 'unmarked', color: RAIL_COLOR_STEP_4[rail.color] };
  }
  if (rail.state === 'deferred' || rail.state === 'archived') {
    return { kind: 'skipped', color: RAIL_COLOR_STEP_6[rail.color] };
  }
  return undefined;
}
