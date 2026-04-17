import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import {
  SAMPLE_RAILS_BY_TEMPLATE,
  SAMPLE_TEMPLATES,
  computeSummary,
  type EditableRail,
  type TemplateKey,
} from '@/data/sampleTemplate';
import { FirstRunBanner } from '@/components/FirstRunBanner';
import { EditSessionIndicator } from '@/components/EditSessionIndicator';
import { TemplateTabs } from '@/components/TemplateTabs';
import { SummaryStrip } from '@/components/SummaryStrip';
import { TimelineRuler } from '@/components/TimelineRuler';
import { RailEditCard } from '@/components/RailEditCard';
import { GapChip } from '@/components/GapChip';

// ERD §5.4 Template Editor static mock (E1–E7).
//
// - No Save button. Edit session indicator + `⋯` menu at the top-right.
// - Sticky tab bar with 2px Template.color strip; summary strip below.
// - Left sticky 132px TimelineRuler; right main RailEditCard list.
// - Gap chips between adjacent Rails; dashed `+ 添加 Rail` tail row.

export function TemplateEditor() {
  const [activeKey, setActiveKey] = useState<TemplateKey>('workday');
  const [railsByKey, setRailsByKey] = useState(SAMPLE_RAILS_BY_TEMPLATE);
  const [focusRailId, setFocusRailId] = useState<string | undefined>();
  const [changeCount, setChangeCount] = useState(3); // mock "N processing changes"

  const rails = railsByKey[activeKey];
  const sorted = useMemo(
    () => rails.slice().sort((a, b) => a.startMin - b.startMin),
    [rails],
  );
  const summary = useMemo(() => computeSummary(sorted), [sorted]);

  const mutate = (id: string, patch: Partial<EditableRail>) => {
    setRailsByKey((prev) => {
      const next = prev[activeKey].map((r) => (r.id === id ? { ...r, ...patch } : r));
      return { ...prev, [activeKey]: next };
    });
    setChangeCount((c) => c + 1);
  };

  const del = (id: string) => {
    setRailsByKey((prev) => ({
      ...prev,
      [activeKey]: prev[activeKey].filter((r) => r.id !== id),
    }));
    setChangeCount((c) => c + 1);
  };

  const duplicate = (id: string) => {
    setRailsByKey((prev) => {
      const source = prev[activeKey].find((r) => r.id === id);
      if (!source) return prev;
      const dup: EditableRail = {
        ...source,
        id: `${source.id}-dup-${Date.now()}`,
        name: `${source.name} · 副本`,
      };
      return { ...prev, [activeKey]: [...prev[activeKey], dup] };
    });
    setChangeCount((c) => c + 1);
  };

  const fillGap = (startMin: number, endMin: number) => {
    const usedColors = sorted.map((r) => r.color);
    const fresh: EditableRail = {
      id: `er-gap-${startMin}-${Date.now()}`,
      name: '新 Rail',
      startMin,
      endMin,
      color: pickColor(usedColors),
      showInCheckin: true,
      defaultLineId: null,
    };
    setRailsByKey((prev) => ({
      ...prev,
      [activeKey]: [...prev[activeKey], fresh],
    }));
    setChangeCount((c) => c + 1);
  };

  // Derive the sequence of rows + interleaved gap chips
  const rows: Array<
    | { kind: 'rail'; rail: EditableRail }
    | { kind: 'gap'; startMin: number; endMin: number; key: string }
  > = [];
  for (let i = 0; i < sorted.length; i++) {
    rows.push({ kind: 'rail', rail: sorted[i]! });
    if (i < sorted.length - 1) {
      const cur = sorted[i]!;
      const nxt = sorted[i + 1]!;
      if (nxt.startMin > cur.endMin) {
        rows.push({
          kind: 'gap',
          startMin: cur.endMin,
          endMin: nxt.startMin,
          key: `gap-${cur.id}-${nxt.id}`,
        });
      }
    }
  }

  return (
    <div className="flex w-full flex-col pl-10 pr-8 xl:pl-14">
      <TopBar changeCount={changeCount} />

      <TemplateTabs
        templates={SAMPLE_TEMPLATES}
        active={activeKey}
        onSelect={setActiveKey}
        onNew={() => {
          /* static mock — intentionally no-op */
        }}
      />

      <SummaryStrip rails={sorted} />

      <div className="pt-6">
        <FirstRunBanner />
      </div>

      {/* Body: left ruler + right main */}
      <div className="flex gap-6 pt-6 pb-16">
        <TimelineRuler
          rails={sorted}
          summary={summary}
          focusRailId={focusRailId}
        />

        <section className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.map((row) =>
            row.kind === 'rail' ? (
              <RailEditCard
                key={row.rail.id}
                rail={row.rail}
                siblings={sorted}
                focused={row.rail.id === focusRailId}
                onFocus={() => setFocusRailId(row.rail.id)}
                onChange={(patch) => mutate(row.rail.id, patch)}
                onDelete={() => del(row.rail.id)}
                onDuplicate={() => duplicate(row.rail.id)}
              />
            ) : (
              <GapChip
                key={row.key}
                startMin={row.startMin}
                endMin={row.endMin}
                onFill={() => fillGap(row.startMin, row.endMin)}
              />
            ),
          )}

          <AddRailRow onAdd={() => fillGap(summary.lastMin, summary.lastMin + 30)} />
        </section>
      </div>
    </div>
  );
}

function TopBar({ changeCount }: { changeCount: number }) {
  return (
    <header className="sticky top-0 z-40 -mx-10 flex h-[52px] items-center justify-between gap-4 bg-surface-0 px-10">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          Template Editor
        </span>
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary/60">
          §5.4
        </span>
      </div>
      <div className="flex items-center gap-3">
        <EditSessionIndicator changeCount={changeCount} />
        <button
          type="button"
          aria-label="Template menu"
          className="rounded-sm p-1 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          title="撤销本次编辑 / 重置到默认 / 复制新建 / 删除此模板"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}

function AddRailRow({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="mt-1 flex items-center justify-center gap-2 rounded-md border border-dashed border-ink-tertiary/40 bg-transparent px-4 py-3 text-sm text-ink-tertiary transition hover:border-ink-secondary hover:bg-surface-1 hover:text-ink-secondary"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
      添加 Rail
    </button>
  );
}

// Picks a color different from both neighbors; fallback to least-used.
function pickColor(used: EditableRail['color'][]): EditableRail['color'] {
  const ALL: EditableRail['color'][] = [
    'sand',
    'sage',
    'olive',
    'slate',
    'mauve',
    'brown',
    'amber',
    'teal',
    'pink',
    'gray',
  ];
  const counts = new Map<EditableRail['color'], number>();
  for (const c of ALL) counts.set(c, 0);
  for (const c of used) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = ALL[0]!;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of ALL) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}
