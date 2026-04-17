import { clsx } from 'clsx';
import { Pin, PinOff, Plus, Search, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useState } from 'react';
import { SAMPLE_BACKLOG, type BacklogItem } from '@/data/sampleCycle';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.3 D8 — a split drawer (not a modal), docked on the right.
// Items are unscheduled Chunks waiting to be dragged onto a Slot.
// 📌 pin is the user's "don't let this fall off" marker.

interface Props {
  open: boolean;
  onToggle: () => void;
}

export function BacklogDrawer({ open, onToggle }: Props) {
  const [items, setItems] = useState<BacklogItem[]>(SAMPLE_BACKLOG);
  const togglePin = (id: string) =>
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, pinned: !it.pinned } : it)),
    );

  const sorted = items
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <aside
      aria-label="Backlog drawer"
      className={clsx(
        'sticky top-0 flex h-screen shrink-0 flex-col bg-surface-1 transition-[width] duration-200',
        open ? 'w-[320px]' : 'w-[40px]',
      )}
    >
      <div
        className={clsx(
          'flex h-[52px] items-center',
          open ? 'gap-2 px-4' : 'justify-center',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Collapse backlog' : 'Expand backlog'}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          {open ? (
            <PanelRightClose className="h-4 w-4" strokeWidth={1.6} />
          ) : (
            <PanelRightOpen className="h-4 w-4" strokeWidth={1.6} />
          )}
        </button>
        {open && (
          <>
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-primary">
              Backlog
            </span>
            <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
              {items.length}
            </span>
            <span className="ml-auto" />
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
              aria-label="Add backlog item"
              title="新建待办 / 拖进来"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      {open && (
        <>
          <div className="px-4 pb-3">
            <label className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5">
              <Search
                className="h-3.5 w-3.5 text-ink-tertiary"
                strokeWidth={1.6}
              />
              <input
                type="text"
                placeholder="找一个 Chunk…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-tertiary"
              />
            </label>
          </div>

          <ul className="flex-1 overflow-y-auto px-2">
            {sorted.map((it) => (
              <li key={it.id} className="px-2 py-1">
                <BacklogCard item={it} onTogglePin={() => togglePin(it.id)} />
              </li>
            ))}
          </ul>

          <div className="hairline-t px-4 py-3">
            <p className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Drag items → day cell
            </p>
            <p className="mt-1 text-xs text-ink-tertiary">
              拖拽未实装；mock 里点 📌 可切换"不能掉队"状态。
            </p>
          </div>
        </>
      )}
    </aside>
  );
}

function BacklogCard({
  item,
  onTogglePin,
}: {
  item: BacklogItem;
  onTogglePin: () => void;
}) {
  const accent = item.lineColor ? RAIL_COLOR_HEX[item.lineColor] : undefined;
  return (
    <div
      className={clsx(
        'group flex items-start gap-2 rounded-md bg-surface-1 px-2 py-2 transition hover:bg-surface-2',
        item.pinned && 'bg-surface-2',
      )}
    >
      {accent && (
        <span
          aria-hidden
          className="mt-0.5 h-3.5 w-[3px] shrink-0 rounded-sm"
          style={{ background: accent }}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm leading-snug text-ink-primary">
          {item.name}
        </span>
        {item.lineId && (
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Line · {item.lineId.replace('line-', '')}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onTogglePin}
        aria-label={item.pinned ? 'Unpin' : 'Pin'}
        className={clsx(
          'shrink-0 rounded-sm p-1 transition',
          item.pinned
            ? 'text-ink-primary'
            : 'text-ink-tertiary/0 group-hover:text-ink-tertiary hover:text-ink-primary',
        )}
      >
        {item.pinned ? (
          <Pin className="h-3.5 w-3.5 fill-ink-primary" strokeWidth={1.6} />
        ) : (
          <PinOff className="h-3.5 w-3.5" strokeWidth={1.6} />
        )}
      </button>
    </div>
  );
}
