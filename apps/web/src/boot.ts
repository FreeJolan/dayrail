// App bootstrap — opens the Y.Doc-backed store from OPFS, ensures the
// Inbox line exists. Called from `main.tsx` before the React tree
// mounts; the app shell renders a loading veil while this promise is
// pending.
//
// First-run policy (changed 2026-05-08): no sample seeding. A fresh
// install boots with empty templates / rails / etc; the UI surfaces
// (Today Track, Cycle View) render an empty-state hint nudging the
// user into the template editor. See the "first-run setup" comment
// in boot() for the data-loss incident that drove this.

import {
  attachStagingPersistence,
  INBOX_LINE_ID,
  materializeAutoTasksForToday,
  setHolidayDatasets,
  toIsoDate,
  useStore,
  type HolidayDataset,
  type Line,
  type StagingProposal,
} from '@dayrail/core';
import { OpfsJsonStore } from '@dayrail/db';
import { saveYDocBytes } from '@dayrail/db/yjsPersistence';
import { setYDocStoreDevMode } from '@dayrail/db/yDocStore';
// ERD §14.2 — bundled holiday data sets. Each new region drops in a
// JSON file here and gets registered. Updating: every December open a
// PR adding next year's events to the relevant region's file.
import HOLIDAYS_ZH_CN from './data/holidays/zh-CN.json';
import { popPendingImport } from './lib/importData';
import { loadSyncMetaCache, setAutoDetectedDeviceLabel } from './lib/sync/identity';
import { isTauriRuntime } from './lib/versionUpdateContext';

export async function boot(): Promise<void> {
  // 0. Pre-flight capability probe.
  await preflight();

  // 0.05. Hand the dev/prod flag to the YDocStore before any caller
  //       resolves the singleton. Tauri's `app_data_dir()` is
  //       identifier-based (not NSBundle-based), so without this
  //       split `pnpm desktop:dev` would read/write the same files
  //       as the installed prod app. v0.11.2 fix — see ERD §7.9.
  setYDocStoreDevMode(import.meta.env.DEV);

  // 0.1. Register bundled holiday datasets (synchronous, in-memory).
  //      Done before hydrate so any first-render cycle that reads
  //      external events sees the catalog. Order doesn't matter; the
  //      core selector aggregates by enabled-region list.
  setHolidayDatasets([HOLIDAYS_ZH_CN as HolidayDataset]);

  // 0.25. Request persistent storage so the browser doesn't evict
  //       OPFS under disk pressure.
  void requestPersistentStorage();

  // 0.3. On Tauri, query the OS hostname so the device label has a
  //      real default (e.g. "FreeJolan-MBP") rather than the
  //      UA-derived "Browser on macOS". Best-effort, fire-and-forget;
  //      the user can override via Settings → 同步 → 本设备名.
  void populateAutoDeviceLabel();

  // 0.4. Dev-build labelling. import.meta.env.DEV is true under both
  //      `pnpm dev` (PWA) and `pnpm desktop:dev` (Tauri); paint the
  //      window/tab title so I can't accidentally treat a dev-server
  //      window as my daily DayRail and write real data into the
  //      isolated dev container.
  void labelDevBuild();

  // 0.45. Hydrate the in-memory sync-metadata cache from the active
  //       YDocStore (ERD §7.9). MUST run before identity.ts getters
  //       fire — boot probe (BootGate), the syncController background
  //       loop, and any UI that reads lastSync info all depend on the
  //       cache being warm. On first boot of v0.11, this also runs
  //       the one-time localStorage → store migration (legacy keys
  //       are read once, written through the store, then deleted;
  //       migration code planned to be removed v0.14).
  await loadSyncMetaCache();

  // 0.5. Pending import from the previous page (user clicked "Import
  //      from snapshot" in Settings, or finished a sync pull that
  //      wanted a clean reload). The pending bytes are the `.dryj`
  //      container the user supplied / the sync layer produced; we
  //      write them straight to the store so hydrate's loadYDocBytes
  //      path picks them up like any other persisted state.
  const pending = popPendingImport();
  if (pending) {
    await saveYDocBytes(pending);
  }

  // 1. Hydrate from OPFS — load the .dryj if present, build the
  //    Y.Doc, derive flat state into the zustand store.
  await useStore.getState().hydrate();

  // 1.5. Wire the local AI staging tray (ERD §6.7.3) to its own OPFS
  //      JSON file — deliberately NOT the Y.Doc sync stream. Best-effort
  //      and fire-and-forget: a staging-persistence failure must never
  //      block boot, and the drawer reads the store reactively so it
  //      fills in once hydrate resolves. Dev/prod isolated by suffix,
  //      same as the Y.Doc store.
  void attachStagingPersistence(
    new OpfsJsonStore<Record<string, StagingProposal>>(
      `dayrail-staging${import.meta.env.DEV ? '-dev' : ''}.json`,
    ),
  ).catch(() => undefined);

  // 2. First-run setup — only the bare minimum that's needed for the
  //    rest of the app to function. Specifically: the Inbox line, so
  //    "tasks without a project" have somewhere to live.
  //
  //    History (2026-05-08): we used to seed sample templates +
  //    weekday calendar rules here, gated by a `samplesOnly`
  //    localStorage flag so BootGate could replace the seed
  //    wholesale on first Drive pull. The flag was out-of-band
  //    metadata stored separately from the data it gated, and the
  //    v0.9.0 → v0.9.1 Tauri auto-update wiped WKWebView storage
  //    (including the flag), letting the re-seeded state push to
  //    Drive and overwrite the user's real cloud data. The
  //    architectural fix is here: don't write data that looks like
  //    user data unless it IS user data. Empty start + UI guidance
  //    is the new contract; the pre-Drive-pull state is unambiguously
  //    "nothing here yet" rather than "looks populated but secretly
  //    disposable".
  //
  //    UX impact: a fresh install with no Drive connection sees an
  //    empty Today Track / Cycle View with a "新建第一个模板 →"
  //    nudge (see EmptyTemplatesHint). That's strictly better than
  //    the old "here are some example rails I'll silently replace
  //    when Drive shows up" implicit handoff.
  await ensureInbox();

  // 5. Materialise today's habit auto-tasks. Idempotent.
  const today = toIsoDate();
  await materializeAutoTasksForToday(today);
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

async function labelDevBuild(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (typeof document !== 'undefined') {
    document.title = `DEV · ${document.title || 'DayRail'}`;
  }
  if (!isTauriRuntime()) return;
  // Tauri webview window title is independent of document.title;
  // setting it explicitly so Cmd+Tab / dock hover / title bar all
  // show the DEV marker.
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle('DayRail · DEV');
  } catch {
    /* best-effort */
  }
}

async function populateAutoDeviceLabel(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = await invoke<{ hostname: string; os: string }>(
      'get_system_info',
    );
    if (info?.hostname && info.hostname.trim().length > 0) {
      setAutoDetectedDeviceLabel(info.hostname.trim());
    }
  } catch {
    // Best-effort; falls back to UA-derived label silently.
  }
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

