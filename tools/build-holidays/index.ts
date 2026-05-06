// Generate apps/web/src/data/holidays/zh-CN.json from:
//   1. NateScarlet/holiday-cn — State Council statutory off-days +
//      makeup workdays (`调休`).
//   2. A small in-script generator for non-statutory observances —
//      fixed-solar (妇女节 / 教师节 / 圣诞) + Sunday-relative (母亲节 /
//      父亲节) + lunar-derived (元宵 / 七夕 / 重阳, via lunar-typescript).
//
// See ./README.md for run cadence + design rationale.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lunar } from 'lunar-typescript';

// ---------------- Configuration ----------------

const YEARS_TO_FETCH = [2024, 2025, 2026, 2027];

/** Hand-curated English labels for the statutory holiday names. */
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
  date: string;
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
  kind: 'holiday' | 'observance' | 'makeup-workday';
}

interface OutputDataset {
  regionCode: string;
  displayName: Record<string, string>;
  events: OutputEvent[];
}

// ---------------- Statutory holidays + makeup workdays ----------------

/** Resolve an upstream `day.name` into a locale-dictionary label. The
 *  upstream feed combines names like `国庆节、中秋节` when two
 *  holidays overlap; the build script splits these on `、` into
 *  multiple separate ExternalEvent rows so each gets its own chip. */
function splitHolidayNames(rawName: string): string[] {
  return rawName.split('、').map((p) => p.trim()).filter(Boolean);
}

function lookupEn(name: string): string | null {
  return HOLIDAY_NAME_EN[name] ?? null;
}

