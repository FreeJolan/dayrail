import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Pencil, Plus, X } from 'lucide-react';
import {
  useStore,
  type CalendarRule,
  type CalendarRuleCycle,
  type CalendarRuleDateRange,
  type CalendarRuleSingleDate,
  type CalendarRuleWeekday,
  type Template,
} from '@dayrail/core';
import type { RailColor } from '@/data/sample';
import { RAIL_COLOR_HEX } from './railColors';

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

  const templatesList = useMemo(
    () => Object.values(templates).sort((a, b) => a.key.localeCompare(b.key)),
    [templates],
  );

  const { singleDate, dateRange, cycle, weekday } = useMemo(() => {
    const single: CalendarRule[] = [];
    const range: CalendarRule[] = [];
    const cyc: CalendarRule[] = [];
    const wd: CalendarRule[] = [];
    for (const r of Object.values(calendarRules)) {
      if (r.kind === 'single-date') single.push(r);
      else if (r.kind === 'date-range') range.push(r);
      else if (r.kind === 'cycle') cyc.push(r);
      else if (r.kind === 'weekday') wd.push(r);
    }
    single.sort(byCreatedDesc);
    range.sort(byCreatedDesc);
    cyc.sort(byCreatedDesc);
    // Weekday: sort by the first covered weekday ascending so Mon-Fri
    // templates land above Sat-Sun in the common seeding.
    wd.sort((a, b) => {
      const aw = (a.value as CalendarRuleWeekday).weekdays[0] ?? 0;
      const bw = (b.value as CalendarRuleWeekday).weekdays[0] ?? 0;
      return aw - bw;
    });
    return { singleDate: single, dateRange: range, cycle: cyc, weekday: wd };
  }, [calendarRules]);

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
          优先级：<span className="text-ink-secondary">单日 → 范围 → 循环 → 星期几 → 内置启发</span>。改动即时落库；点规则右侧 ✎ 可原地编辑。
        </div>

        <div className="mt-4 flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6">
          <SingleDateSection rules={singleDate} templates={templatesList} />
          <DateRangeSection rules={dateRange} templates={templatesList} />
          <CycleSection rules={cycle} templates={templatesList} />
          <WeekdaySection
            rules={weekday}
            templates={templatesList}
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

function RemoveButton({ id }: { id: string }) {
  const removeCalendarRule = useStore((s) => s.removeCalendarRule);
  return (
    <button
      type="button"
      aria-label="Remove"
      onClick={() => void removeCalendarRule(id)}
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
}: {
  rules: CalendarRule[];
  templates: Template[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const overrideCycleDay = useStore((s) => s.overrideCycleDay);
  return (
    <SectionShell
      title="单日覆盖"
      subtitle="对某一天单独指定模板；日历里点日期弹 popover 也写这一类"
      addCTA="新建单日"
      onAdd={() => setFormOpen((v) => !v)}
    >
      {formOpen && (
        <SingleDateForm
          templates={templates}
          onSubmit={async (date, tk) => {
            await overrideCycleDay(date, tk);
            setFormOpen(false);
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}
      {rules.length === 0 && !formOpen ? (
        <EmptyHint text="暂无单日覆盖" />
      ) : (
        rules.map((r) => {
          const v = r.value as CalendarRuleSingleDate;
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
                <RemoveButton id={r.id} />
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
  onSubmit,
  onCancel,
}: {
  templates: Template[];
  onSubmit: (date: string, templateKey: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [templateKey, setTemplateKey] = useState<string>(
    templates[0]?.key ?? '',
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
      <FormActions onCancel={onCancel} onSubmit={submit} />
    </div>
  );
}

// ------- Date-range section -------

function DateRangeSection({
  rules,
  templates,
}: {
  rules: CalendarRule[];
  templates: Template[];
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
            await upsertDateRangeRule(opts);
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
                  await upsertDateRangeRule({ ...opts, id: r.id });
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
                <RemoveButton id={r.id} />
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
}: {
  rules: CalendarRule[];
  templates: Template[];
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
            await upsertCycleRule(opts);
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
                  await upsertCycleRule({ ...opts, id: r.id });
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
                  <RemoveButton id={r.id} />
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
}: {
  rules: CalendarRule[];
  templates: Template[];
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
            await upsertWeekdayRule(tk, weekdays);
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
                  await upsertWeekdayRule(tk, weekdays);
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
                <RemoveButton id={r.id} />
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
