// App bootstrap — opens the DB, replays events, seeds the default
// templates + rails on first run. Called from `main.tsx` before
// the React tree mounts; the app shell renders a loading veil while
// this promise is pending.
//
// Seeding strategy: if the templates table is empty after replay we
// emit the sample data as actual events (same path any user mutation
// takes), so first-run state is indistinguishable from the output of
// a user performing those same edits by hand.

import {
  currentClock,
  INBOX_LINE_ID,
  materializeAutoTasksForToday,
  toIsoDate,
  useStore,
  writeSnapshot,
  type Line,
  type Rail,
  type RailColor,
} from '@dayrail/core';
import {
  SAMPLE_RAILS_BY_TEMPLATE,
  SAMPLE_TEMPLATES,
} from './data/sampleTemplate';
import type { ExportBundle } from './lib/exportData';
import { popPendingImport } from './lib/importData';

export async function boot(): Promise<void> {
  // 0. Pre-flight capability probe. Catches common environment issues
  //    (private browsing, missing OPFS, etc.) before we get deep into
  //    sqlite-wasm and report a surprising error message.
  await preflight();

  // 0.25. Request persistent storage so the browser doesn't evict OPFS
  //       under disk pressure. Chrome/Edge auto-grant for installed
  //       PWAs, silently refuse for one-off visits — either way we
  //       never throw. Safari supports the API but its 7-day rule for
  //       non-persisted origins is the bigger risk there (see docs/
  //       ROADMAP.md "数据安全"). Fire-and-forget; no data path
  //       depends on the outcome.
  void requestPersistentStorage();

  // 0.5. Pending import from the previous page (user just clicked
  //      "Import" in Settings → Advanced). We wrote a snapshot to the
  //      freshly-wiped DB BEFORE hydrate so the normal load path picks
  //      it up without touching the reducer.
  const pending = popPendingImport();
  if (pending) {
    await writeImportedSnapshot(pending);
  }

  // 1. Hydrate from DB
  await useStore.getState().hydrate();

  // 2. First-run seeding — skip when we just imported; the bundle's
  //    state already populated everything.
  const s = useStore.getState();
  if (Object.keys(s.templates).length === 0 && !pending) {
    await seedFromSamples();
  }

  // 3. Ensure the built-in Inbox Line exists. Runs every boot (cheap
  //    no-op after first run); the Inbox is a system singleton so we
  //    insist on its presence regardless of the user's Line edits.
  await ensureInbox();

  // 4. Seed the two built-in weekday rules (workday M–F / restday Sat-
  //    Sun) matching the v0.2 hardcoded heuristic. Runs every boot —
  //    no-op after the first. Users that deleted a weekday rule on
  //    purpose won't have it re-added; we key on "templateKey-specific
  //    rule exists" rather than "any weekday rule exists".
  await ensureBuiltinWeekdayRules();

  // 5. Materialise today's habit auto-tasks (§10.2 strategy Ⅱ).
  //    Idempotent — deterministic ids + (habit, cycle) markers make
  //    this a no-op after the first call within the same cycle. The
  //    Cycle-View / rhythm-strip / Calendar triggers will later close
  //    the week-wide window when the user opens those surfaces.
  const today = toIsoDate();
  await materializeAutoTasksForToday(today);
}

async function ensureBuiltinWeekdayRules(): Promise<void> {
  const store = useStore.getState();
  const hasRuleFor = (templateKey: string): boolean =>
    !!store.calendarRules[`cr-weekday-${templateKey}`];
  if (store.templates['workday'] && !hasRuleFor('workday')) {
    await store.upsertWeekdayRule('workday', [1, 2, 3, 4, 5]);
  }
  if (store.templates['restday'] && !hasRuleFor('restday')) {
    await store.upsertWeekdayRule('restday', [0, 6]);
  }
}

async function ensureInbox(): Promise<void> {
  const store = useStore.getState();
  if (store.lines[INBOX_LINE_ID]) return;
  const inbox: Line = {
    id: INBOX_LINE_ID,
    name: '随手记',
    kind: 'project',
    status: 'active',
    isDefault: true,
    createdAt: Date.now(),
  };
  await store.createLine(inbox);
}

/** Ask the browser to mark this origin's storage as persistent. A
 *  granted request means the browser promises not to evict OPFS under
 *  disk pressure — the main defense against silent data loss on a
 *  self-use install. Never throws: API-missing / denied / already-
 *  granted all flow through without user-visible effect. */
async function requestPersistentStorage(): Promise<void> {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) return;
  const storage = navigator.storage;
  if (typeof storage.persist !== 'function') return;
  try {
    const already =
      typeof storage.persisted === 'function' ? await storage.persisted() : false;
    if (already) return;
    await storage.persist();
  } catch {
    // Older Firefox / unusual environments — swallow. Persistence is
    // a best-effort hint, not a correctness requirement.
  }
}

async function preflight(): Promise<void> {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) {
    throw new Error(
      'navigator.storage 不可用 —— 可能是非安全上下文（需 https 或 localhost）。',
    );
  }
  const storage = navigator.storage;
  if (typeof storage.getDirectory !== 'function') {
    throw new Error(
      'OPFS 不可用 —— navigator.storage.getDirectory 未实现（需 Chrome 86+ / Safari 15.2+）。',
    );
  }
  try {
    await storage.getDirectory();
  } catch (err) {
    throw new Error(`OPFS 根目录无法访问：${(err as Error).message}`);
  }
}

/** Write the imported bundle's state as a snapshot in the (fresh,
 *  empty) DB. Hydrate below will then read the snapshot as if it were
 *  a legitimate saved-state — no event replay needed. Bundle shape
 *  matches SnapshotPayload one-to-one. */
async function writeImportedSnapshot(bundle: ExportBundle): Promise<void> {
  const state = bundle.state as Record<string, Record<string, unknown>>;
  await writeSnapshot(
    {
      templates: state.templates ?? {},
      rails: state.rails ?? {},
      signals: state.signals ?? {},
      shifts: state.shifts ?? {},
      lines: state.lines ?? {},
      tasks: state.tasks ?? {},
      adhocEvents: state.adhocEvents ?? {},
      calendarRules: state.calendarRules ?? {},
      cycles: state.cycles ?? {},
      habitPhases: state.habitPhases ?? {},
      habitBindings: state.habitBindings ?? {},
    },
    currentClock(),
    /* eventCount */ 0,
  );
}

async function seedFromSamples(): Promise<void> {
  const store = useStore.getState();

  for (const tpl of SAMPLE_TEMPLATES) {
    await store.upsertTemplate({
      key: tpl.key,
      name: tpl.label,
      color: tpl.color as RailColor,
      isDefault: tpl.builtIn,
    });
  }

  for (const templateKey of Object.keys(
    SAMPLE_RAILS_BY_TEMPLATE,
  ) as Array<keyof typeof SAMPLE_RAILS_BY_TEMPLATE>) {
    const list = SAMPLE_RAILS_BY_TEMPLATE[templateKey];
    if (!list) continue;
    for (const r of list) {
      const rail: Rail = {
        id: r.id,
        templateKey,
        name: r.name,
        ...(r.subtitle && { subtitle: r.subtitle }),
        startMinutes: r.startMin,
        durationMinutes: r.endMin - r.startMin,
        color: r.color as RailColor,
        showInCheckin: r.showInCheckin,
      };
      await store.createRail(rail);
    }
  }
}
