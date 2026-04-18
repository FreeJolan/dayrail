// Drizzle schema — ERD §10 types translated to SQLite tables.
//
// Design notes:
//   - Only "durable" entities get tables. Transient UI state (e.g.
//     which CycleView section is currently focused, which popover is
//     open) stays in Zustand / component state.
//   - Most entity mutations land as rows in `events`; the domain tables
//     (rails, templates, tracks...) are snapshots derived by reducers
//     from those events. This lets us implement session-level undo by
//     rolling the events table back.
//   - `hlc_wall` + `hlc_logical` columns are a pair materialising the
//     HLC clock from docs/v0.2-plan.md. Sorting by (hlc_wall ASC,
//     hlc_logical ASC, id ASC) yields a deterministic causal order
//     across devices post-sync.

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

// ------------------------------------------------------------------
// Event log — append-only, the single source of truth.
// ------------------------------------------------------------------
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(), // ULID
    aggregateId: text('aggregate_id').notNull(),
    type: text('type').notNull(), // e.g. "rail.updated", "slot.assigned"
    payload: text('payload').notNull(), // JSON-stringified
    hlcWall: integer('hlc_wall').notNull(), // ms since epoch
    hlcLogical: integer('hlc_logical').notNull(),
    sessionId: text('session_id'),
    /** True once a later snapshot supersedes this event; kept only for
     *  archival forensics. Can be pruned by a background compactor. */
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    hlcIdx: index('events_hlc_idx').on(t.hlcWall, t.hlcLogical, t.id),
    sessionIdx: index('events_session_idx').on(t.sessionId),
    aggregateIdx: index('events_aggregate_idx').on(t.aggregateId),
  }),
);

// ------------------------------------------------------------------
// Snapshot — periodic materialised view of the world state. Replay
// starts from the most recent snapshot, not from event 0.
// ------------------------------------------------------------------
export const snapshots = sqliteTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    hlcWall: integer('hlc_wall').notNull(),
    hlcLogical: integer('hlc_logical').notNull(),
    createdAt: integer('created_at').notNull(),
    /** JSON-stringified state blob keyed by aggregate id. */
    state: text('state').notNull(),
    /** How many events this snapshot covers — for observability. */
    eventCount: integer('event_count').notNull(),
  },
  (t) => ({ hlcIdx: index('snapshots_hlc_idx').on(t.hlcWall, t.hlcLogical) }),
);

// ------------------------------------------------------------------
// Edit sessions — tracked for "⤺ Undo this edit session" (§5.3.1).
// Active sessions have `closedAt IS NULL`; archived sessions cannot
// be undone via the button any longer.
// ------------------------------------------------------------------
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  surface: text('surface').notNull(), // 'template-editor' / 'cycle-planner' / ...
  openedAt: integer('opened_at').notNull(),
  closedAt: integer('closed_at'), // nullable
  lastActivityAt: integer('last_activity_at').notNull(),
  changeCount: integer('change_count').notNull().default(0),
});

// ------------------------------------------------------------------
// Domain tables — materialised from events. Kept in the same DB for
// fast read access; the reducer is responsible for keeping them in
// sync with the event log.
// ------------------------------------------------------------------

export const templates = sqliteTable('templates', {
  key: text('key').primaryKey(), // TemplateKey
  name: text('name').notNull(),
  color: text('color'), // RailColor token
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
});

export const rails = sqliteTable(
  'rails',
  {
    id: text('id').primaryKey(),
    templateKey: text('template_key')
      .notNull()
      .references(() => templates.key, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subtitle: text('subtitle'),
    startMinutes: integer('start_minutes').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    color: text('color').notNull(),
    icon: text('icon'),
    /** Matches ERD §5.6 — boolean replaces the old `signal` object. */
    showInCheckin: integer('show_in_checkin', { mode: 'boolean' })
      .notNull()
      .default(true),
    defaultLineId: text('default_line_id'),
    /** Serialised Recurrence (see §10). Mostly 'weekdays' in MVP. */
    recurrence: text('recurrence').notNull().default('{"kind":"weekdays"}'),
  },
  (t) => ({ templateIdx: index('rails_template_idx').on(t.templateKey) }),
);

// Persistent Cycle records (§5.3 / §9.7). v0.3.2 scope: label-only,
// 7-day Monday-anchored — event log + reducer is authoritative, this
// table kept around for Drizzle typing consistency. v0.4 extends to
// custom lengths via endDate.
export const cycles = sqliteTable(
  'cycles',
  {
    id: text('id').primaryKey(),
    startDate: text('start_date').notNull(), // ISO YYYY-MM-DD, Monday-anchored
    endDate: text('end_date').notNull(),
    label: text('label'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({ startIdx: index('cycles_start_idx').on(t.startDate) }),
);

export const cycleDays = sqliteTable(
  'cycle_days',
  {
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    templateKey: text('template_key').notNull(),
    overridden: integer('overridden', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cycleId, t.date] }) }),
);

