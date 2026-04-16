import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rail, TemplateKey } from '@dayrail/core';
import { useStore } from '../../store';

const COLOR_MAP: Record<string, string> = {
  sand: '#AFA18B',
  sage: '#868E82',
  olive: '#8B8D7A',
  teal: '#12A594',
  mauve: '#86848D',
  brown: '#AD7F58',
  amber: '#FFB224',
  pink: '#D6409F',
  slate: '#8B8D98',
};
const COLORS = Object.keys(COLOR_MAP);

const pad = (n: number) => n.toString().padStart(2, '0');
const minutesToHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const formatDuration = (m: number) => {
  if (m <= 0) return '—';
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}min`;
  if (min === 0) return `${h}h`;
  return `${h}h${min}min`;
};

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

function findOverlap(rails: Rail[], ignoreId: string, start: number, end: number): Rail | null {
  for (const r of rails) {
    if (r.id === ignoreId) continue;
    if (overlaps(start, end, r.startMinutes, r.startMinutes + r.durationMinutes)) return r;
  }
  return null;
}

function findFreeSlot(rails: Rail[], duration: number): number | null {
  const searchStart = 6 * 60;
  const searchEnd = 24 * 60;
  const sorted = rails.slice().sort((a, b) => a.startMinutes - b.startMinutes);
  let cursor = searchStart;
  for (const rail of sorted) {
    const rEnd = rail.startMinutes + rail.durationMinutes;
    if (rEnd <= cursor) continue;
    if (rail.startMinutes >= searchEnd) break;
    if (rail.startMinutes - cursor >= duration) return cursor;
    cursor = Math.max(cursor, rEnd);
  }
  if (searchEnd - cursor >= duration) return cursor;
  return null;
}

function pickColor(rails: Rail[], start: number, end: number): string {
  const sorted = rails.slice().sort((a, b) => a.startMinutes - b.startMinutes);
  const before = [...sorted].reverse().find((r) => r.startMinutes + r.durationMinutes <= start);
  const after = sorted.find((r) => r.startMinutes >= end);
  const blocked = new Set<string>();
  if (before) blocked.add(before.color);
  if (after) blocked.add(after.color);
  const usageCount = new Map<string, number>();
  for (const r of rails) usageCount.set(r.color, (usageCount.get(r.color) ?? 0) + 1);
  const candidates = COLORS.filter((c) => !blocked.has(c));
  const pool = candidates.length ? candidates : COLORS;
  return pool.slice().sort(
    (a, b) => (usageCount.get(a) ?? 0) - (usageCount.get(b) ?? 0)
  )[0]!;
}

const TIMELINE_START = 6 * 60;
const TIMELINE_END = 24 * 60;
const TIMELINE_SPAN = TIMELINE_END - TIMELINE_START;

function TimelineOverview({ rails }: { rails: Rail[] }) {
  const sorted = rails.slice().sort((a, b) => a.startMinutes - b.startMinutes);
  const gaps: { start: number; end: number }[] = [];
  let cursor = TIMELINE_START;
  for (const r of sorted) {
    if (r.startMinutes > cursor) gaps.push({ start: cursor, end: r.startMinutes });
    cursor = Math.max(cursor, r.startMinutes + r.durationMinutes);
  }
  if (cursor < TIMELINE_END) gaps.push({ start: cursor, end: TIMELINE_END });
  const ticks = [6, 9, 12, 15, 18, 21, 24];
  const totalGap = gaps.reduce((sum, g) => sum + (g.end - g.start), 0);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="relative h-8 overflow-hidden rounded bg-slate-100 dark:bg-slate-900">
        {sorted.map((r) => {
          const left = ((r.startMinutes - TIMELINE_START) / TIMELINE_SPAN) * 100;
          const width = (r.durationMinutes / TIMELINE_SPAN) * 100;
          return (
            <div
              key={r.id}
              title={`${r.name} · ${minutesToHHMM(r.startMinutes)}–${minutesToHHMM(r.startMinutes + r.durationMinutes)}`}
              className="absolute top-0 h-full"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: COLOR_MAP[r.color] ?? '#999',
              }}
            />
          );
        })}
      </div>
      <div className="relative h-3 font-mono text-[10px] text-slate-400">
        {ticks.map((h) => {
          const pct = ((h * 60 - TIMELINE_START) / TIMELINE_SPAN) * 100;
          return (
            <span
              key={h}
              className="absolute -translate-x-1/2"
              style={{ left: `${pct}%` }}
            >
              {pad(h)}
            </span>
          );
        })}
      </div>
      <div className="font-mono text-[11px] text-slate-500">
        {gaps.length === 0
          ? '—'
          : gaps
              .map((g) => `${minutesToHHMM(g.start)}–${minutesToHHMM(g.end)}(${formatDuration(g.end - g.start)})`)
              .join(' · ')}
        {gaps.length > 0 && ` = ${formatDuration(totalGap)}`}
      </div>
    </div>
  );
}

export function TemplateEditor() {
  const { t } = useTranslation();
  const [activeKey, setActiveKey] = useState<TemplateKey>('workday');
  const rails = useStore((s) => s.railsByTemplate[activeKey]);
  const addRail = useStore((s) => s.addRail);
  const resetRails = useStore((s) => s.resetRails);

  const sorted = rails.slice().sort((a, b) => a.startMinutes - b.startMinutes);

  const handleAdd = () => {
    const duration = 30;
    const start = findFreeSlot(rails, duration);
    if (start === null) {
      window.alert(t('no_free_slot'));
      return;
    }
    addRail(activeKey, {
      name: t('new_rail_name'),
      startMinutes: start,
      durationMinutes: duration,
      color: pickColor(rails, start, start + duration),
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
          {(['workday', 'restday'] as TemplateKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveKey(key)}
              className={`rounded px-3 py-1 font-mono text-xs uppercase tracking-widest transition ${
                activeKey === key
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {key === 'workday' ? t('template_workday') : t('template_restday')}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('confirm_reset'))) resetRails(activeKey);
          }}
          className="font-mono text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          {t('reset_to_default')}
        </button>
      </div>

      <TimelineOverview rails={sorted} />

      <ul className="flex flex-col gap-3">
        {sorted.map((rail) => (
          <RailRow key={rail.id} templateKey={activeKey} rail={rail} otherRails={rails} />
        ))}
      </ul>

      <button
        type="button"
        onClick={handleAdd}
        className="self-start rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-500 hover:border-slate-500 hover:text-slate-800 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:text-slate-200"
      >
        + {t('add_rail')}
      </button>
    </section>
  );
}

