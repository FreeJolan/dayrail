import { useId, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { GripVertical, Pencil, Plus, X } from 'lucide-react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  listHolidayRegions,
  getHolidayDatasetDisplayName,
  useStore,
  type CalendarRule,
  type CalendarRuleCycle,
  type CalendarRuleDateRange,
  type CalendarRuleExternalEvent,
  type CalendarRuleSingleDate,
  type CalendarRuleWeekday,
  type ExternalEventMatchKind,
  type Template,
} from '@dayrail/core';
import type { RailColor } from '@/data/sample';
import { RAIL_COLOR_HEX } from './railColors';
import {
  EffectiveFromPicker,
  resolveEffectiveFromValue,
  type EffectiveFromValue,
} from './EffectiveFromPicker';

// ERD §5.4 Advanced Calendar Rules drawer (v0.3 live).
// Four sections, each with list + create form + in-place edit + delete.
// Drawer does NOT use the §5.3.1 Edit Session — every action is
// immediate-apply, matching Cycle View's stance (but Cycle View has
// session-undo as a separate mechanism; rules changes are considered
// settings-tier and walk back per-row via Remove / re-Edit).

interface Props {
  open: boolean;
  onClose: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarRulesDrawer({ open, onClose }: Props) {
  const calendarRules = useStore((s) => s.calendarRules);
  const templates = useStore((s) => s.templates);
  const userProfile = useStore((s) => s.userProfile);

  // §10.5 Phase 4 · drawer-wide picker. Same primitive as the
  // Template Editor; every rule edit / removal in this drawer threads
  // the resolved `effectiveFrom` through to the writer.
  const [effectiveFromValue, setEffectiveFromValue] =
    useState<EffectiveFromValue>({ mode: 'today' });
  const effectiveFrom = useMemo(
    () => resolveEffectiveFromValue(effectiveFromValue),
    [effectiveFromValue],
  );

  const templatesList = useMemo(
    () => Object.values(templates).sort((a, b) => a.key.localeCompare(b.key)),
    [templates],
  );

  // v0.8.1 — kind-specific buckets are no longer needed at the drawer
  // level; the single PriorityOrderSection consumes Object.values()
  // directly. The legacy per-kind section components (SingleDateSection
  // etc.) remain in the file but are unreferenced, kept around as a
  // reference for the unified row + form patterns until a future
  // cleanup commit.

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink-primary/10 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-label="Advanced calendar rules"
        className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col overflow-hidden bg-surface-0 shadow-[0_0_0_0.5px_theme(colors.hairline),-12px_0_32px_-16px_rgba(0,0,0,0.2)] animate-[popoverIn_200ms_cubic-bezier(0.22,0.61,0.36,1)]"
      >
        <header className="flex items-center justify-between px-5 pt-5">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Calendar · Advanced
            </span>
            <h2 className="text-lg font-medium text-ink-primary">
              高级日历规则
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>

        <div className="px-5 pt-3 text-xs text-ink-tertiary">
          优先级由顶部「整体优先级」拖拽排序决定 ·
          <span className="text-ink-secondary">v0.8.1 起</span>。改动即时落库；
          点规则右侧 ✎ 可原地编辑。
        </div>

        <div className="flex items-center justify-end px-5 pt-3">
          <EffectiveFromPicker
            value={effectiveFromValue}
            onChange={setEffectiveFromValue}
          />
        </div>

        <div className="mt-4 flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6">
          {/* v0.8.1 — single unified rules list. Drag to reorder
              priority, ✎ to edit inline, ✕ to delete, "+ 添加规则"
              at the bottom to create a new rule of any kind. The
              older per-kind sections (SingleDateSection /
              DateRangeSection / CycleSection / WeekdaySection /
              ExternalEventSection) are no longer rendered — every
              CRUD op goes through this section. */}
          <PriorityOrderSection
            rules={Object.values(calendarRules)}
            calendarRuleOrder={userProfile?.calendarRuleOrder ?? []}
            templates={templatesList}
            effectiveFrom={effectiveFrom}
          />
        </div>

        <footer className="hairline-t flex items-center justify-between px-5 py-3 text-xs text-ink-tertiary">
          <span>ERD §5.4 · v0.3 live</span>
          <span>关闭 = 即生效</span>
        </footer>
      </aside>
    </>
  );
}

function byCreatedDesc(a: CalendarRule, b: CalendarRule): number {
  return b.createdAt - a.createdAt;
}

function SectionShell({
  title,
  subtitle,
  addCTA,
  onAdd,
  children,
}: {
  title: string;
  subtitle?: string;
  addCTA?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-secondary">
            {title}
          </span>
          {subtitle && (
            <span className="text-xs text-ink-tertiary">{subtitle}</span>
          )}
        </div>
        {addCTA && onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink-tertiary/40 px-2 py-1 text-xs text-ink-tertiary transition hover:border-ink-secondary hover:text-ink-secondary"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
            {addCTA}
          </button>
        )}
      </header>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md bg-surface-1 px-3 py-2 text-center text-xs text-ink-tertiary">
      {text}
    </div>
  );
}

function TemplateTag({
  templates,
  templateKey,
}: {
  templates: Template[];
  templateKey: string;
}) {
  const t = templates.find((x) => x.key === templateKey);
  const hex = t?.color ? RAIL_COLOR_HEX[t.color as RailColor] : undefined;
  return (
    <span
      className="rounded-sm px-2 py-0.5 text-xs"
      style={{
        background: hex ? `${hex}22` : undefined,
        color: hex ?? undefined,
      }}
    >
      {t?.name ?? templateKey}
    </span>
  );
}

function RemoveButton({
  id,
  effectiveFrom,
}: {
  id: string;
  effectiveFrom: string | undefined;
}) {
  const removeCalendarRule = useStore((s) => s.removeCalendarRule);
  return (
    <button
      type="button"
      aria-label="Remove"
      onClick={() => void removeCalendarRule(id, effectiveFrom)}
      className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
    >
      <X className="h-3 w-3" strokeWidth={1.8} />
    </button>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Edit"
      onClick={onClick}
      className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
    >
      <Pencil className="h-3 w-3" strokeWidth={1.8} />
    </button>
  );
}