export const slots = sqliteTable(
  'slots',
  {
    cycleId: text('cycle_id').notNull(),
    date: text('date').notNull(),
    railId: text('rail_id').notNull(),
    /** Free-text label for a slot that has no Task attached (the
     *  "quick text" slot form from §5.3). Name kept for historical
     *  reasons — any column rename would require another migration. */
    label: text('task_name'),
    taskIds: text('task_ids').notNull().default('[]'), // JSON array
  },
  (t) => ({ pk: primaryKey({ columns: [t.cycleId, t.date, t.railId] }) }),
);

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  date: text('date').notNull().unique(),
  tz: text('tz').notNull(),
  templateKey: text('template_key'),
});

export const railInstances = sqliteTable(
  'rail_instances',
  {
    id: text('id').primaryKey(),
    railId: text('rail_id').notNull(),
    date: text('date').notNull(),
    plannedStart: text('planned_start').notNull(),
    plannedEnd: text('planned_end').notNull(),
    actualStart: text('actual_start'),
    actualEnd: text('actual_end'),
    status: text('status').notNull().default('pending'), // pending / active / done / skipped
    overrides: text('overrides'), // JSON or null
    sessionId: text('session_id'),
  },
  (t) => ({
    dateIdx: index('rail_instances_date_idx').on(t.date),
    railIdx: index('rail_instances_rail_idx').on(t.railId),
  }),
);

export const shifts = sqliteTable(
  'shifts',
  {
    id: text('id').primaryKey(),
    railInstanceId: text('rail_instance_id').notNull(),
    type: text('type').notNull(), // postpone / swap / skip / resize / replace
    at: text('at').notNull(),
    payload: text('payload').notNull(), // JSON
    /** Comma-joined tag array (normalised via §5.2 tag library in v0.3). */
    tags: text('tags'),
    reason: text('reason'), // 500-char cap enforced at write time
  },
  (t) => ({ instanceIdx: index('shifts_instance_idx').on(t.railInstanceId) }),
);

export const signals = sqliteTable(
  'signals',
  {
    id: text('id').primaryKey(),
    railInstanceId: text('rail_instance_id').notNull(),
    actedAt: text('acted_at').notNull(),
    response: text('response').notNull(), // done / skip / shift / ignore
    surface: text('surface').notNull(), // check-in-strip / pending-queue
  },
  (t) => ({ instanceIdx: index('signals_instance_idx').on(t.railInstanceId) }),
);

export const lines = sqliteTable('lines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color'),
  status: text('status').notNull().default('active'), // active / archived / deleted
  kind: text('kind').notNull().default('project'), // project / habit / group
  /** Built-in Lines are immutable via user action. Reserved for `line-inbox`. */
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  plannedStart: text('planned_start'),
  plannedEnd: text('planned_end'),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
  deletedAt: integer('deleted_at'),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    lineId: text('line_id')
      .notNull()
      .references(() => lines.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    note: text('note'),
    order: integer('order').notNull().default(0),
    status: text('status').notNull().default('pending'),
    milestonePercent: integer('milestone_percent'), // null = not a milestone
    subItems: text('sub_items'), // JSON array or null
    slotCycleId: text('slot_cycle_id'),
    slotDate: text('slot_date'),
    slotRailId: text('slot_rail_id'),
    doneAt: text('done_at'),
    archivedAt: text('archived_at'),
    deletedAt: text('deleted_at'),
  },
  (t) => ({ lineIdx: index('tasks_line_idx').on(t.lineId) }),
);

