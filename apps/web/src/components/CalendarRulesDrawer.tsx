import { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Plus, X } from 'lucide-react';
import { SAMPLE_TEMPLATES } from '@/data/sampleTemplate';
import type { CalendarRule } from '@/data/sampleCalendar';
import { RAIL_COLOR_HEX } from './railColors';

// ERD §5.4 "Advanced Calendar Rules" drawer.
// Slides in from the right. Four sections, each with a `+ New` CTA:
//   · Weekday rules (shipped with defaults)
//   · Cycle rules (empty by default)
//   · Date-range overrides
//   · Single-date overrides
// Drawer close = implicit commit per §5.3.1 Edit Session vocabulary.

interface Props {
  open: boolean;
  onClose: () => void;
  rules: CalendarRule[];
}

export function CalendarRulesDrawer({ open, onClose, rules }: Props) {
  if (!open) return null;

  const weekdayRules = rules.filter(
    (r): r is Extract<CalendarRule, { kind: 'weekday' }> => r.kind === 'weekday',
  );
  const cycleRules = rules.filter(
    (r): r is Extract<CalendarRule, { kind: 'cycle' }> => r.kind === 'cycle',
  );
  const rangeRules = rules.filter(
    (r): r is Extract<CalendarRule, { kind: 'date-range' }> => r.kind === 'date-range',
  );
  const singleRules = rules.filter(
    (r): r is Extract<CalendarRule, { kind: 'single-date' }> => r.kind === 'single-date',
  );

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink-primary/10 backdrop-blur-[1px]"
      />
      {/* Drawer */}
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
            <h2 className="text-lg font-medium text-ink-primary">高级日历规则</h2>
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
          优先级：
          <span className="text-ink-secondary">
            {' '}单日 → 范围 → 循环 → 星期几 → 默认
          </span>
          。关闭抽屉即保存。
        </div>

        <div className="mt-4 flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6">
          <RulesBlock title="星期规则" subtitle="Mon–Fri 默认 workday · Sat-Sun 默认 restday">
            <WeekdayRuleEditor rules={weekdayRules} />
          </RulesBlock>

          <RulesBlock
            title="循环规则"
            subtitle="非 7 天节奏（4 on / 3 off 之类）"
            addCTA="新建循环规则"
          >
            {cycleRules.length === 0 ? (
              <EmptyRow text="暂无循环规则" />
            ) : (
              cycleRules.map((r, idx) => (
                <div key={idx} className="rounded-md bg-surface-1 px-3 py-2 text-sm">
                  {r.label} · length {r.cycleLength} · anchor {r.anchor}
                </div>
              ))
            )}
          </RulesBlock>

          <RulesBlock title="日期范围覆盖" subtitle="整段时间段内覆盖默认规则" addCTA="新建范围">
            {rangeRules.length === 0 ? (
              <EmptyRow text="暂无范围覆盖" />
            ) : (
              rangeRules.map((r, idx) => <RangeRow key={idx} rule={r} />)
            )}
          </RulesBlock>

          <RulesBlock title="单日覆盖" subtitle="针对具体某一天（高频场景）" addCTA="新建单日覆盖">
            {singleRules.length === 0 ? (
              <EmptyRow text="暂无单日覆盖" />
            ) : (
              singleRules.map((r, idx) => <SingleRow key={idx} rule={r} />)
            )}
          </RulesBlock>
        </div>

        <footer className="hairline-t flex items-center justify-between px-5 py-3 text-xs text-ink-tertiary">
          <span>§5.4 Calendar Rules</span>
          <span>关闭 = 保存（编辑会话 §5.3.1）</span>
        </footer>
      </aside>
    </>
  );
}

// ---------- sub-parts ----------

