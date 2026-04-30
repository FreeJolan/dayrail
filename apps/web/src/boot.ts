// App bootstrap (v0.7) — opens the Y.Doc-backed store from OPFS,
// seeds defaults on first run. Called from `main.tsx` before the
// React tree mounts; the app shell renders a loading veil while
// this promise is pending.
//
// Seeding strategy: if the templates table is empty after hydrate we
// emit the sample data through the same action surface any user
// mutation takes, so first-run state is indistinguishable from the
// output of a user performing those same edits by hand.

import {
  INBOX_LINE_ID,
  materializeAutoTasksForToday,
  toIsoDate,
  useStore,
  type Line,
  type Rail,
  type RailColor,
} from '@dayrail/core';
import { saveYDocBytes } from '@dayrail/db/yjsPersistence';
import {
  SAMPLE_RAILS_BY_TEMPLATE,
  SAMPLE_TEMPLATES,
} from './data/sampleTemplate';
import { popPendingImport } from './lib/importData';
import { setLocalIsSamplesOnly } from './lib/sync/identity';

export async function boot(): Promise<void> {
  // 0. Pre-flight capability probe.
  await preflight();

  // 0.25. Request persistent storage so the browser doesn't evict
  //       OPFS under disk pressure.
  void requestPersistentStorage();

  // 0.5. Pending import from the previous page (user clicked "Import
  //      from snapshot" in Settings, or finished a sync pull that
  //      wanted a clean reload). The pending bytes are the `.dryj`
  //      container the user supplied / the sync layer produced; we
  //      write them straight to OPFS so hydrate's loadYDocBytes path
  //      picks them up like any other persisted state.
  const pending = popPendingImport();
  if (pending) {
    await saveYDocBytes(pending);
  }

  // 1. Hydrate from OPFS — load the .dryj if present, build the
  //    Y.Doc, derive flat state into the zustand store.
  await useStore.getState().hydrate();

  // 2. First-run seeding — when local is empty AND we don't have a
  //    pending import. Always seed in that case, regardless of
  //    whether Drive is connected: the samples-only flag (set
  //    below) tells BootGate's later applyRemoteDryj path that the
  //    seed is disposable, so it'll use replaceLocalFromRemote
  //    rather than CRDT-merging samples into the user's actual
  //    cloud data. Earlier round-4 attempted to peek Drive here and
  //    skip the seed if a canonical existed; that left users with
  //    empty UI when Drive was connected but BootGate's apply hadn't
  //    fired yet (or canonical was empty, or fetch failed silently).
  //    Removing the peek; round 6's flag-based replace-vs-merge
  //    gate is the correct mechanism.
  const s = useStore.getState();
  if (Object.keys(s.templates).length === 0 && !pending) {
    await seedFromSamples();
    await ensureInbox();
    await ensureBuiltinWeekdayRules();
    // Mark local as "v0.7 sample seed only — safe to replace
    // wholesale on first Drive connect / pull". Cleared by the
    // syncController afterTransaction listener on the first user-
    // authored transact, by importLocalData when a real .dryj is
    // imported, and by runPush / runForcePush / replaceLocalFromRemote
    // on success.
    setLocalIsSamplesOnly();
  } else {
    // Cheap no-op after first run on a populated device.
    await ensureInbox();
    await ensureBuiltinWeekdayRules();
  }

  // 5. Materialise today's habit auto-tasks. Idempotent.
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
    // best-effort
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
