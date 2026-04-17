import { clsx } from 'clsx';
import { Plus } from 'lucide-react';
import type { SampleTemplate, TemplateKey } from '@/data/sampleTemplate';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.4 E3: sticky horizontal tab bar. Each tab = template name + a
// 2px under-strip in that template's Template.color (3px when active).
// Dashed `+ New template` tab at tail. Overflow scrolls horizontally
// with a faded mask.

interface Props {
  templates: SampleTemplate[];
  active: TemplateKey;
  onSelect: (key: TemplateKey) => void;
  onNew: () => void;
}

export function TemplateTabs({ templates, active, onSelect, onNew }: Props) {
  return (
    <div
      aria-label="Template tabs"
      className="sticky top-0 z-30 -mx-10 overflow-x-auto bg-surface-0"
    >
      <ul className="flex min-w-full items-end gap-0 px-10 pt-4">
        {templates.map((t) => {
          const isActive = t.key === active;
          const stripColor = RAIL_COLOR_HEX[t.color];
          return (
            <li key={t.key} className="flex flex-col items-stretch">
              <button
                type="button"
                onClick={() => onSelect(t.key)}
                className={clsx(
                  'rounded-t-sm px-4 pb-2 pt-1 text-sm transition',
                  isActive
                    ? 'font-medium text-ink-primary'
                    : 'text-ink-secondary hover:text-ink-primary',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t.label}
                  {!t.builtIn && (
                    <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                      custom
                    </span>
                  )}
                </span>
              </button>
              <span
                aria-hidden
                className={clsx('transition-all', isActive ? 'h-[3px]' : 'h-[2px]')}
                style={{ background: stripColor, opacity: isActive ? 1 : 0.6 }}
              />
            </li>
          );
        })}

        {/* `+ New template` dashed tab */}
        <li className="flex flex-col items-stretch pl-1">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center gap-1.5 rounded-t-sm border border-dashed border-ink-tertiary/40 px-3 pb-2 pt-1 text-sm text-ink-tertiary transition hover:border-ink-secondary hover:text-ink-secondary"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
            新建模板
          </button>
          <span aria-hidden className="h-[2px]" />
        </li>

        {/* Filler that draws the sticky baseline after all tabs */}
        <li className="flex-1 self-end">
          <span aria-hidden className="block h-[2px] bg-surface-2" />
        </li>
      </ul>
    </div>
  );
}
