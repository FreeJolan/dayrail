// Extract `templates` + `rails` from a .dryj snapshot · prints
// Markdown + JSON to stdout. One-shot tool · used to share template
// design with an external AI agent without exposing the rest of the
// Y.Doc payload (tasks / reflections / etc.).
//
// Usage:
//   pnpm --filter=@dayrail/migrate exec tsx dump-templates.ts <path/to/dayrail-snapshot.dryj>

import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { decodeDryj } from '@dayrail/db/dryj';

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const path = process.argv[2];
if (!path) fail('usage: tsx dump-templates.ts <path/to/.dryj>');

const dryjBytes = readFileSync(path);
const decoded = decodeDryj(dryjBytes);
const doc = new Y.Doc();
Y.applyUpdate(doc, decoded.update);

const templates = doc.getMap('templates').toJSON() as Record<string, unknown>;
const rails = doc.getMap('rails').toJSON() as Record<string, unknown>;

interface Template {
  key: string;
  name?: string;
  color?: string;
  isDefault?: boolean;
  description?: string;
}
interface Rail {
  id: string;
  templateKey: string;
  name: string;
  color?: string;
  startMinutes: number;
  durationMinutes: number;
  showInCheckin?: boolean;
}

const templateList = Object.values(templates) as Template[];
const railList = Object.values(rails) as Rail[];

// Group rails under their template, sort by startMinutes.
const railsByTemplate = new Map<string, Rail[]>();
for (const r of railList) {
  if (!railsByTemplate.has(r.templateKey)) railsByTemplate.set(r.templateKey, []);
  railsByTemplate.get(r.templateKey)!.push(r);
}
for (const arr of railsByTemplate.values()) {
  arr.sort((a, b) => a.startMinutes - b.startMinutes);
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const mdLines: string[] = ['# DayRail templates', ''];
for (const t of templateList) {
  const label = t.name ?? t.key;
  mdLines.push(
    `## ${label} (\`${t.key}\`${t.color ? ` · color=${t.color}` : ''}${
      t.isDefault ? ' · default' : ''
    })`,
  );
  if (t.description) {
    mdLines.push('');
    mdLines.push(t.description);
  }
  mdLines.push('');
  const rs = railsByTemplate.get(t.key) ?? [];
  if (rs.length === 0) {
    mdLines.push('_(no rails)_');
  } else {
    for (const r of rs) {
      const end = r.startMinutes + r.durationMinutes;
      mdLines.push(
        `- ${fmtTime(r.startMinutes)}–${fmtTime(end)} · ${r.name}` +
          (r.color ? ` · ${r.color}` : '') +
          (r.showInCheckin === false ? ' · (隐藏在 check-in 条之外)' : ''),
      );
    }
  }
  mdLines.push('');
}

console.log(mdLines.join('\n'));
console.log('---');
console.log('## JSON (raw)');
console.log('```json');
console.log(
  JSON.stringify(
    {
      templates: templateList,
      rails: Object.values(rails),
    },
    null,
    2,
  ),
);
console.log('```');