function RailRow({
  templateKey,
  rail,
  otherRails,
}: {
  templateKey: TemplateKey;
  rail: Rail;
  otherRails: Rail[];
}) {
  const { t } = useTranslation();
  const updateRail = useStore((s) => s.updateRail);
  const deleteRail = useStore((s) => s.deleteRail);
  const [name, setName] = useState(rail.name);
  const [startStr, setStartStr] = useState(minutesToHHMM(rail.startMinutes));
  const [endStr, setEndStr] = useState(minutesToHHMM(rail.startMinutes + rail.durationMinutes));
  const [error, setError] = useState<string | null>(null);

  const commitTimeChange = (nextStart: number, nextEnd: number) => {
    if (nextEnd <= nextStart) {
      setError(t('error_end_before_start'));
      return false;
    }
    const conflict = findOverlap(otherRails, rail.id, nextStart, nextEnd);
    if (conflict) {
      setError(t('error_overlap', { name: conflict.name }));
      return false;
    }
    setError(null);
    updateRail(templateKey, rail.id, {
      startMinutes: nextStart,
      durationMinutes: nextEnd - nextStart,
    });
    return true;
  };

  const onStartBlur = () => {
    const nextStart = hhmmToMinutes(startStr);
    const currentEnd = rail.startMinutes + rail.durationMinutes;
    const ok = commitTimeChange(nextStart, hhmmToMinutes(endStr) || currentEnd);
    if (!ok) {
      // Snap visuals back to stored values so the field doesn't diverge silently
      setStartStr(minutesToHHMM(rail.startMinutes));
    }
  };

  const onEndBlur = () => {
    const nextEnd = hhmmToMinutes(endStr);
    const ok = commitTimeChange(hhmmToMinutes(startStr), nextEnd);
    if (!ok) {
      setEndStr(minutesToHHMM(rail.startMinutes + rail.durationMinutes));
    }
  };

  const duration = hhmmToMinutes(endStr) - hhmmToMinutes(startStr);

  return (
    <li
      className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
      style={{ borderLeft: `4px solid ${COLOR_MAP[rail.color] ?? '#999'}` }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name !== rail.name) updateRail(templateKey, rail.id, { name });
        }}
        className="bg-transparent text-lg font-medium outline-none focus:border-b focus:border-slate-400"
      />
      <div className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
            {t('field_start')}
          </span>
          <input
            type="time"
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
            onBlur={onStartBlur}
            className="rounded border border-slate-200 bg-transparent px-2 py-1 font-mono dark:border-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
            {t('field_end')}
          </span>
          <input
            type="time"
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            onBlur={onEndBlur}
            className="rounded border border-slate-200 bg-transparent px-2 py-1 font-mono dark:border-slate-700"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
            {t('field_duration_label')}
          </span>
          <span className="py-1 font-mono text-sm text-slate-600 dark:text-slate-300">
            {formatDuration(duration)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
            {t('field_color')}
          </span>
          <div className="flex flex-wrap gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => updateRail(templateKey, rail.id, { color: c })}
                aria-label={c}
                className={`h-5 w-5 rounded-full border transition ${
                  rail.color === c ? 'border-slate-900 dark:border-white' : 'border-transparent'
                }`}
                style={{ background: COLOR_MAP[c] ?? '#999' }}
              />
            ))}
          </div>
        </div>
      </div>
      {error && (
        <div className="font-mono text-xs text-red-500">{error}</div>
      )}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t('confirm_delete'))) deleteRail(templateKey, rail.id);
        }}
        className="self-end font-mono text-xs text-slate-400 hover:text-red-500"
      >
        {t('delete')}
      </button>
    </li>
  );
}