export const calendarRules = sqliteTable('calendar_rules', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // weekday / cycle / date-range / single-date
  value: text('value').notNull(), // JSON
  priority: integer('priority').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});


export const adhocEvents = sqliteTable(
  'adhoc_events',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    startMinutes: integer('start_minutes').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    name: text('name').notNull(),
    color: text('color'),
    lineId: text('line_id'),
    /** §5.5.2 free-time Task scheduling: a Task's unscheduled state
     *  soft-deletes the backing Ad-hoc. */
    taskId: text('task_id'),
    status: text('status').notNull().default('active'), // active / deleted
    deletedAt: text('deleted_at'),
  },
  (t) => ({ dateIdx: index('adhoc_date_idx').on(t.date) }),
);

// ------------------------------------------------------------------
// Migration bookkeeping — primitive until we pull in drizzle-kit.
// `version` advances by one on each successful migration; the newest
// row indicates the current schema generation.
// ------------------------------------------------------------------
export const schemaVersion = sqliteTable('schema_version', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at').notNull(),
});

// ------------------------------------------------------------------
// DDL — applied once at startup. Keep idempotent. As the schema
// evolves, add new statements AFTER the existing ones, guarded by a
// version check.
// ------------------------------------------------------------------
export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  hlc_wall INTEGER NOT NULL,
  hlc_logical INTEGER NOT NULL,
  session_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_hlc_idx ON events(hlc_wall, hlc_logical, id);
CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id);
CREATE INDEX IF NOT EXISTS events_aggregate_idx ON events(aggregate_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  hlc_wall INTEGER NOT NULL,
  hlc_logical INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  event_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_hlc_idx ON snapshots(hlc_wall, hlc_logical);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  surface TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  last_activity_at INTEGER NOT NULL,
  change_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS templates (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rails (
  id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL REFERENCES templates(key) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subtitle TEXT,
  start_minutes INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  color TEXT NOT NULL,
  icon TEXT,
  show_in_checkin INTEGER NOT NULL DEFAULT 1,
  default_line_id TEXT,
  recurrence TEXT NOT NULL DEFAULT '{"kind":"weekdays"}'
);
CREATE INDEX IF NOT EXISTS rails_template_idx ON rails(template_key);

CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cycles_start_idx ON cycles(start_date);

CREATE TABLE IF NOT EXISTS cycle_days (
  cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  template_key TEXT NOT NULL,
  overridden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_id, date)
);

CREATE TABLE IF NOT EXISTS slots (
  cycle_id TEXT NOT NULL,
  date TEXT NOT NULL,
  rail_id TEXT NOT NULL,
  task_name TEXT,
  task_ids TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (cycle_id, date, rail_id)
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  tz TEXT NOT NULL,
  template_key TEXT
);

CREATE TABLE IF NOT EXISTS rail_instances (
  id TEXT PRIMARY KEY,
  rail_id TEXT NOT NULL,
  date TEXT NOT NULL,
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  overrides TEXT,
  session_id TEXT
);
CREATE INDEX IF NOT EXISTS rail_instances_date_idx ON rail_instances(date);
CREATE INDEX IF NOT EXISTS rail_instances_rail_idx ON rail_instances(rail_id);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  rail_instance_id TEXT NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  payload TEXT NOT NULL,
  tags TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS shifts_instance_idx ON shifts(rail_instance_id);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  rail_instance_id TEXT NOT NULL,
  acted_at TEXT NOT NULL,
  response TEXT NOT NULL,
  surface TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_instance_idx ON signals(rail_instance_id);

CREATE TABLE IF NOT EXISTS lines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  kind TEXT NOT NULL DEFAULT 'project',
  is_default INTEGER NOT NULL DEFAULT 0,
  planned_start TEXT,
  planned_end TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  milestone_percent INTEGER,
  sub_items TEXT,
  slot_cycle_id TEXT,
  slot_date TEXT,
  slot_rail_id TEXT,
  done_at TEXT,
  archived_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_line_idx ON tasks(line_id);

CREATE TABLE IF NOT EXISTS calendar_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);


CREATE TABLE IF NOT EXISTS adhoc_events (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_minutes INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  line_id TEXT,
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS adhoc_date_idx ON adhoc_events(date);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`;
