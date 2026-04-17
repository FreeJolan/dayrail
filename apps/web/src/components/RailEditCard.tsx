import { clsx } from 'clsx';
import { useState } from 'react';
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

        <input
          value={subtitle}
          placeholder="subtitle — 可空"
          onChange={(e) => setSubtitle(e.target.value)}
          onBlur={() =>
            subtitle !== (rail.subtitle ?? '') &&
            onChange({ subtitle: subtitle || undefined })
          }
          aria-label={`${rail.name} 副标`}
          className="rounded-sm bg-transparent px-0 py-0.5 text-sm text-ink-tertiary outline-none placeholder:text-ink-tertiary/50 hover:bg-surface-3/40 focus:bg-surface-3"
        />

        {(!rail.showInCheckin || rail.defaultLineId) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
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