// ------- Single-date section -------

function SingleDateSection({
  rules,
  templates,
  effectiveFrom,
}: {
  rules: CalendarRule[];
  templates: Template[];
  effectiveFrom: string | undefined;
}) {
  // Inline-edit pattern matched to DateRangeSection / CycleSection /
  // WeekdaySection. `null` = closed; `'new'` = create; `ruleId` = edit
  // existing. Single-slot state keeps only one form open at a time.
  // The rule id is date-derived (`singleDateRuleId(date)`), so edit
  // mode locks the date and lets the user only change the template
  // (same constraint pattern as WeekdaySection locking templateKey).
  const [formMode, setFormMode] = useState<null | 'new' | string>(null);
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  return (
    <SectionShell
      title="单日覆盖"
      subtitle="对某一天单独指定模板；日历里点日期弹 popover 也写这一类"
      addCTA="新建单日"
      onAdd={() => setFormMode((v) => (v === 'new' ? null : 'new'))}
    >
      {formMode === 'new' && (
        <SingleDateForm
          templates={templates}
          onSubmit={async (date, tk) => {
            await overrideCycleDay(date, tk, undefined, effectiveFrom);
            setFormMode(null);
          }}
          onCancel={() => setFormMode(null)}
        />
      )}
      {rules.length === 0 && formMode !== 'new' ? (
        <EmptyHint text="暂无单日覆盖" />
      ) : (
        rules.map((r) => {
          const v = r.value as CalendarRuleSingleDate;
          if (formMode === r.id) {
            return (
              <SingleDateForm
                key={r.id}
                templates={templates}
                initial={{ date: v.date, templateKey: v.templateKey }}
                dateLocked
                onSubmit={async (date, tk) => {
                  await overrideCycleDay(date, tk, undefined, effectiveFrom);
                  setFormMode(null);
                }}
                onCancel={() => setFormMode(null)}
              />
            );
          }
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-1.5"
            >
              <span className="font-mono text-xs tabular-nums text-ink-primary">
                {v.date}
              </span>
              <div className="flex items-center gap-2">
                <TemplateTag templates={templates} templateKey={v.templateKey} />
                <EditButton onClick={() => setFormMode(r.id)} />
                <RemoveButton id={r.id} effectiveFrom={effectiveFrom} />
              </div>
            </div>
          );
        })
      )}
    </SectionShell>
  );
}

function SingleDateForm({
  templates,
  initial,
  dateLocked,
  onSubmit,
  onCancel,
}: {
  templates: Template[];
  initial?: { date: string; templateKey: string };
  /** Lock the date input. Used in edit mode — the rule id is
   *  date-derived (`singleDateRuleId(date)`), so changing the date
   *  would create a NEW rule rather than edit the existing one.
   *  Edit mode forces date-fixed; users who want a different date
   *  delete the rule and create a new one. */
  dateLocked?: boolean;
  onSubmit: (date: string, templateKey: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(
    () => initial?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [templateKey, setTemplateKey] = useState<string>(
    initial?.templateKey ?? templates[0]?.key ?? '',
  );
  const submit = () => {
    if (!date || !templateKey) return;
    void onSubmit(date, templateKey);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-1 p-3">
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">日期</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={dateLocked}
          className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 font-mono text-xs text-ink-primary outline-none focus:border-ink-secondary disabled:opacity-60"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">模板</span>
        <TemplateSelect
          templates={templates}
          value={templateKey}
          onChange={setTemplateKey}
        />
      </label>
      <FormActions onCancel={onCancel} onSubmit={submit} />
    </div>
  );
}

// ------- Date-range section -------

function DateRangeSection({
  rules,
  templates,
  effectiveFrom,
}: {
  rules: CalendarRule[];
  templates: Template[];
  effectiveFrom: string | undefined;
}) {
  // `null` = closed; `'new'` = create form; `ruleId` = edit form for
  // that specific row. Single-slot state keeps the drawer from
  // sprouting multiple open forms at once.
  const [formMode, setFormMode] = useState<null | 'new' | string>(null);
  const upsertDateRangeRule = useStore((s) => s.upsertDateRangeRule);
  const editingRule = rules.find((r) => r.id === formMode);
  return (
    <SectionShell
      title="日期范围覆盖"
      subtitle="例：考研冲刺周、出差段、长假"
      addCTA="新建范围"
      onAdd={() => setFormMode((v) => (v === 'new' ? null : 'new'))}
    >
      {formMode === 'new' && (
        <DateRangeForm
          templates={templates}
          onSubmit={async (opts) => {
            await upsertDateRangeRule({
              ...opts,
              ...(effectiveFrom && { effectiveFrom }),
            });
            setFormMode(null);
          }}
          onCancel={() => setFormMode(null)}
        />
      )}
      {rules.length === 0 && formMode !== 'new' ? (
        <EmptyHint text="暂无范围覆盖" />
      ) : (
        rules.map((r) => {
          const v = r.value as CalendarRuleDateRange;
          if (editingRule?.id === r.id) {
            return (
              <DateRangeForm
                key={r.id}
                templates={templates}
                initial={{
                  from: v.from,
                  to: v.to,
                  templateKey: v.templateKey,
                  label: v.label,
                }}
                onSubmit={async (opts) => {
                  await upsertDateRangeRule({
                    ...opts,
                    id: r.id,
                    ...(effectiveFrom && { effectiveFrom }),
                  });
                  setFormMode(null);
                }}
                onCancel={() => setFormMode(null)}
              />
            );
          }
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-2"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                {v.label && (
                  <span className="truncate text-sm text-ink-primary">
                    {v.label}
                  </span>
                )}
                <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
                  {v.from} → {v.to}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <TemplateTag templates={templates} templateKey={v.templateKey} />
                <EditButton onClick={() => setFormMode(r.id)} />
                <RemoveButton id={r.id} effectiveFrom={effectiveFrom} />
              </div>
            </div>
          );
        })
      )}
    </SectionShell>
  );
}

