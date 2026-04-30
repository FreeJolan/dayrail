#!/usr/bin/env tsx
// One-shot migration script · v0.6 ExportBundle JSON → v0.7 .dryj
//
// Per ERD §7.7: production code does NOT auto-detect or convert old
// bundles. The author runs this once at upgrade time. Result is a
// .dryj container loaded into v0.7 via Settings → 同步 → "Import from
// snapshot".
//
// Usage:
//   tsx tools/migrate/migrate-json-to-yjs.ts <input.json> [output.dryj]
//
// Defaults to <input>.dryj alongside the input file. Refuses to
// overwrite an existing output unless --force is passed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { encodeDryj, type DryjMeta } from '@dayrail/db/dryj';
import {
  createYDoc,
  encodeDocAsUpdate,
  loadFlatStateIntoDoc,
  type FlatState,
} from '@dayrail/db/yjs';

interface V06Bundle {
  app?: string;
  version?: string;
  schemaVersion?: number;
  exportedAt?: string;
  snapshotId?: string;
  parentSnapshotId?: string;
  deviceId?: string;
  deviceLabel?: string;
  state?: Partial<FlatState>;
}

function fail(msg: string): never {
  process.stderr.write(`migrate-json-to-yjs: ${msg}\n`);
  process.exit(1);
}

function parseArgs(): { inputPath: string; outputPath: string; force: boolean } {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length < 1) {
    fail(
      'usage: tsx tools/migrate/migrate-json-to-yjs.ts <input.json> [output.dryj] [--force]',
    );
  }
  const inputPath = resolve(positional[0]!);
  const outputPath = positional[1]
    ? resolve(positional[1])
    : join(
        dirname(inputPath),
        basename(inputPath).replace(/\.json$/i, '') + '.dryj',
      );
  return { inputPath, outputPath, force };
}

function main(): void {
  const { inputPath, outputPath, force } = parseArgs();

  if (!existsSync(inputPath)) fail(`input not found: ${inputPath}`);
  if (existsSync(outputPath) && !force) {
    fail(`output already exists: ${outputPath} (pass --force to overwrite)`);
  }

  const raw = readFileSync(inputPath, 'utf-8');
  let bundle: V06Bundle;
  try {
    bundle = JSON.parse(raw) as V06Bundle;
  } catch (err) {
    fail(`input is not valid JSON: ${(err as Error).message}`);
  }

  if (bundle.app !== 'dayrail') {
    fail(`input does not look like a DayRail export (app=${bundle.app})`);
  }
  if (bundle.schemaVersion !== 1) {
    fail(
      `unexpected schemaVersion ${bundle.schemaVersion} (this script handles v0.6 bundles, schemaVersion=1 only)`,
    );
  }
  if (!bundle.state || typeof bundle.state !== 'object') {
    fail('input is missing the state payload');
  }

  process.stdout.write(`reading ${inputPath}\n`);
  process.stdout.write(`  app=${bundle.app} version=${bundle.version ?? '?'} exportedAt=${bundle.exportedAt ?? '?'}\n`);

  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(bundle.state)) {
    if (value && typeof value === 'object') {
      counts[key] = Object.keys(value).length;
    }
  }
  const summary = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  process.stdout.write(`  contents: ${summary || '(empty)'}\n`);

  const doc = createYDoc();
  loadFlatStateIntoDoc(doc, bundle.state as FlatState);
  const update = encodeDocAsUpdate(doc);

  const meta: DryjMeta = {
    snapshotId: randomUUID(),
    deviceId: bundle.deviceId ?? randomUUID(),
    deviceLabel: 'migration',
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
  };

  const dryj = encodeDryj(meta, update);
  writeFileSync(outputPath, dryj);

  process.stdout.write(`wrote ${outputPath}\n`);
  process.stdout.write(
    `  containerVersion=1 schemaVersion=2 snapshotId=${meta.snapshotId}\n`,
  );
  process.stdout.write(
    `  size: ${dryj.length} bytes (${(dryj.length / 1024).toFixed(1)} KB)\n`,
  );
  process.stdout.write('\nnext: launch v0.7, Settings → 同步 → "Import from snapshot",\n');
  process.stdout.write('      pick the .dryj file. After local Y.Doc is loaded,\n');
  process.stdout.write('      first push promotes it to Drive canonical.\n');
}

main();
