// Human-readable / cross-tool exports for "the data is mine, even
// after DayRail" portability story. Reflections → Markdown (any
// notes app reads it), tasks → CSV (any spreadsheet reads it),
// schedule → iCal (any calendar app imports it).
//
// These are LOSSY exports — DayRail's data model has structure that
// no off-the-shelf tool understands (Templates × Rails × Lines ×
// HabitBindings × Cycles × CalendarRules), so we project a slice
// each format can carry. The .dryj export remains the lossless
// round-trip channel; this file is the "diaspora" channel.

import { useStore, type DayRailState, type Task } from '@dayrail/core';

// ============ Markdown · reflections ============

/** Daily reflections as a single Markdown document, newest first.
 *  Each entry is a `## YYYY-MM-DD` header followed by the user's
 *  reflection body (which is already Markdown). Empty reflections
 *  are skipped. */
export function formatReflectionsAsMarkdown(state: DayRailState): string {
  const entries = Object.values(state.reflections)
    .filter((r) => r.content && r.content.trim().length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  const lines: string[] = [];
  lines.push('# DayRail 反思导出');
  lines.push('');
  lines.push(
    `> 导出于 ${new Date().toISOString()} · 共 ${entries.length} 条反思`,
  );
  lines.push('');
  for (const r of entries) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${r.date}`);
    lines.push('');
    lines.push(r.content.trim());
    lines.push('');
  }
  return lines.join('\n');
}

// ============ CSV · tasks ============

/** Tasks as CSV, one row per task. Includes scheduled date + line
 *  name + status + priority + note + completion timestamp. Inbox /
 *  unscheduled tasks have an empty `date` column. */
export function formatTasksAsCsv(state: DayRailState): string {
  const lineName = (lineId: string): string => {
    const line = state.lines[lineId];
    return line?.name ?? lineId;
  };

  const headers = [
    'date',
    'line',
    'title',
    'status',
    'priority',
    'note',
    'created_at',
    'done_at',
    'deferred_at',
    'archived_at',
  ];

  const rows: string[] = [headers.map(csvEscape).join(',')];

  // Sort by date desc (unscheduled at bottom), then by created order
  // within the same day.
  const tasks = Object.values(state.tasks).sort((a, b) => {
    const da = a.slot?.date ?? '';
    const db = b.slot?.date ?? '';
    if (da !== db) return db.localeCompare(da);
    return a.order - b.order;
  });

  for (const t of tasks) {
    rows.push(
      [
        t.slot?.date ?? '',
        lineName(t.lineId),
        t.title,
        t.status,
        t.priority ?? '',
        (t.note ?? '').replace(/\r?\n/g, ' '),
        taskCreatedAt(t),
        t.doneAt ?? '',
        t.deferredAt ?? '',
        t.archivedAt ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  return rows.join('\n') + '\n';
}

function csvEscape(value: string): string {
  if (value === '') return '';
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function taskCreatedAt(_t: Task): string {
  // Task entity doesn't carry a createdAt field directly — we rely
  // on the order field for stable sorting. Leave column empty rather
  // than fabricating a value; consumers can compute from order if
  // they care.
  return '';
}

// ============ iCal · scheduled tasks as time blocks ============

/** Tasks that have a slot pinned to a rail (Mode A scheduling) get
 *  exported as VEVENTs. Time = rail startMinutes/durationMinutes
 *  resolved against slot.date. Unscheduled tasks and free-time
 *  AdhocEvents are skipped — Mode A tasks are the only ones with
 *  unambiguous start/end times in DayRail's model. */
export function formatScheduleAsIcal(state: DayRailState): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayRail//Schedule Export//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const task of Object.values(state.tasks)) {
    if (!task.slot || task.status === 'deleted' || task.status === 'archived') {
      continue;
    }
    const rail = state.rails[task.slot.railId];
    if (!rail) continue;
    const dt = computeIcalTimes(task.slot.date, rail.startMinutes, rail.durationMinutes);
    if (!dt) continue;

    const summary = task.title || rail.name;
    const description = [
      rail.subtitle ? `Rail: ${rail.name} · ${rail.subtitle}` : `Rail: ${rail.name}`,
      task.note ? `Note: ${task.note}` : null,
      `Status: ${task.status}`,
    ]
      .filter(Boolean)
      .join('\\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${task.id}@dayrail`);
    lines.push(`DTSTAMP:${dt.stamp}`);
    lines.push(`DTSTART:${dt.start}`);
    lines.push(`DTEND:${dt.end}`);
    lines.push(`SUMMARY:${escapeIcalText(summary)}`);
    lines.push(`DESCRIPTION:${escapeIcalText(description)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 requires CRLF line breaks.
  return lines.join('\r\n') + '\r\n';
}

interface IcalTimes {
  start: string;
  end: string;
  stamp: string;
}

function computeIcalTimes(
  date: string,
  startMinutes: number,
  durationMinutes: number,
): IcalTimes | null {
  // date is YYYY-MM-DD. Build a local-time DTSTART/DTEND in the
  // floating-time form (no Z suffix, no TZID) — calendar apps
  // interpret as "wall clock in the user's current zone", which is
  // the right behaviour for personal schedules where DayRail itself
  // doesn't track timezones.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [_, y, mo, d] = m;
  const startH = Math.floor(startMinutes / 60);
  const startM = startMinutes % 60;
  const endTotal = startMinutes + durationMinutes;
  const endH = Math.floor(endTotal / 60) % 24;
  const endM = endTotal % 60;
  const endDay = startMinutes + durationMinutes >= 24 * 60 ? addDay(y!, mo!, d!) : `${y}${mo}${d}`;

  return {
    start: `${y}${mo}${d}T${pad2(startH)}${pad2(startM)}00`,
    end: `${endDay}T${pad2(endH)}${pad2(endM)}00`,
    stamp: nowIcalStamp(),
  };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function addDay(y: string, mo: string, d: string): string {
  // Roll forward one day. Used when an event crosses midnight (rare
  // in DayRail — most rails are <24h — but possible).
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear().toString();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  return `${yy}${mm}${dd}`;
}

function nowIcalStamp(): string {
  // UTC timestamp in basic format with Z suffix.
  const d = new Date();
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeIcalText(value: string): string {
  // RFC 5545 §3.3.11 — escape backslash, semicolon, comma, newline.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// ============ State accessor (for non-React callers) ============

export function snapshotState(): DayRailState {
  return useStore.getState();
}

// ============ User-chosen-path file write (Tauri vs PWA) ============

// Mirrors the v0.9.7 / v0.9.8 pattern: Tauri runtime → native save
// dialog + plugin-fs writeFile; PWA → Blob + <a download>. Returns
// true if the user actually saved (false on cancel).
export async function saveTextToUserPath(
  content: string,
  defaultFilename: string,
  filterName: string,
  filterExt: string,
): Promise<boolean> {
  const { isTauriRuntime } = await import('./versionUpdateContext');
  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const dest = await save({
      title: '导出',
      defaultPath: defaultFilename,
      filters: [{ name: filterName, extensions: [filterExt] }],
    });
    if (!dest) return false;
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    // Use writeFile with utf-8 bytes rather than writeTextFile so we
    // re-use the `fs:allow-write-file` capability already permitted
    // for binary `.dryj` exports — no separate text-write permission
    // entry needed.
    const bytes = new TextEncoder().encode(content);
    await writeFile(String(dest), bytes);
    return true;
  }
  // PWA fallback — silent download to browser-default Downloads.
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
