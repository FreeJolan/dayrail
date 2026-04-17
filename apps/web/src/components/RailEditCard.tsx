import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { EditableRail } from '@/data/sampleTemplate';
import { SAMPLE_LINES } from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';
import { TimePillPopover } from './TimePillPopover';
import { RailColorPopover } from './RailColorPopover';
import { RowMenu } from './RowMenu';
import type { RailColor } from '@/data/sample';

// ERD §5.4 E6 Rail card anatomy:
//   ┌─border-l-4 (Rail.color step 9)───────────────────────────┐
//   │  [inline-editable title]        [color dot] [time pill]  │
//   │  [optional subtitle]                                      │
//   │                                              [⋯ menu]    │
//   └──────────────────────────────────────────────────────────┘
//
// Auto-sorted by time ascending (parent owns that concern).

interface Props {
  rail: EditableRail;
  siblings: EditableRail[];
  focused: boolean;
  onFocus: () => void;
  onChange: (patch: Partial<EditableRail>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function RailEditCard({
  rail,
  siblings,
  focused,
  onFocus,
  onChange,
  onDelete,
  onDuplicate,
}: Props) {
  const [title, setTitle] = useState(rail.name);
  const [subtitle, setSubtitle] = useState(rail.subtitle ?? '');
  // If the Rail never had a subtitle, the input stays collapsed behind
  // a `+ 副标题` affordance until the user explicitly opens it.
  const [subtitleOpen, setSubtitleOpen] = useState(Boolean(rail.subtitle));

  // Keep local drafts in sync when the Rail is updated externally — e.g.
  // the Edit Session undo wipes the pending edits, and the parent hands
  // us a Rail with the original name/subtitle. Without this, our local
  // state would still display the user's (now-dropped) keystrokes.
  useEffect(() => {
    setTitle(rail.name);
  }, [rail.name]);
  useEffect(() => {
    setSubtitle(rail.subtitle ?? '');
    setSubtitleOpen(Boolean(rail.subtitle));
  }, [rail.subtitle]);

  const lineName =
    rail.defaultLineId == null
      ? null
      : (SAMPLE_LINES.find((l) => l.id === rail.defaultLineId)?.name ?? null);

  return (
    <article
      aria-label={rail.name}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      className={clsx(
        'group relative flex gap-4 overflow-hidden rounded-md px-5 py-3 pl-6 transition',
        focused ? 'bg-surface-2' : 'bg-surface-1 hover:bg-surface-2',
      )}
    >
      {/* border-l-4 decorative strip */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: RAIL_COLOR_HEX[rail.color] }}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== rail.name && onChange({ name: title })}
            aria-label={`${rail.name} 名称`}
            className="min-w-0 flex-1 rounded-sm bg-transparent px-0 py-0.5 text-base font-medium text-ink-primary outline-none placeholder:text-ink-tertiary hover:bg-surface-3/40 focus:bg-surface-3"
          />
          <RailColorPopover
            value={rail.color}
            onChange={(c: RailColor) => onChange({ color: c })}
          />
          <TimePillPopover
            startMin={rail.startMin}
            endMin={rail.endMin}
            currentId={rail.id}
            conflictsWith={siblings}
            onChange={(s, e) => onChange({ startMin: s, endMin: e })}
          />
          <RowMenu
            showInCheckin={rail.showInCheckin}
            defaultLineName={lineName}
            onToggleCheckin={(v) => onChange({ showInCheckin: v })}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onEditLine={() =>
              onChange({
                defaultLineId:
                  rail.defaultLineId == null
                    ? SAMPLE_LINES[0]!.id
                    : null,
              })
            }
          />
        </div>

        {subtitleOpen ? (
          <input
            value={subtitle}
            placeholder="副标题"
            autoFocus={!rail.subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            onBlur={() => {
              if (subtitle !== (rail.subtitle ?? '')) {
                onChange({ subtitle: subtitle || undefined });
              }
              if (!subtitle) setSubtitleOpen(false);
            }}
            aria-label={`${rail.name} 副标`}
            className="rounded-sm bg-transparent px-0 py-0.5 text-sm text-ink-tertiary outline-none placeholder:text-ink-tertiary/50 hover:bg-surface-3/40 focus:bg-surface-3"
          />
        ) : (
          <button
            type="button"
            onClick={() => setSubtitleOpen(true)}
            className="inline-flex w-fit items-center gap-1 text-xs text-ink-tertiary/70 opacity-0 transition hover:text-ink-secondary group-hover:opacity-100"
          >
            <Plus className="h-3 w-3" strokeWidth={1.6} />
            副标题
          </button>
        )}

        {(!rail.showInCheckin || rail.defaultLineId) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-tertiary">
            {!rail.showInCheckin && (
              <span className="rounded-sm bg-surface-3 px-1.5 py-0.5">
                不参与 check-in
              </span>
            )}
            {lineName && (
              <span className="rounded-sm bg-surface-3 px-1.5 py-0.5">
                默认 Line · {lineName}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
