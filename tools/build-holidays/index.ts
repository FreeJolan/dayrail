// Generate apps/web/src/data/holidays/zh-CN.json from the upstream
// NateScarlet/holiday-cn dataset. See ./README.md for run / cadence /
// scope rationale.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------- Configuration ----------------

/** Years to fetch. The State Council publishes each year's notice
 *  separately (typically in Nov/Dec of the prior year), so as new
 *  years become available upstream we add them here. Past years are
 *  retained so users browsing back in time still see chips. */
const YEARS_TO_FETCH = [2024, 2025, 2026, 2027];

/** Hand-curated English labels for the statutory holiday names. The
 *  statutory list has been stable since 2008; new entries are very
 *  rare, but if upstream surfaces one (e.g. a brand-new commemorative
 *  day), the script will exit with an error pointing here. */
const HOLIDAY_NAME_EN: Record<string, string> = {
  元旦: "New Year's Day",
  春节: 'Spring Festival',
  清明节: 'Tomb-Sweeping Day',
  劳动节: 'Labour Day',
  端午节: 'Dragon Boat Festival',
  中秋节: 'Mid-Autumn Festival',
  国庆节: 'National Day',
};

const REGION_CODE = 'zh-CN';
const DISPLAY_NAME: Record<string, string> = {
  'zh-CN': '中国大陆',
  en: 'Mainland China',
};

const UPSTREAM_BASE =
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master';

// ---------------- Types (mirroring @dayrail/core) ----------------

interface UpstreamDay {
  name: string;
  date: string; // YYYY-MM-DD
  isOffDay: boolean;
}

interface UpstreamYearFile {
  year: number;
  papers?: string[];
  days: UpstreamDay[];
}

interface OutputEvent {
  date: string;
  label: Record<string, string>;
  kind: 'holiday' | 'observance';
}

interface OutputDataset {
  regionCode: string;
  displayName: Record<string, string>;
  events: OutputEvent[];
}

// ---------------- Fetch + transform ----------------

async function fetchYear(year: number): Promise<UpstreamYearFile | null> {
  const url = `${UPSTREAM_BASE}/${year}.json`;
  const res = await fetch(url);
  if (res.status === 404) {
    console.warn(`[build-holidays] ${year}: upstream returned 404, skipping`);
    return null;
  }
  if (!res.ok) {
    throw new Error(`[build-holidays] ${year}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as UpstreamYearFile;
  return data;
}

/** Resolve the upstream `day.name` into a locale-dictionary label.
 *  Years where two statutory holidays overlap (e.g. 2025-10-06 中秋
 *  falls inside the 国庆 7-day block) are published with a combined
 *  Chinese name like `国庆节、中秋节`. We split on the `、` separator
 *  and look each part up in HOLIDAY_NAME_EN; the English label joins
 *  with ` & ` to keep the same convention. */
function resolveLabel(rawName: string): {
  label: Record<string, string> | null;
  unknown: string[];
} {
  const parts = rawName.split('、').map((p) => p.trim()).filter(Boolean);
  const enParts: string[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const en = HOLIDAY_NAME_EN[p];
    if (en === undefined) unknown.push(p);
    else enParts.push(en);
  }
  if (unknown.length > 0) return { label: null, unknown };
  return {
    label: {
      'zh-CN': rawName,
      en: enParts.join(' & '),
    },
    unknown: [],
  };
}

function transformYear(upstream: UpstreamYearFile): OutputEvent[] {
  const out: OutputEvent[] = [];
  const unknownNames = new Set<string>();
  for (const day of upstream.days) {
    if (!day.isOffDay) continue; // skip makeup workdays (see README)
    const { label, unknown } = resolveLabel(day.name);
    if (label === null) {
      for (const u of unknown) unknownNames.add(u);
      continue;
    }
    out.push({
      date: day.date,
      label,
      kind: 'holiday',
    });
  }
  if (unknownNames.size > 0) {
    throw new Error(
      `[build-holidays] ${upstream.year}: unknown holiday name(s) — add to HOLIDAY_NAME_EN: ${[
        ...unknownNames,
      ].join(', ')}`,
    );
  }
  return out;
}

// ---------------- Main ----------------

async function main(): Promise<void> {
  const events: OutputEvent[] = [];
  let totalEmpty = 0;
  for (const year of YEARS_TO_FETCH) {
    const upstream = await fetchYear(year);
    if (!upstream) continue;
    if (upstream.days.length === 0) {
      console.warn(
        `[build-holidays] ${year}: upstream file is empty (notice not yet published?)`,
      );
      totalEmpty++;
      continue;
    }
    const yearEvents = transformYear(upstream);
    console.log(
      `[build-holidays] ${year}: ${yearEvents.length} off-day events`,
    );
    events.push(...yearEvents);
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  const output: OutputDataset = {
    regionCode: REGION_CODE,
    displayName: DISPLAY_NAME,
    events,
  };

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(
    here,
    '../../apps/web/src/data/holidays/zh-CN.json',
  );
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `[build-holidays] wrote ${events.length} events to ${outPath}` +
      (totalEmpty > 0
        ? ` (${totalEmpty} year(s) had empty upstream files)`
        : ''),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
