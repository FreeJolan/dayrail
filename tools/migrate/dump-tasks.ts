// One-shot inspector for tasks/subItems/milestonePercent in a .dryj
// snapshot. Reports counts, edge-case detection for the upcoming
// occurrences migration.
//
// Usage:
//   pnpm --filter=@dayrail/migrate exec tsx dump-tasks.ts <path/to/.dryj>

import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { decodeDryj } from '@dayrail/db/dryj';

const path = process.argv[2];
if (!path) {
  console.error('usage: tsx dump-tasks.ts <path/to/.dryj>');
  process.exit(1);
}

const decoded = decodeDryj(readFileSync(path));
const doc = new Y.Doc();
Y.applyUpdate(doc, decoded.update);

interface SubItem {
  id: string;
  title: string;
  done: boolean;
}
interface Task {
  id: string;
  lineId: string;
  title: string;
  status: string;
  milestonePercent?: number;
  subItems?: SubItem[];
  slot?: { cycleId: string; date: string; railId: string };
  source?: string;
  doneAt?: string;
  archivedAt?: string;
  deletedAt?: string;
}
interface Line {
  id: string;
  name: string;
  kind?: string;
  status?: string;
}

const tasksMap = doc.getMap('tasks').toJSON() as Record<string, Task>;
const linesMap = doc.getMap('lines').toJSON() as Record<string, Line>;

const tasks = Object.values(tasksMap);
const lines = linesMap;

const lineName = (id: string): string => lines[id]?.name ?? id;

const total = tasks.length;
const byStatus: Record<string, number> = {};
for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

const withSubItems = tasks.filter((t) => (t.subItems?.length ?? 0) > 0);
const withMilestone = tasks.filter((t) => t.milestonePercent != null);
const withSlot = tasks.filter((t) => t.slot != null);
const autoHabit = tasks.filter((t) => t.source === 'auto-habit');

console.log('=== overall ===');
console.log(`total tasks: ${total}`);
console.log(`auto-habit tasks: ${autoHabit.length}`);
console.log(`user tasks: ${total - autoHabit.length}`);
console.log(`status distribution:`, byStatus);
console.log(`with subItems: ${withSubItems.length}`);
console.log(`with milestonePercent: ${withMilestone.length}`);
console.log(`with slot: ${withSlot.length}`);

console.log('\n=== subItem detail (would migrate to occurrences) ===');
for (const t of withSubItems) {
  const items = t.subItems ?? [];
  const done = items.filter((s) => s.done).length;
  const flags: string[] = [];
  if (t.slot) flags.push('+slot');
  if (t.milestonePercent != null) flags.push(`+pct=${t.milestonePercent}`);
  if (t.status === 'done' && done < items.length) flags.push('!status=done while subItems pending');
  if (t.status === 'archived') flags.push('archived');
  if (t.status === 'deleted') flags.push('deleted');
  console.log(
    `- [${lineName(t.lineId)}] ${t.title} · ${done}/${items.length} done · status=${t.status}${
      flags.length ? ' · ' + flags.join(' · ') : ''
    }`,
  );
  for (const s of items) {
    console.log(`    ${s.done ? 'x' : ' '} ${s.title}`);
  }
}

console.log('\n=== milestonePercent detail (degenerate occurrence case) ===');
for (const t of withMilestone) {
  const subCount = t.subItems?.length ?? 0;
  const flags: string[] = [];
  if (subCount > 0) flags.push(`+${subCount} subItems`);
  if (t.slot) flags.push('+slot');
  console.log(
    `- [${lineName(t.lineId)}] ${t.title} · ${t.milestonePercent}% · status=${t.status}${
      flags.length ? ' · ' + flags.join(' · ') : ''
    }`,
  );
}

console.log('\n=== edge cases for migration ===');
const edges = {
  doneStatusButPendingSubItems: tasks.filter(
    (t) =>
      t.status === 'done' &&
      (t.subItems?.length ?? 0) > 0 &&
      (t.subItems ?? []).some((s) => !s.done),
  ),
  pendingStatusAllSubItemsDone: tasks.filter(
    (t) =>
      t.status === 'pending' &&
      (t.subItems?.length ?? 0) > 0 &&
      (t.subItems ?? []).every((s) => s.done),
  ),
  archivedWithSubItems: tasks.filter(
    (t) => t.status === 'archived' && (t.subItems?.length ?? 0) > 0,
  ),
  deletedWithSubItems: tasks.filter(
    (t) => t.status === 'deleted' && (t.subItems?.length ?? 0) > 0,
  ),
  slotPlusSubItems: tasks.filter(
    (t) => t.slot != null && (t.subItems?.length ?? 0) > 0,
  ),
  slotPlusMilestone: tasks.filter(
    (t) => t.slot != null && t.milestonePercent != null,
  ),
  subItemsPlusMilestone: tasks.filter(
    (t) => (t.subItems?.length ?? 0) > 0 && t.milestonePercent != null,
  ),
  duplicateSubItemIds: tasks
    .map((t) => {
      const ids = (t.subItems ?? []).map((s) => s.id);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      return { task: t, dup };
    })
    .filter((x) => x.dup.length > 0),
  emptySubItemTitles: tasks.filter(
    (t) => (t.subItems ?? []).some((s) => !s.title || s.title.trim() === ''),
  ),
};

for (const [k, v] of Object.entries(edges)) {
  console.log(`${k}: ${v.length}`);
  for (const t of v.slice(0, 5)) {
    const tt = (t as { task?: Task }).task ?? (t as Task);
    console.log(`    - [${lineName(tt.lineId)}] ${tt.title} (id=${tt.id})`);
  }
}
