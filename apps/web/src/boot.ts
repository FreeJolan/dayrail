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
  ensureTodayInstances,
  selectActiveTemplateKey,
  toIsoDate,
  useStore,
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

  // 3. Materialise today's rail instances. Idempotent: on subsequent
  //    boots we skip rails that already have an instance for today.
  const today = toIsoDate();
  const templateKey = selectActiveTemplateKey(useStore.getState());
  if (templateKey) {
    await ensureTodayInstances(today, templateKey);
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
    for (const r of list) {
      const rail: Rail = {
        id: r.id,
        templateKey,
        name: r.name,
        subtitle: r.subtitle,
        startMinutes: r.startMin,
        durationMinutes: r.endMin - r.startMin,
        color: r.color as RailColor,
        showInCheckin: r.showInCheckin,
        defaultLineId: r.defaultLineId ?? undefined,
        recurrence: { kind: 'weekdays' },
      };
      await store.createRail(rail);
    }
  }
}
