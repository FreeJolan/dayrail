// @dayrail/db — SQLite-over-OPFS persistence layer for DayRail v0.2+.
//
// Consumers should import from the package root for high-level helpers
// (createConnection, runMigrations, etc.) and from `./schema` when they
// need typed table references for Drizzle queries.

export * from './connection';
export * from './schema';
export * from './migrate';
