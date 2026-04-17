import { useMemo, useState } from 'react';
import {
  Copy,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  SAMPLE_RAILS_BY_TEMPLATE,
  SAMPLE_TEMPLATES,
  computeSummary,
  type EditableRail,
  type SampleTemplate,
  type TemplateKey,
} from '@/data/sampleTemplate';
import { FirstRunBanner } from '@/components/FirstRunBanner';
import { EditSessionIndicator } from '@/components/EditSessionIndicator';
import { TemplateTabs } from '@/components/TemplateTabs';
import { SummaryStrip } from '@/components/SummaryStrip';
import { TimelineRuler } from '@/components/TimelineRuler';
import { RailEditCard } from '@/components/RailEditCard';
import { GapChip } from '@/components/GapChip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';

// ERD §5.4 Template Editor static mock (E1–E7).
//
// - No Save button. Edit session indicator + `⋯` menu at the top-right.
// - Sticky tab bar with 2px Template.color strip; summary strip below.
// - Left sticky 132px TimelineRuler; right main RailEditCard list.
// - Gap chips between adjacent Rails; dashed `+ 添加 Rail` tail row.

export function TemplateEditor() {
  const [activeKey, setActiveKey] = useState<TemplateKey>('workday');
  const [railsByKey, setRailsByKey] = useState(SAMPLE_RAILS_BY_TEMPLATE);
  const rails = railsByKey[activeKey];
  const sorted = useMemo(
    () => rails.slice().sort((a, b) => a.startMin - b.startMin),
    [rails],
  );
  // Focus arrow defaults to the FIRST Rail so the ruler's `▶` is visible
  // on initial render — teaches users that the arrow tracks focus without
  // requiring them to hover first.
  const [focusRailId, setFocusRailId] = useState<string | undefined>(
    sorted[0]?.id,
  );
  const [changeCount, setChangeCount] = useState(3); // mock "N processing changes"

  const currentTemplate = SAMPLE_TEMPLATES.find((t) => t.key === activeKey)!;
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

  // ---- top-right ⋯ menu handlers (ERD §5.4 E1 / E7) ----

  const undoSession = () => {
    // Static mock: "session baseline" = the SAMPLE seeds. A real impl
    // would replay inverse mutations from §5.3.1 Edit Session log.
    setRailsByKey((prev) => ({
      ...prev,
      [activeKey]: SAMPLE_RAILS_BY_TEMPLATE[activeKey],
    }));
    setChangeCount(0);
  };

  const resetToDefault = () => {
    if (!currentTemplate.builtIn) return;
    setRailsByKey((prev) => ({
      ...prev,
      [activeKey]: SAMPLE_RAILS_BY_TEMPLATE[activeKey],
    }));
    setChangeCount((c) => c + 1);
  };

  const duplicateTemplate = () => {
    // Static mock: no state for user-created templates yet. Real impl
    // clones the current template into a new key, switches tab.
    window.alert(
      `「${currentTemplate.label} · 副本」—— 新模板已创建并切换到新 tab。\n(静态 mock：未真的持久化)`,
    );
  };

  const deleteTemplate = () => {
    if (currentTemplate.builtIn) return;
    const cycleDayCount = 0; // real impl counts CycleDay refs to this template
    const msg =
      cycleDayCount > 0
        ? `删除「${currentTemplate.label}」\n将有 ${cycleDayCount} 天落回默认工作日模板。确认？`
        : `删除「${currentTemplate.label}」？此操作写入编辑会话，可以 ⤺ 撤销本次编辑 回退。`;
    if (window.confirm(msg)) {
      window.alert('（静态 mock：未真的删除）');
    }
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
      <TopBar
        changeCount={changeCount}
        template={currentTemplate}
        onUndoSession={undoSession}
        onReset={resetToDefault}
        onDuplicate={duplicateTemplate}
        onDelete={deleteTemplate}
      />

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

function TopBar({
  changeCount,
  template,
  onUndoSession,
  onReset,
  onDuplicate,
  onDelete,
}: {
  changeCount: number;
  template: SampleTemplate;
  onUndoSession: () => void;
  onReset: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const canUndo = changeCount > 0;
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Template menu"
              className="rounded-sm p-1 text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary data-[state=open]:bg-surface-2 data-[state=open]:text-ink-primary"
              title="模板操作"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuLabel>本次会话</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={!canUndo}
              onSelect={onUndoSession}
            >
              <Undo2
                className="h-3.5 w-3.5 text-ink-tertiary"
                strokeWidth={1.8}
              />
              <span className="flex-1">撤销本次编辑</span>
              <span className="font-mono text-2xs text-ink-tertiary">
                {canUndo ? `${changeCount} 处` : '无改动'}
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuLabel>模板</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={!template.builtIn}
              onSelect={onReset}
            >
              <RotateCcw
                className="h-3.5 w-3.5 text-ink-tertiary"
                strokeWidth={1.8}
              />
              <span className="flex-1">重置到默认</span>
              {!template.builtIn && (
                <span className="font-mono text-2xs text-ink-tertiary">
                  仅内置
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy
                className="h-3.5 w-3.5 text-ink-tertiary"
                strokeWidth={1.8}
              />
              <span className="flex-1">复制新建</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={template.builtIn}
              onSelect={onDelete}
              destructive
            >
              <Trash2
                className="h-3.5 w-3.5 text-ink-tertiary"
                strokeWidth={1.8}
              />
              <span className="flex-1">删除此模板</span>
              {template.builtIn && (
                <span className="font-mono text-2xs text-ink-tertiary">
                  内置禁删
                </span>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