function RulesBlock({
  title,
  subtitle,
  addCTA,
  children,
}: {
  title: string;
  subtitle?: string;
  addCTA?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-secondary">
            {title}
          </span>
          {subtitle && <span className="text-xs text-ink-tertiary">{subtitle}</span>}
        </div>
        {addCTA && (
          <button
            type="button"
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

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-md bg-surface-1 px-3 py-2 text-center text-xs text-ink-tertiary">
      {text}
    </div>
  );
}

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WeekdayRuleEditor({
  rules,
}: {
  rules: Array<Extract<CalendarRule, { kind: 'weekday' }>>;
}) {
  // render 7 rows Mon..Sun for consistency with the grid
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="flex flex-col gap-1">
      {order.map((wd) => {
        const rule = rules.find((r) => r.weekday === wd);
        const tpl = rule
          ? SAMPLE_TEMPLATES.find((t) => t.key === rule.templateKey)
          : undefined;
        return (
          <div
            key={wd}
            className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-1.5 text-sm"
          >
            <span className="font-mono text-xs uppercase tracking-widest text-ink-tertiary">
              {WEEKDAYS_EN[wd]}
            </span>
            <TemplatePicker currentKey={rule?.templateKey ?? 'workday'} templateLabel={tpl?.label ?? 'workday'} />
          </div>
        );
      })}
    </div>
  );
}

function TemplatePicker({
  currentKey: _currentKey,
  templateLabel,
}: {
  currentKey: string;
  templateLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-1 text-xs text-ink-primary transition hover:bg-surface-3"
      >
        {templateLabel}
        <ChevronDown className="h-3 w-3 text-ink-tertiary" strokeWidth={1.8} />
      </button>
      {open && (
        <ul className="absolute right-0 top-full z-10 mt-1 flex w-[140px] flex-col rounded-md bg-surface-1 p-1 shadow-[0_0.5px_0_0_theme(colors.hairline),0_8px_24px_-12px_rgba(0,0,0,0.18)]">
          {SAMPLE_TEMPLATES.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs transition hover:bg-surface-2',
                )}
              >
                <span
                  aria-hidden
                  className="h-3 w-[3px] rounded-sm"
                  style={{ background: RAIL_COLOR_HEX[t.color] }}
                />
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RangeRow({
  rule,
}: {
  rule: Extract<CalendarRule, { kind: 'date-range' }>;
}) {
  const tpl = SAMPLE_TEMPLATES.find((t) => t.key === rule.templateKey);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-2">
      <div className="flex flex-col">
        <span className="text-sm text-ink-primary">{rule.label}</span>
        <span className="font-mono text-2xs tabular-nums text-ink-tertiary">
          {rule.start.slice(5)} → {rule.end.slice(5)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="rounded-sm px-2 py-0.5 text-xs"
          style={{
            background: tpl ? `${RAIL_COLOR_HEX[tpl.color]}22` : undefined,
            color: tpl ? RAIL_COLOR_HEX[tpl.color] : undefined,
          }}
        >
          {tpl?.label ?? rule.templateKey}
        </span>
        <button
          type="button"
          aria-label="Remove"
          className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
        >
          <X className="h-3 w-3" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function SingleRow({
  rule,
}: {
  rule: Extract<CalendarRule, { kind: 'single-date' }>;
}) {
  const tpl = SAMPLE_TEMPLATES.find((t) => t.key === rule.templateKey);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-surface-1 px-3 py-1.5">
      <span className="font-mono text-xs tabular-nums text-ink-primary">
        {rule.date}
      </span>
      <div className="flex items-center gap-2">
        <span
          className="rounded-sm px-2 py-0.5 text-xs"
          style={{
            background: tpl ? `${RAIL_COLOR_HEX[tpl.color]}22` : undefined,
            color: tpl ? RAIL_COLOR_HEX[tpl.color] : undefined,
          }}
        >
          {tpl?.label ?? rule.templateKey}
        </span>
        <button
          type="button"
          aria-label="Remove"
          className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
        >
          <X className="h-3 w-3" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
