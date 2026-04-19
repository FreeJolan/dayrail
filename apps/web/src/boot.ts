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
  INBOX_LINE_ID,
  materializeAutoTasksForToday,
  toIsoDate,
  useStore,
  type Line,
  type Rail,
  type RailColor,
} from '@dayrail/core';
import {
  SAMPLE_RAILS_BY_TEMPLATE,
  SAMPLE_TEMPLATES,
} from './data/sampleTemplate';

export async function boot(): Promise<void> {
  // 0. Pre-flight capability probe. Catches common environment issues
  //    (private browsing, missing OPFS, etc.) before we get deep into
  //    sqlite-wasm and report a surprising error message.
  await preflight();

  // 1. Hydrate from DB
  await useStore.getState().hydrate();

  // 2. First-run seeding
  const s = useStore.getState();
  if (Object.keys(s.templates).length === 0) {
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
