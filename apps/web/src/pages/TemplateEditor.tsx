import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Copy,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  findAffectedFutureAutoTasksForRail,
  purgeFutureAutoTasksForRail,
  useStore,
  type EditSession,
  type Rail,
  type Template as StoreTemplate,
} from '@dayrail/core';
import {
  computeSummary,
  type EditableRail,
  type SampleTemplate,
  type TemplateKey,
} from '@/data/sampleTemplate';
import { FirstRunBanner } from '@/components/FirstRunBanner';
import { EditSessionIndicator } from '@/components/EditSessionIndicator';
import { RailColorPopover } from '@/components/RailColorPopover';
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
// - Gap chips between adjacent Rails; dashed `+ Add Rail` tail row.

export function TemplateEditor() {
  const { templateKey } = useParams<{ templateKey?: string }>();
  const navigate = useNavigate();
  const templatesMap = useStore((s) => s.templates);
  // Pick the effective tab: URL param if it names a real template,
  // otherwise the first built-in (usually `workday`), else the first
  // existing template, else 'workday' as a bare fallback.
  const activeKey: TemplateKey = useMemo(() => {
    if (templateKey && templatesMap[templateKey]) return templateKey;
    const values = Object.values(templatesMap);
    const fallback =
      values.find((t) => t.isDefault) ?? values[0];
    return (fallback?.key ?? 'workday') as TemplateKey;
  }, [templateKey, templatesMap]);
  const setActiveKey = useCallback(
    (next: TemplateKey) => navigate(`/templates/${next}`),
    [navigate],
  );

  // --- session bookkeeping (ERD §5.3.1) ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  const openEditSession = useStore((s) => s.openEditSession);
  const closeEditSession = useStore((s) => s.closeEditSession);
  useEffect(() => {
    let cancelled = false;
    let openedId: string | null = null;
    openEditSession('template-editor').then((s: EditSession) => {
      if (cancelled) {
        void closeEditSession(s.id);
        return;
      }
      openedId = s.id;
      setSessionId(s.id);
    });
    return () => {
      cancelled = true;
      if (openedId) void closeEditSession(openedId);
    };
  }, [openEditSession, closeEditSession]);

  // --- data read from store ---
  // Subscribe to raw maps; derive lists in a useMemo so the selector
  // doesn't create a fresh array reference on every action (which would
  // defeat Zustand's reference-equality short-circuit).
  const railsMap = useStore((s) => s.rails);
  const rails: Rail[] = useMemo(
    () =>
      Object.values(railsMap)
        .filter((r) => r.templateKey === activeKey)
        .sort((a, b) => a.startMinutes - b.startMinutes),
    [railsMap, activeKey],
  );
  const templates: StoreTemplate[] = useMemo(
    () => Object.values(templatesMap),
    [templatesMap],
  );
  const session = useStore((s) =>
    sessionId ? s.sessions[sessionId] : undefined,
  );
  const changeCount = session?.changeCount ?? 0;

  // --- Adapt Rail → EditableRail for the child components which were
  //     designed around the sample-data shape (startMin / endMin). Keeps
  //     the wire-up change contained. ---
  const sortedEditable: EditableRail[] = useMemo(
    () => rails.map(railToEditable),
    [rails],
  );
  const currentTemplate = useMemo<SampleTemplate>(() => {
    const tpl = templates.find((t) => t.key === activeKey);
    return {
      key: activeKey,
      label: tpl?.name ?? activeKey,
      color: (tpl?.color ?? 'slate') as SampleTemplate['color'],
      builtIn: tpl?.isDefault ?? false,
    };
  }, [templates, activeKey]);
  const templatesForTabs: SampleTemplate[] = useMemo(
    () =>
      templates.map((t) => ({
        // Store templates are dynamic (users can add custom keys post-
        // v0.3); the sample-data TemplateKey union is narrower. Casting
        // is safe because TemplateTabs only uses the key as an opaque
        // string for onSelect.
        key: t.key as SampleTemplate['key'],
        label: t.name,
        color: (t.color ?? 'slate') as SampleTemplate['color'],
        builtIn: t.isDefault,
      })),
    [templates],
  );

  const [focusRailId, setFocusRailId] = useState<string | undefined>();
  useEffect(() => {
    if (!focusRailId && sortedEditable[0]) {
      setFocusRailId(sortedEditable[0].id);
    }
  }, [sortedEditable, focusRailId]);

  const summary = useMemo(() => computeSummary(sortedEditable), [sortedEditable]);

  // --- store-backed mutations ---
  const updateRailAction = useStore((s) => s.updateRail);
  const createRailAction = useStore((s) => s.createRail);
  const deleteRailAction = useStore((s) => s.deleteRail);
  const upsertTemplateAction = useStore((s) => s.upsertTemplate);
  const deleteTemplateAction = useStore((s) => s.deleteTemplate);
  const undoEditSessionAction = useStore((s) => s.undoEditSession);
  // Reads used only by destructive actions; kept on the top level so
  // the handler closures don't have to reach back into store.getState.
  const calendarRules = useStore((s) => s.calendarRules);
  const tasks = useStore((s) => s.tasks);

  const mutate = (id: string, patch: Partial<EditableRail>) => {
    const railPatch = editablePatchToRail(patch);
    void updateRailAction(id, railPatch, sessionId ?? undefined);
  };

  // Rail deletion triggers ERD §10.3 purge: every habit bound to this
  // rail loses future pending auto-tasks carrying it. Both the rail
  // delete and the purges share the Template Editor session so undo
  // rolls the whole batch back in one step.
  const del = async (id: string) => {
    const state = useStore.getState();
    const affected = findAffectedFutureAutoTasksForRail(state, id);
    const railName = state.rails[id]?.name ?? id;
    if (affected.length > 0) {
      const ok = window.confirm(
        `删除 rail「${railName}」?\n` +
          `· ${affected.length} 个未开始的 habit auto-task 会被清理\n` +
          `· 已完成/跳过/归档的保留\n` +
          `继续?`,
      );
      if (!ok) return;
    }
    await deleteRailAction(id, sessionId ?? undefined);
    if (affected.length > 0) {
      await purgeFutureAutoTasksForRail(id, sessionId ?? undefined);
    }
  };

  const duplicate = (id: string) => {
    const source = rails.find((r) => r.id === id);
    if (!source) return;
    const dup: Rail = {
      ...source,
      id: `${source.id}-dup-${Date.now()}`,
      name: `${source.name} · 副本`,
    };
    void createRailAction(dup, sessionId ?? undefined);
  };

  // ---- top-right ⋯ menu handlers (ERD §5.4 E1 / E7) ----

  const undoSession = async () => {
    if (!sessionId) return;
    await undoEditSessionAction(sessionId);
    // The session closed inside undoEditSession; open a fresh one so
    // subsequent edits can be grouped again.
    const next = await openEditSession('template-editor');
    setSessionId(next.id);
  };

  const resetToDefault = () => {
    if (!currentTemplate.builtIn) return;
    window.alert('重置到默认 —— v0.3 衔接。当前走 ⤺ 撤销本次编辑 回到 session baseline。');
  };

  const createBlankTemplate = async () => {
    const proposedName = window.prompt('新模板名字？', '新模板');
    if (!proposedName) return;
    const name = proposedName.trim();
    if (!name) return;
    const existingKeys = new Set(templates.map((t) => t.key));
    const newKey = uniqueTemplateKey(name, existingKeys);
    await upsertTemplateAction(
      { key: newKey, name, isDefault: false },
      sessionId ?? undefined,
    );
    navigate(`/templates/${newKey}`);
  };

  const duplicateTemplate = async () => {
    const proposedName = window.prompt(
      `复制「${currentTemplate.label}」到新模板，名字？`,
      `${currentTemplate.label} · 副本`,
    );
    if (!proposedName) return;
    const name = proposedName.trim();
    if (!name) return;
    const existingKeys = new Set(templates.map((t) => t.key));
    const newKey = uniqueTemplateKey(name, existingKeys);
    // Templates + rails under the same sessionId, so 撤销本次编辑 drops
    // both together if the user changes their mind.
    await upsertTemplateAction(
      {
        key: newKey,
        name,
        color: currentTemplate.color,
        isDefault: false,
      },
      sessionId ?? undefined,
    );
    const stamp = Date.now();
    let i = 0;
    for (const source of rails) {
      const dup: Rail = {
        ...source,
        id: `${source.id}-copy-${stamp}-${i}`,
        templateKey: newKey,
      };
      await createRailAction(dup, sessionId ?? undefined);
      i++;
    }
    navigate(`/templates/${newKey}`);
  };

  const changeTemplateColor = async (next: SampleTemplate['color']) => {
    if (next === currentTemplate.color) return;
    const tpl = templates.find((t) => t.key === activeKey);
    if (!tpl) return;
    await upsertTemplateAction(
      { ...tpl, color: next as Rail['color'] },
      sessionId ?? undefined,
    );
  };

  const deleteTemplate = async () => {
    if (currentTemplate.builtIn) return;
    // Safety 1: CalendarRule bindings. We refuse if any rule resolves
    // to this template — deleting would silently change how days
    // render. User has to edit the rule first.
    const boundRules = Object.values(calendarRules).filter((rule) => {
      if (rule.kind === 'cycle') {
        return (rule.value as { mapping: string[] }).mapping.includes(activeKey);
      }
      return (rule.value as { templateKey: string }).templateKey === activeKey;
    });
    if (boundRules.length > 0) {
      window.alert(
        `无法删除「${currentTemplate.label}」：有 ${boundRules.length} 条 Calendar 规则仍指向它，请先在 Calendar 里改规则。`,
      );
      return;
    }
    // Safety 2: scheduled tasks. Live tasks bound to rails under this
    // template would orphan their slot data. Same policy as Cycle
    // template switch — user unschedules first.
    const railIds = new Set(rails.map((r) => r.id));
    const liveBoundTasks = Object.values(tasks).filter(
      (t) =>
        t.status !== 'archived' &&
        t.status !== 'deleted' &&
        t.slot &&
        railIds.has(t.slot.railId),
    );
    if (liveBoundTasks.length > 0) {
      window.alert(
        `无法删除「${currentTemplate.label}」：有 ${liveBoundTasks.length} 条任务仍排在它的 Rail 上，请先在 Tasks 里取消排期。`,
      );
      return;
    }
    const msg = `确定删除模板「${currentTemplate.label}」？\n将一并移除它的 ${rails.length} 条 Rail。本次会话内可用「撤销本次编辑」回滚。`;
    if (!window.confirm(msg)) return;
    await deleteTemplateAction(activeKey, sessionId ?? undefined);
    // Hop to another template so the page doesn't try to render the
    // deleted one. Prefer the default, else the first remaining.
    const remaining = templates.filter((t) => t.key !== activeKey);
    const next = remaining.find((t) => t.isDefault) ?? remaining[0];
    if (next) navigate(`/templates/${next.key}`);
  };

  const fillGap = (startMin: number, endMin: number) => {
    const usedColors = rails.map((r) => r.color);
    const id = `er-gap-${startMin}-${Date.now()}`;
    const color = pickColor(usedColors);
    const rail: Rail = {
      id,
      templateKey: activeKey,
      name: '新 Rail',
      startMinutes: startMin,
      durationMinutes: endMin - startMin,
      color,
      showInCheckin: true,
    };
    void createRailAction(rail, sessionId ?? undefined);
  };

  // Derive the sequence of rows + interleaved gap chips
  const rows: Array<
    | { kind: 'rail'; rail: EditableRail }
    | { kind: 'gap'; startMin: number; endMin: number; key: string }
  > = [];
  for (let i = 0; i < sortedEditable.length; i++) {
    rows.push({ kind: 'rail', rail: sortedEditable[i]! });
    if (i < sortedEditable.length - 1) {
      const cur = sortedEditable[i]!;
      const nxt = sortedEditable[i + 1]!;
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
        onChangeColor={changeTemplateColor}
      />

      <TemplateTabs
        templates={templatesForTabs}
        active={activeKey}
        onSelect={setActiveKey}
        onNew={() => void createBlankTemplate()}
      />

      <SummaryStrip rails={sortedEditable} />

      <div className="pt-6">
        <FirstRunBanner />
      </div>

      {/* Body: left ruler + right main */}
      <div className="flex gap-6 pt-6 pb-16">
        <TimelineRuler
          rails={sortedEditable}
          summary={summary}
          focusRailId={focusRailId}
        />

        <section className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.map((row) =>
            row.kind === 'rail' ? (
              <RailEditCard
                key={row.rail.id}
                rail={row.rail}
                siblings={sortedEditable}
                focused={row.rail.id === focusRailId}
                onFocus={() => setFocusRailId(row.rail.id)}
                onChange={(patch) => mutate(row.rail.id, patch)}
                onDelete={() => {
                  void del(row.rail.id);
                }}
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
  onChangeColor,
}: {
  changeCount: number;
  template: SampleTemplate;
  onUndoSession: () => void;
  onReset: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onChangeColor: (next: SampleTemplate['color']) => void;
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
        <RailColorPopover value={template.color} onChange={onChangeColor} />
        <EditSessionIndicator
          changeCount={changeCount}
          onUndo={canUndo ? onUndoSession : undefined}
        />
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

// Derive a URL-safe template key from a user-entered name; append a
// numeric suffix if it collides with an existing key.
function uniqueTemplateKey(name: string, existing: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'template';
  if (!existing.has(slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

// Picks a color different from both neighbors; fallback to least-used.
function pickColor(used: Rail['color'][]): Rail['color'] {
  const ALL: Rail['color'][] = [
    'sand',
    'sage',
    'slate',
    'brown',
    'amber',
    'teal',
    'pink',
    'grass',
    'indigo',
    'plum',
  ];
  const counts = new Map<Rail['color'], number>();
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

// Rail (store shape) ↔ EditableRail (sample-data shape used by child
// components) adapters. The shape mismatch lives here so RailEditCard /
// TimelineRuler / SummaryStrip stay untouched.

function railToEditable(r: Rail): EditableRail {
  return {
    id: r.id,
    name: r.name,
    subtitle: r.subtitle,
    startMin: r.startMinutes,
    endMin: r.startMinutes + r.durationMinutes,
    color: r.color,
    showInCheckin: r.showInCheckin,
  };
}

function editablePatchToRail(patch: Partial<EditableRail>): Partial<Rail> {
  const next: Partial<Rail> = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.subtitle !== undefined) next.subtitle = patch.subtitle;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.showInCheckin !== undefined) next.showInCheckin = patch.showInCheckin;
  if (patch.startMin !== undefined) next.startMinutes = patch.startMin;
  if (patch.endMin !== undefined && patch.startMin !== undefined) {
    next.durationMinutes = patch.endMin - patch.startMin;
  } else if (patch.endMin !== undefined) {
    // Caller provided end but not start — caller passes current start
    // via a separate update if they want the start to shift; in practice
    // time-pill changes always send both.
    next.durationMinutes = undefined as unknown as number;
  }
  return next;
}
