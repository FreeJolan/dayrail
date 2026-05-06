# build-holidays

Generates `apps/web/src/data/holidays/zh-CN.json` from the upstream
`NateScarlet/holiday-cn` dataset, which mirrors the State Council's
official annual holiday notice (`gov.cn` link captured in each
upstream year-file's `papers` field).

## Run

```bash
pnpm --filter @dayrail/build-holidays build
```

Reads `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json`
for every year listed in `YEARS_TO_FETCH`. Writes a sorted
`HolidayDataset` JSON in our schema (ERD §14.2) to
`apps/web/src/data/holidays/zh-CN.json`. Idempotent — the entire
output file is rewritten each run.

## When to re-run

The State Council typically publishes the next year's notice in
November or December. Whenever a new year shows up in
[upstream `master`](https://github.com/NateScarlet/holiday-cn) and is
not yet in our `data/holidays/zh-CN.json`:

1. Add the new year to `YEARS_TO_FETCH` in `index.ts`.
2. `pnpm --filter @dayrail/build-holidays build`.
3. Open a PR with the regenerated JSON.

`pnpm-lock.yaml` is not affected — the script only fetches over HTTP.

## Coverage

Only `isOffDay: true` days from the upstream feed are mapped to
`HolidayDataset.events`. Makeup workdays (`isOffDay: false`, e.g. a
Saturday turned into a workday because the next week extends into a
holiday) are intentionally **dropped** in v0.8.0 — they are a
different visual concept than "this is a holiday" and would warrant
their own `kind` on `ExternalEvent`. Revisit in v0.8.x if useful.

Non-statutory observances (元宵 / 妇女节 / 母亲节 / 父亲节 / 七夕 /
教师节 / 重阳 / 圣诞 etc.) are also out of scope — the upstream
feed only covers statutory off-days. Adding observances would need
either a hand-curated companion file or a lunar-calendar library; see
ERD §14.2 v0.8.x followups.

## English labels

Each statutory holiday name (元旦 / 春节 / 清明节 / 劳动节 / 端午节 /
中秋节 / 国庆节) has a hand-curated English translation in the
`HOLIDAY_NAME_EN` table. New names from future regulations (rare —
the statutory list has been stable for years) need a row added before
re-running the script.

## Source attribution

- Upstream: <https://github.com/NateScarlet/holiday-cn>
- Authoritative root: 国务院办公厅每年公布的《关于xxxx年部分节假日安排的通知》