function DateRangeForm({
  templates,
  initial,
  onSubmit,
  onCancel,
}: {
  templates: Template[];
  initial?: {
    from: string;
    to: string;
    templateKey: string;
    label?: string;
  };
  onSubmit: (opts: {
    from: string;
    to: string;
    templateKey: string;
    label?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(initial?.from ?? today);
  const [to, setTo] = useState(initial?.to ?? today);
  const [templateKey, setTemplateKey] = useState<string>(
    initial?.templateKey ?? templates[0]?.key ?? '',
  );
  const [label, setLabel] = useState(initial?.label ?? '');
  const submit = () => {
    if (!from || !to || !templateKey) return;
    if (from > to) return;
    void onSubmit({
      from,
      to,
      templateKey,
      ...(label.trim() && { label: label.trim() }),
    });
  };
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-1 p-3">
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">起始</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 font-mono text-xs text-ink-primary outline-none focus:border-ink-secondary"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">结束</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 font-mono text-xs text-ink-primary outline-none focus:border-ink-secondary"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">模板</span>
        <TemplateSelect
          templates={templates}
          value={templateKey}
          onChange={setTemplateKey}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">备注</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例：冲刺周"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
        />
      </label>
      <FormActions onCancel={onCancel} onSubmit={submit} />
    </div>
  );
}

// ------- Cycle section -------

function CycleSection({
  rules,
  templates,
  effectiveFrom,
}: {
  rules: CalendarRule[];
  templates: Template[];
  effectiveFrom: string | undefined;
}) {
  const [formMode, setFormMode] = useState<null | 'new' | string>(null);
  const upsertCycleRule = useStore((s) => s.upsertCycleRule);
  return (
    <SectionShell
      title="循环规则"
      subtitle="非 7 天节奏（倒班、自定义周期）"
      addCTA="新建循环"
      onAdd={() => setFormMode((v) => (v === 'new' ? null : 'new'))}
    >
      {formMode === 'new' && (
        <CycleForm
          templates={templates}
          onSubmit={async (opts) => {
            await upsertCycleRule({
              ...opts,
              ...(effectiveFrom && { effectiveFrom }),
            });
            setFormMode(null);
          }}
          onCancel={() => setFormMode(null)}
        />
      )}
      {rules.length === 0 && formMode !== 'new' ? (
        <EmptyHint text="暂无循环规则" />
      ) : (
        rules.map((r) => {
          const v = r.value as CalendarRuleCycle;
          if (formMode === r.id) {
            return (
              <CycleForm
                key={r.id}
                templates={templates}
                initial={{
                  cycleLength: v.cycleLength,
                  anchor: v.anchor,
                  mapping: v.mapping,
                }}
                onSubmit={async (opts) => {
                  await upsertCycleRule({
                    ...opts,
                    id: r.id,
                    ...(effectiveFrom && { effectiveFrom }),
                  });
                  setFormMode(null);
                }}
                onCancel={() => setFormMode(null)}
              />
            );
          }
          return (
            <div
              key={r.id}
              className="flex flex-col gap-1 rounded-md bg-surface-1 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  {v.cycleLength} 天循环 · anchor {v.anchor}
                </span>
                <div className="flex items-center gap-1">
                  <EditButton onClick={() => setFormMode(r.id)} />
                  <RemoveButton id={r.id} effectiveFrom={effectiveFrom} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {v.mapping.map((tk, i) => (
                  <span
                    key={`${r.id}-${i}`}
                    className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-2xs"
                  >
                    <span className="font-mono tabular-nums text-ink-tertiary">
                      {i + 1}
                    </span>
                    <TemplateTag templates={templates} templateKey={tk} />
                  </span>
                ))}
              </div>
            </div>
          );
        })
      )}
    </SectionShell>
  );
}

function CycleForm({
  templates,
  initial,
  onSubmit,
  onCancel,
}: {
  templates: Template[];
  initial?: {
    cycleLength: number;
    anchor: string;
    mapping: string[];
  };
  onSubmit: (opts: {
    cycleLength: number;
    anchor: string;
    mapping: string[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const defaultTpl = templates[0]?.key ?? '';
  const [cycleLength, setCycleLength] = useState(
    initial?.cycleLength ?? 7,
  );
  const [anchor, setAnchor] = useState(
    () => initial?.anchor ?? new Date().toISOString().slice(0, 10),
  );
  const [mapping, setMapping] = useState<string[]>(
    () =>
      initial?.mapping
        ? [...initial.mapping]
        : Array.from({ length: 7 }, () => defaultTpl),
  );

  const updateLength = (raw: string) => {
    const n = Math.max(1, Math.min(60, Number.parseInt(raw, 10) || 1));
    setCycleLength(n);
    setMapping((prev) => {
      if (prev.length === n) return prev;
      if (prev.length > n) return prev.slice(0, n);
      return [
        ...prev,
        ...Array.from({ length: n - prev.length }, () => defaultTpl),
      ];
    });
  };

  const submit = () => {
    if (!anchor || cycleLength <= 0) return;
    if (mapping.some((m) => !m)) return;
    void onSubmit({ cycleLength, anchor, mapping });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-1 p-3">
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">长度</span>
        <input
          type="number"
          value={cycleLength}
          min={1}
          max={60}
          onChange={(e) => updateLength(e.target.value)}
          className="h-7 w-20 rounded-sm border border-hairline/60 bg-surface-0 px-2 font-mono text-xs tabular-nums text-ink-primary outline-none focus:border-ink-secondary"
        />
        <span className="text-2xs text-ink-tertiary">天</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">anchor</span>
        <input
          type="date"
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
          className="h-7 rounded-sm border border-hairline/60 bg-surface-0 px-2 font-mono text-xs text-ink-primary outline-none focus:border-ink-secondary"
        />
        <span className="text-2xs text-ink-tertiary">第 1 天对应这一天</span>
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-secondary">每天模板</span>
        <div className="flex flex-col gap-1">
          {mapping.map((tk, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-sm bg-surface-2 px-2 py-1"
            >
              <span className="w-8 font-mono text-2xs tabular-nums text-ink-tertiary">
                #{i + 1}
              </span>
              <TemplateSelect
                templates={templates}
                value={tk}
                onChange={(next) =>
                  setMapping((prev) =>
                    prev.map((x, idx) => (idx === i ? next : x)),
                  )
                }
              />
            </div>
          ))}
        </div>
      </div>
      <FormActions onCancel={onCancel} onSubmit={submit} />
    </div>
  );
}

// ------- Weekday section -------

function WeekdaySection({
  rules,
  templates,
  effectiveFrom,
}: {
  rules: CalendarRule[];
  templates: Template[];
  effectiveFrom: string | undefined;
}) {
  const [formMode, setFormMode] = useState<null | 'new' | string>(null);
  const upsertWeekdayRule = useStore((s) => s.upsertWeekdayRule);
  const usedTemplateKeys = useMemo(
    () =>
      new Set(
        rules.map((r) => (r.value as CalendarRuleWeekday).templateKey),
      ),
    [rules],
  );
  const available = useMemo(
    () => templates.filter((t) => !usedTemplateKeys.has(t.key)),
    [templates, usedTemplateKeys],
  );
  return (
    <SectionShell
      title="星期规则"
      subtitle="按周几兜底（没有更高优先级的规则时用）"
      addCTA={available.length > 0 ? '新建星期规则' : undefined}
      onAdd={
        available.length > 0
          ? () => setFormMode((v) => (v === 'new' ? null : 'new'))
          : undefined
      }
    >
      {formMode === 'new' && available.length > 0 && (
        <WeekdayForm
          templates={available}
          onSubmit={async (tk, weekdays) => {
            await upsertWeekdayRule(tk, weekdays, effectiveFrom);
            setFormMode(null);
          }}
          onCancel={() => setFormMode(null)}
        />
      )}
      {rules.length === 0 && formMode !== 'new' ? (
        <EmptyHint text="暂无星期规则 · 解析会回退到内置启发" />
      ) : (
        rules.map((r) => {
          const v = r.value as CalendarRuleWeekday;
          if (formMode === r.id) {
            // Edit: template is fixed (id is keyed on templateKey), so
            // the form only offers its own template in the select.
            const ownTemplate = templates.filter((t) => t.key === v.templateKey);
            return (
              <WeekdayForm
                key={r.id}
                templates={ownTemplate}
                initial={{
                  templateKey: v.templateKey,
                  weekdays: v.weekdays,
                }}
                onSubmit={async (tk, weekdays) => {
                  await upsertWeekdayRule(tk, weekdays, effectiveFrom);
                  setFormMode(null);
                }}
                onCancel={() => setFormMode(null)}
              />
            );
          }
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <TemplateTag templates={templates} templateKey={v.templateKey} />
                <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                  {v.weekdays
                    .map((d) => WEEKDAY_LABELS[d])
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <EditButton onClick={() => setFormMode(r.id)} />
                <RemoveButton id={r.id} effectiveFrom={effectiveFrom} />
              </div>
            </div>
          );
        })
      )}
    </SectionShell>
  );
}

function WeekdayForm({
  templates,
  initial,
  onSubmit,
  onCancel,
}: {
  templates: Template[];
  initial?: {
    templateKey: string;
    weekdays: number[];
  };
  onSubmit: (templateKey: string, weekdays: number[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [templateKey, setTemplateKey] = useState<string>(
    initial?.templateKey ?? templates[0]?.key ?? '',
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    initial?.weekdays ? [...initial.weekdays] : [1, 2, 3, 4, 5],
  );
  const toggle = (d: number) =>
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  const submit = () => {
    if (!templateKey) return;
    if (weekdays.length === 0) return;
    void onSubmit(templateKey, weekdays);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-1 p-3">
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <span className="w-16">模板</span>
        <TemplateSelect
          templates={templates}
          value={templateKey}
          onChange={setTemplateKey}
        />
      </label>
      <div className="flex items-center gap-2">
        <span className="w-16 text-xs text-ink-secondary">周几</span>
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_LABELS.map((label, d) => {
            const active = weekdays.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                className={clsx(
                  'rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-widest transition',
                  active
                    ? 'bg-ink-primary text-surface-0'
                    : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <FormActions onCancel={onCancel} onSubmit={submit} />
    </div>
  );
}

// ------- Primitives -------

function TemplateSelect({
  templates,
  value,
  onChange,
}: {
  templates: Template[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-1.5 text-xs text-ink-primary outline-none focus:border-ink-secondary"
    >
      {templates.map((t) => (
        <option key={t.key} value={t.key}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function FormActions({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-2 py-1 text-xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        取消
      </button>
      <button
        type="button"
        onClick={onSubmit}
        className="rounded-md bg-ink-primary px-2 py-1 text-xs text-surface-0 transition hover:bg-ink-primary/90"
      >
        保存
      </button>
    </div>
  );
}

// ============ v0.8.1 priority-order section ============
//
// Single ordered list across all rule kinds. Drag-to-reorder writes
// the new order to `userProfile.calendarRuleOrder` via the new
// `setCalendarRuleOrder` action. Rules NOT yet in the user's order
// list (legacy v0.8.0- rules with numeric priority) are appended in
// priority desc + createdAt desc order — same fallback the resolver
// uses, so the drawer's display matches what actually applies.
//
// Drag implementation uses HTML5 native drag-and-drop API. With
// typical N=3-8 rules per user, no library is needed; every drag
// transitions in-place and a final drop fires
// `setCalendarRuleOrder` with the full new id list.

function PriorityOrderSection({
  rules,
  calendarRuleOrder,
  templates,
  effectiveFrom,
}: {
  rules: CalendarRule[];
  calendarRuleOrder: string[];
  templates: Template[];
  effectiveFrom: string | undefined;
}) {
  const setCalendarRuleOrder = useStore((s) => s.setCalendarRuleOrder);
  const sortedIds = useMemo(() => {
    const idSet = new Set(rules.map((r) => r.id));
    const inOrder = calendarRuleOrder.filter((id) => idSet.has(id));
    const inOrderSet = new Set(inOrder);
    const outOfOrder = rules
      .filter((r) => !inOrderSet.has(r.id))
      .sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          b.createdAt - a.createdAt,
      )
      .map((r) => r.id);
    return [...inOrder, ...outOfOrder];
  }, [rules, calendarRuleOrder]);

  const ruleById = useMemo(() => {
    const m = new Map<string, CalendarRule>();
    for (const r of rules) m.set(r.id, r);
    return m;
  }, [rules]);

  // Single-slot transient state — at most one row's edit form OR the
  // add picker is open at any time. Keeps the drawer tidy even with
  // 10+ rules.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingKind, setAddingKind] = useState<CalendarRule['kind'] | null>(
    null,
  );

  // Drag-and-drop via dnd-kit (PR #43, v0.9.11 migration). Replaces
  // the hand-rolled HTML5 implementation that had to manually deal
  // with drop-index math, container deadzones, and WKWebView's
  // unreliable `dragend` semantics. dnd-kit uses Pointer Events under
  // the hood — works identically across Tauri webview / PWA, has
  // built-in keyboard support (Space to pick up, arrows to move,
  // Space to drop), and the SortableContext component computes the
  // drop position itself based on `closestCenter` collision.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Tiny activation distance so a click on the row's Edit / Remove
      // buttons doesn't accidentally start a drag. 4px is enough to
      // distinguish "user clicked" from "user dragged".
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sortedIds.indexOf(String(active.id));
    const newIdx = sortedIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(sortedIds, oldIdx, newIdx);
    void setCalendarRuleOrder(next);
  };

  return (
    <SectionShell
      title="规则列表"
      subtitle="拖拽排序优先级 · 上面的优先 · 点 ✎ 编辑 · 点底部 + 添加新规则"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-1.5 py-2">
            {sortedIds.length === 0 && addingKind === null ? (
              <EmptyHint text="暂无规则。点下方「+ 添加规则」开始。" />
            ) : (
              sortedIds.map((id) => {
                const r = ruleById.get(id);
                if (!r) return null;
                if (editingId === id) {
                  return (
                    <RuleEditCard
                      key={id}
                      rule={r}
                      templates={templates}
                      effectiveFrom={effectiveFrom}
                      onClose={() => setEditingId(null)}
                    />
                  );
                }
                return (
                  <SortableRuleRow
                    key={id}
                    id={id}
                    rule={r}
                    templates={templates}
                    effectiveFrom={effectiveFrom}
                    onEdit={() => setEditingId(id)}
                  />
                );
              })
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add-rule entry: kind picker → kind-specific form below. */}
      {addingKind === null ? (
        <AddRulePicker onPick={(kind) => setAddingKind(kind)} />
      ) : (
        <RuleAddCard
          kind={addingKind}
          templates={templates}
          effectiveFrom={effectiveFrom}
          onClose={() => setAddingKind(null)}
        />
      )}
    </SectionShell>
  );
}

function SortableRuleRow({
  id,
  rule,
  templates,
  effectiveFrom,
  onEdit,
}: {
  id: string;
  rule: CalendarRule;
  templates: Template[];
  effectiveFrom: string | undefined;
  onEdit: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center gap-2 rounded-md bg-surface-1 px-2 py-1.5',
        isDragging && 'z-10 opacity-60 shadow-md',
      )}
    >
      {/* Only the grip handle is the drag activator — clicking the
          edit / remove buttons elsewhere on the row doesn't trigger
          a drag. This is dnd-kit's `{...listeners} {...attributes}`
          pattern: attach to the handle, leave the rest alone. The
          item-level setNodeRef stays on the outer div above. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="拖动排序"
        className="cursor-grab shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:text-ink-secondary active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" strokeWidth={1.6} />
      </button>
      <KindBadge kind={rule.kind} />
      <span
        className="min-w-0 flex-1 truncate text-xs text-ink-secondary"
        title={ruleSummary(rule, templates)}
      >
        {ruleSummary(rule, templates)}
      </span>
      <EditButton onClick={onEdit} />
      <RemoveButton id={id} effectiveFrom={effectiveFrom} />
    </div>
  );
}

const ADD_PICKER_KINDS: ReadonlyArray<{
  kind: CalendarRule['kind'];
  label: string;
  hint: string;
}> = [
  { kind: 'single-date', label: '单日覆盖', hint: '某一天指定模板' },
  { kind: 'date-range', label: '范围', hint: '一段日期内同一模板' },
  { kind: 'cycle', label: '循环', hint: 'N 天循环模板（如 7 天班轮）' },
  { kind: 'weekday', label: '星期', hint: '按星期几定模板' },
  {
    kind: 'external-event',
    label: '属性匹配',
    hint: '按节假日 / 调休 / 备注 等属性匹配',
  },
];

function AddRulePicker({
  onPick,
}: {
  onPick: (kind: CalendarRule['kind']) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-ink-tertiary/40 p-3">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        + 添加规则
      </span>
      <div className="flex flex-wrap gap-1.5">
        {ADD_PICKER_KINDS.map((opt) => (
          <button
            key={opt.kind}
            type="button"
            onClick={() => onPick(opt.kind)}
            title={opt.hint}
            className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
          >
            <Plus className="h-3 w-3" strokeWidth={1.8} />
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Inline form for editing an existing rule. Dispatches to the right
 *  kind-specific form pre-filled with current values. Save calls the
 *  same upsert action that creates the rule (id-stable). */
function RuleEditCard({
  rule,
  templates,
  effectiveFrom,
  onClose,
}: {
  rule: CalendarRule;
  templates: Template[];
  effectiveFrom: string | undefined;
  onClose: () => void;
}) {
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  const upsertWeekdayRule = useStore((s) => s.upsertWeekdayRule);
  const upsertDateRangeRule = useStore((s) => s.upsertDateRangeRule);
  const upsertCycleRule = useStore((s) => s.upsertCycleRule);
  const upsertExternalEventRule = useStore((s) => s.upsertExternalEventRule);
  switch (rule.kind) {
    case 'single-date': {
      const v = rule.value as CalendarRuleSingleDate;
      return (
        <SingleDateForm
          templates={templates}
          initial={{ date: v.date, templateKey: v.templateKey }}
          onSubmit={async (date, templateKey) => {
            await overrideCycleDay(date, templateKey, undefined, effectiveFrom);
            onClose();
          }}
          onCancel={onClose}
        />
      );
    }
    case 'date-range': {
      const v = rule.value as CalendarRuleDateRange;
      return (
        <DateRangeForm
          templates={templates}
          initial={{
            from: v.from,
            to: v.to,
            templateKey: v.templateKey,
            ...(v.label && { label: v.label }),
          }}
          onSubmit={async (opts) => {
            await upsertDateRangeRule({
              id: rule.id,
              ...opts,
              effectiveFrom,
            });
            onClose();
          }}
          onCancel={onClose}
        />
      );
    }
    case 'cycle': {
      const v = rule.value as CalendarRuleCycle;
      return (
        <CycleForm
          templates={templates}
          initial={{
            cycleLength: v.cycleLength,
            anchor: v.anchor,
            mapping: v.mapping,
          }}
          onSubmit={async (opts) => {
            await upsertCycleRule({
              id: rule.id,
              ...opts,
              effectiveFrom,
            });
            onClose();
          }}
          onCancel={onClose}
        />
      );
    }
    case 'weekday': {
      const v = rule.value as CalendarRuleWeekday;
      return (
        <WeekdayForm
          templates={templates}
          initial={{ templateKey: v.templateKey, weekdays: v.weekdays }}
          onSubmit={async (templateKey) => {
            // Existing weekday rule id is `cr-weekday-{templateKey}`;
            // editing the template key creates a new rule rather than
            // updating in place. Acceptable: weekday rules are
            // template-keyed by design (one per template).
            await upsertWeekdayRule(
              templateKey,
              [...(rule.value as CalendarRuleWeekday).weekdays],
              effectiveFrom,
            );
            onClose();
          }}
          onCancel={onClose}
        />
      );
    }
    case 'external-event': {
      const v = rule.value as CalendarRuleExternalEvent;
      return (
        <ExternalEventForm
          templates={templates}
          initial={{
            kinds: v.kinds,
            regions: v.regions ?? [],
            ...(v.noteLabelFilter && { noteLabelFilter: v.noteLabelFilter }),
            templateKey: v.templateKey,
            label: v.label ?? '',
          }}
          onSubmit={async (opts) => {
            await upsertExternalEventRule({
              id: rule.id,
              ...opts,
              effectiveFrom,
            });
            onClose();
          }}
          onCancel={onClose}
        />
      );
    }
  }
}

function RuleAddCard({
  kind,
  templates,
  effectiveFrom,
  onClose,
}: {
  kind: CalendarRule['kind'];
  templates: Template[];
  effectiveFrom: string | undefined;
  onClose: () => void;
}) {
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  const upsertWeekdayRule = useStore((s) => s.upsertWeekdayRule);
  const upsertDateRangeRule = useStore((s) => s.upsertDateRangeRule);
  const upsertCycleRule = useStore((s) => s.upsertCycleRule);
  const upsertExternalEventRule = useStore((s) => s.upsertExternalEventRule);
  switch (kind) {
    case 'single-date':
      return (
        <SingleDateForm
          templates={templates}
          onSubmit={async (date, templateKey) => {
            await overrideCycleDay(date, templateKey, undefined, effectiveFrom);
            onClose();
          }}
          onCancel={onClose}
        />
      );
    case 'date-range':
      return (
        <DateRangeForm
          templates={templates}
          onSubmit={async (opts) => {
            await upsertDateRangeRule({ ...opts, effectiveFrom });
            onClose();
          }}
          onCancel={onClose}
        />
      );
    case 'cycle':
      return (
        <CycleForm
          templates={templates}
          onSubmit={async (opts) => {
            await upsertCycleRule({ ...opts, effectiveFrom });
            onClose();
          }}
          onCancel={onClose}
        />
      );
    case 'weekday':
      return (
        <WeekdayForm
          templates={templates}
          onSubmit={async (templateKey, weekdays) => {
            await upsertWeekdayRule(templateKey, weekdays, effectiveFrom);
            onClose();
          }}
          onCancel={onClose}
        />
      );
    case 'external-event':
      return (
        <ExternalEventForm
          templates={templates}
          onSubmit={async (opts) => {
            await upsertExternalEventRule({ ...opts, effectiveFrom });
            onClose();
          }}
          onCancel={onClose}
        />
      );
  }
}

const KIND_LABEL_ZH: Record<CalendarRule['kind'], string> = {
  'single-date': '单日',
  'date-range': '范围',
  cycle: '循环',
  weekday: '星期',
  'external-event': '属性',
};

function KindBadge({ kind }: { kind: CalendarRule['kind'] }) {
  return (
    <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      {KIND_LABEL_ZH[kind]}
    </span>
  );
}

/** Human-readable one-line summary for a rule, displayed in the
 *  priority list. Each kind's summary is hand-written rather than
 *  generic so users can identify rules at a glance. */
function ruleSummary(r: CalendarRule, templates: Template[]): string {
  const tplName = (key: string) =>
    templates.find((t) => t.key === key)?.name ?? key;
  switch (r.kind) {
    case 'single-date': {
      const v = r.value as CalendarRuleSingleDate;
      return `${v.date} → ${tplName(v.templateKey)}`;
    }
    case 'date-range': {
      const v = r.value as CalendarRuleDateRange;
      const label = v.label ? `${v.label} · ` : '';
      return `${label}${v.from} – ${v.to} → ${tplName(v.templateKey)}`;
    }
    case 'weekday': {
      const v = r.value as CalendarRuleWeekday;
      const days = v.weekdays
        .map((d) => ['日', '一', '二', '三', '四', '五', '六'][d])
        .join('');
      return `周${days} → ${tplName(v.templateKey)}`;
    }
    case 'cycle': {
      const v = r.value as CalendarRuleCycle;
      return `${v.cycleLength} 天循环 (锚点 ${v.anchor}) → ${v.mapping
        .map((m) => tplName(m))
        .join(' / ')}`;
    }
    case 'external-event': {
      const v = r.value as CalendarRuleExternalEvent;
      // Group display matches the form's 节假日 / 调休 / 备注 cards.
      // 节假日 with both 假日 + 非假日 sub-flavors collapses to plain
      // "节假日"; either alone shows the sub-flavor in parentheses.
      const parts: string[] = [];
      const hasHoliday = v.kinds.includes('holiday');
      const hasObservance = v.kinds.includes('observance');
      if (hasHoliday && hasObservance) parts.push('节假日');
      else if (hasHoliday) parts.push('节假日(假日)');
      else if (hasObservance) parts.push('节假日(非假日)');
      if (v.kinds.includes('makeup-workday')) parts.push('调休');
      if (v.kinds.includes('user-note')) parts.push('备注');
      const kindNames = parts.join('+');
      const regionPart =
        v.regions && v.regions.length > 0 ? ` (${v.regions.join(',')})` : '';
      const noteFilterPart = v.noteLabelFilter?.query
        ? ` 备注${v.noteLabelFilter.mode === 'exact' ? '=' : '⊇'}「${v.noteLabelFilter.query}」`
        : '';
      const labelPart = v.label ? `${v.label} · ` : '';
      return `${labelPart}${kindNames}${regionPart}${noteFilterPart} → ${tplName(v.templateKey)}`;
    }
  }
}

// ============ v0.8.1 external-event section ============

function ExternalEventSection({
  rules,
  templates,
  effectiveFrom,
}: {
  rules: CalendarRule[];
  templates: Template[];
  effectiveFrom: string | undefined;
}) {
  const upsertExternalEventRule = useStore((s) => s.upsertExternalEventRule);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <SectionShell
      title="属性匹配"
      subtitle="按日期属性（节假日 / 调休 / 观察日 / 备注）匹配 · v0.8.1 新"
      addCTA="新建属性规则"
      onAdd={() => {
        setFormOpen((v) => !v);
        setEditingId(null);
      }}
    >
      {formOpen && (
        <ExternalEventForm
          templates={templates}
          onSubmit={async (opts) => {
            await upsertExternalEventRule({ ...opts, effectiveFrom });
            setFormOpen(false);
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}
      {rules.length === 0 && !formOpen ? (
        <EmptyHint text="暂无属性匹配规则" />
      ) : (
        rules.map((r) => {
          const v = r.value as CalendarRuleExternalEvent;
          const editing = editingId === r.id;
          if (editing) {
            return (
              <ExternalEventForm
                key={r.id}
                templates={templates}
                initial={{
                  kinds: v.kinds,
                  regions: v.regions ?? [],
                  templateKey: v.templateKey,
                  label: v.label ?? '',
                }}
                onSubmit={async (opts) => {
                  await upsertExternalEventRule({
                    id: r.id,
                    ...opts,
                    effectiveFrom,
                  });
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            );
          }
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-1.5"
            >
              <span
                className="min-w-0 flex-1 truncate text-xs text-ink-secondary"
                title={ruleSummary(r, templates)}
              >
                {ruleSummary(r, templates)}
              </span>
              <div className="flex items-center gap-2">
                <TemplateTag templates={templates} templateKey={v.templateKey} />
                <EditButton onClick={() => setEditingId(r.id)} />
                <RemoveButton id={r.id} effectiveFrom={effectiveFrom} />
              </div>
            </div>
          );
        })
      )}
    </SectionShell>
  );
}

// "Condition group" presented in the form's UI. Each group
// represents one kind of trigger; narrowing options (假日/非假日,
// region filter, note label filter) are nested inside the relevant
// group rather than floating loose at the form's top level.
//
// `holiday-or-observance` is a UI-only super-group that bundles the
// underlying `holiday` + `observance` kinds together — they read as
// "one calendar concept" to the user (节假日, with both 假日 and
// 非假日 sub-flavors). The schema-level kinds[] still carries the
// two-element granularity, so the rule's resolver behavior is
// unchanged; the UI just groups them visually + lets the user sub-
// multi-select which flavors apply.
type ConditionGroupId =
  | 'holiday-or-observance'
  | 'makeup-workday'
  | 'user-note';

const ALL_CONDITION_GROUPS: ReadonlyArray<{
  id: ConditionGroupId;
  label: string;
}> = [
  { id: 'holiday-or-observance', label: '节假日' },
  { id: 'makeup-workday', label: '调休' },
  { id: 'user-note', label: '我的备注' },
];

function ExternalEventForm({
  templates,
  initial,
  onSubmit,
  onCancel,
}: {
  templates: Template[];
  initial?: {
    kinds: ExternalEventMatchKind[];
    regions: string[];
    noteLabelFilter?: { mode: 'contains' | 'exact'; query: string };
    templateKey: string;
    label: string;
  };
  onSubmit: (opts: {
    kinds: ExternalEventMatchKind[];
    regions?: string[];
    noteLabelFilter?: { mode: 'contains' | 'exact'; query: string };
    templateKey: string;
    label?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const userDayNotes = useStore((s) => s.userDayNotes);
  const [kinds, setKinds] = useState<ExternalEventMatchKind[]>(
    initial?.kinds ?? ['holiday', 'observance'],
  );
  const [regions, setRegions] = useState<string[]>(initial?.regions ?? []);
  const [noteFilterMode, setNoteFilterMode] = useState<'contains' | 'exact'>(
    initial?.noteLabelFilter?.mode ?? 'contains',
  );
  const [noteFilterQuery, setNoteFilterQuery] = useState<string>(
    initial?.noteLabelFilter?.query ?? '',
  );
  const [templateKey, setTemplateKey] = useState<string>(
    initial?.templateKey ?? templates[0]?.key ?? '',
  );
  const [label, setLabel] = useState(initial?.label ?? '');
  const allRegions = listHolidayRegions();
  const noteLabelDatalistId = useId();

  // Note-label autocomplete: every distinct label across all of the
  // user's existing notes. Cheap — typical N is in the tens.
  const noteLabelSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const n of Object.values(userDayNotes)) {
      if (n.label.trim().length > 0) set.add(n.label);
    }
    return Array.from(set).sort();
  }, [userDayNotes]);

  // Each card represents a distinct trigger condition. Narrowing
  // options (假日 / 非假日, 区域, 备注文本) live nested inside the
  // owning card rather than free-floating at the form's top level.
  const activeGroups: ConditionGroupId[] = useMemo(() => {
    const out: ConditionGroupId[] = [];
    if (kinds.includes('holiday') || kinds.includes('observance')) {
      out.push('holiday-or-observance');
    }
    if (kinds.includes('makeup-workday')) out.push('makeup-workday');
    if (kinds.includes('user-note')) out.push('user-note');
    return out;
  }, [kinds]);
  const groupsToOffer = ALL_CONDITION_GROUPS.filter(
    (g) => !activeGroups.includes(g.id),
  );
  const regionRelevant =
    activeGroups.includes('holiday-or-observance') ||
    activeGroups.includes('makeup-workday');
  const userNoteSelected = activeGroups.includes('user-note');

  const addGroup = (id: ConditionGroupId) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (id === 'holiday-or-observance') {
        // Default new "节假日" condition includes both 假日 + 非假日;
        // user can sub-uncheck either inside the card.
        next.add('holiday');
        next.add('observance');
      } else {
        next.add(id);
      }
      return Array.from(next);
    });
  };
  const removeGroup = (id: ConditionGroupId) => {
    setKinds((prev) => {
      if (id === 'holiday-or-observance') {
        return prev.filter((k) => k !== 'holiday' && k !== 'observance');
      }
      return prev.filter((k) => k !== id);
    });
  };
  const toggleHolidaySubKind = (k: 'holiday' | 'observance') => {
    setKinds((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  };
  const toggleRegion = (r: string) => {
    setRegions((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  };
  const submit = async () => {
    if (kinds.length === 0 || !templateKey) return;
    const trimmedNoteQuery = noteFilterQuery.trim();
    await onSubmit({
      kinds,
      ...(regions.length > 0 && { regions }),
      ...(userNoteSelected &&
        trimmedNoteQuery.length > 0 && {
          noteLabelFilter: {
            mode: noteFilterMode,
            query: trimmedNoteQuery,
          },
        }),
      templateKey,
      ...(label.trim() && { label: label.trim() }),
    });
  };
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-1 px-3 py-3">
      {/* === Trigger conditions === */}
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          触发条件（任一满足即应用模板）
        </span>
        {activeGroups.length === 0 ? (
          <EmptyHint text="点下方「+ 添加条件」开始" />
        ) : (
          <div className="flex flex-col gap-1.5">
            {activeGroups.map((id) => {
              if (id === 'holiday-or-observance') {
                return (
                  <ConditionCardShell
                    key={id}
                    title="节假日"
                    onRemove={() => removeGroup(id)}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <SubChip
                        active={kinds.includes('holiday')}
                        onClick={() => toggleHolidaySubKind('holiday')}
                      >
                        假日
                      </SubChip>
                      <SubChip
                        active={kinds.includes('observance')}
                        onClick={() => toggleHolidaySubKind('observance')}
                      >
                        非假日（节庆）
                      </SubChip>
                    </div>
                  </ConditionCardShell>
                );
              }
              if (id === 'makeup-workday') {
                return (
                  <ConditionCardShell
                    key={id}
                    title="调休"
                    onRemove={() => removeGroup(id)}
                  />
                );
              }
              return (
                <ConditionCardShell
                  key={id}
                  title="我的备注"
                  onRemove={() => removeGroup(id)}
                >
                  <div className="flex flex-col gap-1 pt-1">
                    <span className="text-2xs text-ink-tertiary">
                      备注内容（可选 · 留空 = 匹配任意备注）
                    </span>
                    <div className="flex items-center gap-1.5">
                      <SubChip
                        active={noteFilterMode === 'contains'}
                        onClick={() => setNoteFilterMode('contains')}
                      >
                        包含
                      </SubChip>
                      <SubChip
                        active={noteFilterMode === 'exact'}
                        onClick={() => setNoteFilterMode('exact')}
                      >
                        精确匹配
                      </SubChip>
                      <input
                        type="text"
                        value={noteFilterQuery}
                        onChange={(e) => setNoteFilterQuery(e.target.value)}
                        list={
                          noteFilterMode === 'exact'
                            ? noteLabelDatalistId
                            : undefined
                        }
                        placeholder={
                          noteFilterMode === 'contains'
                            ? '例：生日'
                            : '从已有备注选 / 自由输入'
                        }
                        className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
                      />
                      <datalist id={noteLabelDatalistId}>
                        {noteLabelSuggestions.map((l) => (
                          <option key={l} value={l} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                </ConditionCardShell>
              );
            })}
          </div>
        )}
        {groupsToOffer.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-2xs text-ink-tertiary">+ 添加条件:</span>
            {groupsToOffer.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => addGroup(opt.id)}
                className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
              >
                <Plus className="h-3 w-3" strokeWidth={1.8} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* === Region filter (shared by 节假日 + 调休 cards when present) === */}
      {regionRelevant && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            区域过滤（节假日 + 调休 共用 · 留空 = 任意已启用区域）
          </span>
          <div className="flex flex-wrap gap-1.5">
            {allRegions.map((r) => {
              const active = regions.includes(r);
              const display = getHolidayDatasetDisplayName(r, 'zh-CN') ?? r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRegion(r)}
                  className={clsx(
                    'rounded-md px-2 py-1 text-xs transition',
                    active
                      ? 'bg-ink-primary text-surface-0'
                      : 'bg-surface-2 text-ink-secondary hover:bg-surface-3',
                  )}
                >
                  {display}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          应用模板
        </span>
        <select
          value={templateKey}
          onChange={(e) => setTemplateKey(e.target.value)}
          className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none focus:border-ink-secondary"
        >
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
          名字（可选）
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例：节假日休息"
          className="h-7 flex-1 rounded-sm border border-hairline/60 bg-surface-0 px-2 text-xs text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-ink-secondary"
        />
      </div>
      <FormActions
        onCancel={onCancel}
        onSubmit={() => {
          void submit();
        }}
      />
    </div>
  );
}

/** Card frame for one trigger condition. Title + remove on the
 *  header, narrowing options inside. Pure presentation; the parent
 *  owns all state and adds/removes cards by mutating `kinds`. */
function ConditionCardShell({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline/60 bg-surface-0 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-primary">{title}</span>
        <button
          type="button"
          aria-label="Remove condition"
          onClick={onRemove}
          className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          <X className="h-3 w-3" strokeWidth={1.8} />
        </button>
      </div>
      {children}
    </div>
  );
}

/** Chip-style toggle button used inside ConditionCardShell. */
function SubChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'shrink-0 rounded-md px-2 py-1 text-xs transition',
        active
          ? 'bg-ink-primary text-surface-0'
          : 'bg-surface-2 text-ink-secondary hover:bg-surface-3',
      )}
    >
      {children}
    </button>
  );
}