function transformYearStatutory(upstream: UpstreamYearFile): OutputEvent[] {
  const out: OutputEvent[] = [];
  const unknownNames = new Set<string>();
  for (const day of upstream.days) {
    const names = splitHolidayNames(day.name);
    for (const name of names) {
      const en = lookupEn(name);
      if (en === null) {
        unknownNames.add(name);
        continue;
      }
      if (day.isOffDay) {
        // Statutory holiday off-day. Each name in a combined day
        // (e.g. 国庆节、中秋节 on 2025-10-06) becomes its own row so
        // the renderer shows two distinct chips.
        out.push({
          date: day.date,
          label: { 'zh-CN': name, en },
          kind: 'holiday',
        });
      } else {
        // Makeup workday. ERD §14.3 — different from `holiday`: this
        // day looks like a weekend but is a working day because of an
        // adjacent holiday extension. Label gets a `调休·` prefix so
        // the user sees the warning at a glance; English mirrors with
        // `Makeup Workday · {name}` for consistency.
        out.push({
          date: day.date,
          label: {
            'zh-CN': `调休·${name}`,
            en: `Makeup Workday · ${en}`,
          },
          kind: 'makeup-workday',
        });
      }
    }
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

// ---------------- Non-statutory observances ----------------

/** Build the date of the n-th occurrence of a given weekday in a given
 *  Gregorian month. `weekday` follows JS convention (0 = Sun … 6 = Sat).
 *  `n` is 1-indexed. Months are 1-indexed (1 = January). */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number,
): string {
  // First day of the month → its weekday → offset to the first
  // occurrence of `weekday` → add (n-1) weeks.
  const firstOfMonth = new Date(year, month - 1, 1);
  const firstWeekday = firstOfMonth.getDay();
  let day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  // Verify the result is still in the same month.
  const result = new Date(year, month - 1, day);
  if (result.getMonth() !== month - 1) {
    throw new Error(
      `[build-holidays] no ${n}-th occurrence of weekday ${weekday} in ${year}-${month}`,
    );
  }
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/** Convert a lunar date to a Gregorian date (YYYY-MM-DD). Powered by
 *  `lunar-typescript`. The lunar-year input matches the conventional
 *  "nth lunar year" — for 元宵/七夕/重阳, the lunar year aligns with
 *  the Gregorian year that contains them (since all three fall in
 *  Lunar months 1, 7, 9, which always map to Gregorian months in the
 *  same Gregorian year). */
function lunarToSolar(year: number, lunarMonth: number, lunarDay: number): string {
  return Lunar.fromYmd(year, lunarMonth, lunarDay).getSolar().toYmd();
}

interface ObservanceSpec {
  zhName: string;
  enName: string;
  /** Returns YYYY-MM-DD given the Gregorian year. */
  resolveDate: (year: number) => string;
}

const OBSERVANCES: ReadonlyArray<ObservanceSpec> = [
  // Lunar-derived (resolved at build time via lunar-typescript).
  {
    zhName: '元宵节',
    enName: 'Lantern Festival',
    resolveDate: (y) => lunarToSolar(y, 1, 15),
  },
  // Fixed solar.
  {
    zhName: '妇女节',
    enName: "International Women's Day",
    resolveDate: (y) => `${y}-03-08`,
  },
  // Sunday-relative.
  {
    zhName: '母亲节',
    enName: "Mother's Day",
    resolveDate: (y) => nthWeekdayOfMonth(y, 5, 0, 2), // 2nd Sunday of May
  },
  {
    zhName: '父亲节',
    enName: "Father's Day",
    resolveDate: (y) => nthWeekdayOfMonth(y, 6, 0, 3), // 3rd Sunday of June
  },
  // Lunar.
  {
    zhName: '七夕',
    enName: 'Qixi Festival',
    resolveDate: (y) => lunarToSolar(y, 7, 7),
  },
  // Fixed solar.
  {
    zhName: '教师节',
    enName: "Teachers' Day",
    resolveDate: (y) => `${y}-09-10`,
  },
  // Lunar.
  {
    zhName: '重阳节',
    enName: 'Chongyang Festival',
    resolveDate: (y) => lunarToSolar(y, 9, 9),
  },
  // Fixed solar.
  {
    zhName: '圣诞节',
    enName: 'Christmas',
    resolveDate: (y) => `${y}-12-25`,
  },
];

function observancesForYear(year: number): OutputEvent[] {
  return OBSERVANCES.map((spec) => ({
    date: spec.resolveDate(year),
    label: { 'zh-CN': spec.zhName, en: spec.enName },
    kind: 'observance' as const,
  }));
}

// ---------------- Fetch + main ----------------

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

async function main(): Promise<void> {
  const events: OutputEvent[] = [];
  let totalEmpty = 0;

  for (const year of YEARS_TO_FETCH) {
    // 1. Statutory holidays + makeup workdays from upstream feed.
    const upstream = await fetchYear(year);
    if (!upstream) continue;
    if (upstream.days.length === 0) {
      console.warn(
        `[build-holidays] ${year}: upstream file is empty (notice not yet published?)`,
      );
      totalEmpty++;
    } else {
      const statutory = transformYearStatutory(upstream);
      const offDays = statutory.filter((e) => e.kind === 'holiday').length;
      const makeup = statutory.filter((e) => e.kind === 'makeup-workday').length;
      console.log(
        `[build-holidays] ${year}: ${offDays} off-day events + ${makeup} makeup workdays`,
      );
      events.push(...statutory);
    }

    // 2. Non-statutory observances — emitted regardless of whether
    //    upstream has the year yet (these are fully derived from the
    //    Gregorian / lunar calendar, no notice needed).
    const observances = observancesForYear(year);
    console.log(
      `[build-holidays] ${year}: ${observances.length} observances`,
    );
    events.push(...observances);
  }

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    // Stable secondary sort: holiday → observance → makeup-workday.
    // This mirrors the renderer's source-priority ordering and makes
    // diffs between regenerations stable.
    const order: Record<OutputEvent['kind'], number> = {
      holiday: 0,
      observance: 1,
      'makeup-workday': 2,
    };
    return order[a.kind] - order[b.kind];
  });

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
        ? ` (${totalEmpty} year(s) had empty upstream files; observances still added)`
        : ''),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
