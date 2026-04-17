import { useState } from 'react';
import { ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { CalendarDayCell } from '@/components/CalendarDayCell';
import { CalendarRulesDrawer } from '@/components/CalendarRulesDrawer';
import {
  SAMPLE_RULES,
  buildMonthGrid,
  monthLabel,
} from '@/data/sampleCalendar';
import type { TemplateKey } from '@/data/sampleTemplate';

// ERD §5.4 F4 — Calendar month view. Single-column page (no backlog
// drawer); left sidebar is supplied by App.tsx.

const TODAY_ISO = '2026-04-17';

export function Calendar() {
  const [{ year, month }, setMonth] = useState({ year: 2026, month: 4 });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const cells = buildMonthGrid(year, month);

  const gotoPrev = () => {
    setMonth(({ year, month }) =>
      month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    );
  };
  const gotoNext = () => {
    setMonth(({ year, month }) =>
      month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
    );
  };
  const gotoToday = () => setMonth({ year: 2026, month: 4 });

  const noop = (_: string, __?: TemplateKey) => {};

  return (
    <div className="flex w-full flex-col pl-10 pr-10 xl:pl-14">
      <TopBar
        year={year}
        month={month}
        onPrev={gotoPrev}
        onNext={gotoNext}
        onToday={gotoToday}
        onOpenDrawer={() => setDrawerOpen(true)}
      />

      <WeekdayHeader />

      <div className="grid grid-cols-7 gap-1 pb-10">
        {cells.map((cell) => (
          <CalendarDayCell
            key={cell.date}
            date={cell.date}
            inMonth={cell.inMonth}
            weekday={cell.weekday}
            dayNum={cell.dayNum}
            isToday={cell.date === TODAY_ISO}
            onOverride={noop}
            onClearOverride={() => {}}
            onAddAdhoc={() => {}}
          />
        ))}
      </div>

      <Footer />

      <CalendarRulesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        rules={SAMPLE_RULES}
      />
    </div>
  );
}

// ---------- top ----------

function TopBar({
  year,
  month,
  onPrev,
  onNext,
  onToday,
  onOpenDrawer,
}: {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpenDrawer: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-[56px] items-center justify-between gap-4 bg-surface-0 pt-6">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-medium tracking-wide text-ink-primary">
          Calendar
        </span>
        <span aria-hidden className="h-4 w-px bg-hairline" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous month"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <span className="w-[140px] text-center font-mono text-sm tabular-nums text-ink-primary">
            {monthLabel(year, month)}
          </span>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next month"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="ml-2 rounded-md px-2 py-1 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            Today
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenDrawer}
        className="inline-flex items-center gap-2 rounded-md bg-surface-1 px-3 py-1.5 text-sm text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
      >
        <Settings2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        高级日历规则
      </button>
    </header>
  );
}

function WeekdayHeader() {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="hairline-b grid grid-cols-7 gap-1 py-3">
      {labels.map((w) => (
        <span
          key={w}
          className="pl-2 font-mono text-2xs uppercase tracking-widest text-ink-tertiary"
        >
          {w}
        </span>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex items-center justify-between font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
      <span>
        应用顺序 · 单日 → 范围 → 循环 → 星期几 → 默认
      </span>
      <span>ERD §5.4 · static mock</span>
    </footer>
  );
}
