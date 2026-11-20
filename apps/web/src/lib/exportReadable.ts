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

import {
  railAtDate,
  selectEffectiveTaskSlots,
  useStore,
  type DayRailState,
  type Task,
  type TaskOccurrence,
} from '@dayrail/core';

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

/** Tasks as CSV. One row per task — except occurrence-managed tasks
 *  (ERD §10.6), which export one row per occurrence: the schedule /
 *  status / timestamps live on the occurrences there (`task.slot` is
 *  cleared at adoption), so a single task-level row would export an
 *  empty date and a stale status. Inbox / unscheduled rows have an
 *  empty `date` column. */
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

  // Collect row records first so occurrence rows can sort by their own
  // date: date desc (unscheduled at bottom), then created order.
  const records: Array<{ date: string; order: number; cols: string[] }> = [];

  const occsByTask = new Map<string, TaskOccurrence[]>();
  for (const occ of Object.values(state.taskOccurrences)) {
    const list = occsByTask.get(occ.taskId);
    if (list) list.push(occ);
    else occsByTask.set(occ.taskId, [occ]);
  }

  for (const t of Object.values(state.tasks)) {
    const occs = (occsByTask.get(t.id) ?? []).sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    });
    if (occs.length > 0) {
      for (const occ of occs) {
        const label = occ.label?.trim();
        records.push({
          date: occ.slot?.date ?? '',
          order: t.order,
          cols: [
            occ.slot?.date ?? '',
            lineName(t.lineId),
            label ? `${t.title} · ${label}` : t.title,
            occ.status,
            t.priority ?? '',
            (occ.note ?? '').replace(/\r?\n/g, ' '),
            taskCreatedAt(t),
            occ.doneAt ?? '',
            '',
            occ.archivedAt ?? '',
          ],
        });
      }
      continue;
    }
    records.push({
      date: t.slot?.date ?? '',
      order: t.order,
      cols: [
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
      ],
    });
  }

  records.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.order - b.order;
  });

  const rows: string[] = [headers.map(csvEscape).join(',')];
  for (const r of records) {
    rows.push(r.cols.map(csvEscape).join(','));
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

/** Rail-slot schedules (Mode A) exported as VEVENTs — the task's
 *  EFFECTIVE schedule per ERD §10.6: for occurrence-managed tasks one
 *  event per slot-bearing occurrence (that's where the schedule lives;
 *  `task.slot` is cleared at adoption), otherwise the legacy
 *  `task.slot`. Time = the rail revision in effect ON the slot's date
 *  (§10.5 effective-from — matches what the app showed that day, not
 *  whatever the rail was later changed to). Unscheduled tasks and
 *  free-time AdhocEvents are skipped — rail slots are the only ones
 *  with unambiguous start/end times in DayRail's model. */
export function formatScheduleAsIcal(state: DayRailState): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayRail//Schedule Export//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const task of Object.values(state.tasks)) {
    if (task.status === 'deleted' || task.status === 'archived') {
      continue;
    }
    for (const entry of selectEffectiveTaskSlots(state, task)) {
      // Archived occurrence = "never did this split"; mirror the
      // task-level archived skip above.
      if (entry.occurrence?.status === 'archived') continue;
      const rev = railAtDate(
        state,
        entry.slot.railId,
        entry.slot.date,
      );
      if (!rev) continue;
      const dt = computeIcalTimes(
        entry.slot.date,
        rev.startMinutes,
        rev.durationMinutes,
      );
      if (!dt) continue;

      const occ = entry.occurrence;
      const label = occ?.label?.trim();
      const summary = label || task.title || rev.name;
      const status = occ ? occ.status : task.status;
      // §10.6 v0.12.2 — occurrence rows surface their own note only.
      const note = occ ? occ.note : task.note;
      const description = [
        rev.subtitle ? `Rail: ${rev.name} · ${rev.subtitle}` : `Rail: ${rev.name}`,
        occ && label && label !== task.title ? `Task: ${task.title}` : null,
        note ? `Note: ${note}` : null,
        `Status: ${status}`,
      ]
        .filter(Boolean)
        // Join with a REAL newline — escapeIcalText turns it into the
        // RFC 5545 `\n` sequence. Joining with a literal backslash-n
        // here would get its backslash doubled by the escaper and render
        // as the two characters "\n" in calendar apps.
        .join('\n');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${occ?.id ?? task.id}@dayrail`);
      lines.push(`DTSTAMP:${dt.stamp}`);
      lines.push(`DTSTART:${dt.start}`);
      lines.push(`DTEND:${dt.end}`);
      lines.push(`SUMMARY:${escapeIcalText(summary)}`);
      lines.push(`DESCRIPTION:${escapeIcalText(description)}`);
      lines.push('END:VEVENT');
    }
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
