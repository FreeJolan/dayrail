# DayRail

Local-first personal planning · **Stay on the Rail** 🚉

> Design philosophy: *Be kinder to yourself. Keep moving, gently.*
> A tool that records your rhythm, doesn't demand you have none.

- **Full design doc** · [`docs/ERD.zh-CN.md`](./docs/ERD.zh-CN.md) · [`docs/ERD.en.md`](./docs/ERD.en.md)（双语同等权威）
- **Current state + next work** · [`docs/ROADMAP.md`](./docs/ROADMAP.md)

---

## Status

**v0.7 · Self-use + small-scale Drive sync.** PWA deployed to Vercel,
daily-use ready. Multi-device sync is on (Yjs CRDT over Google Drive
`appdata`, currently scoped to the author's two Macs); mobile + AI
integration remain explicitly parked (see ROADMAP).

Core data model is a single Yjs `Y.Doc` persisted to IndexedDB and
mirrored to Drive as a `.dryj` snapshot, observed by Zustand selectors
on top. 104 vitest cases cover the auto-task pipeline, the §10.3 purge
flow, timeline selectors, the §10.5 effective-from revision model, the
`.dryj` codec round-trip, the Y.Doc ↔ flat-state hydrate, and the
samples-only flag lifecycle.

---

## Dev loop

```bash
pnpm install
pnpm dev                 # dev server → http://localhost:5173 (or next free port)
pnpm test                # vitest · core selectors + materializer
pnpm typecheck           # tsc --noEmit across all packages
pnpm build               # production bundle → apps/web/dist
```

All commands are safe to run from repo root (`pnpm` filters into
`@dayrail/web` / `@dayrail/core` as needed).

### Production preview locally

```bash
pnpm build
cd apps/web && pnpm exec vite preview --port 4173 --host
```

Serves the production bundle at `http://localhost:4173`. Separate
origin from `:5173`, so **IndexedDB data is isolated from the dev
database** — useful for validating a build without polluting dev
state.

---

## Ship a new version

```bash
pnpm test              # 104 cases must be green
pnpm build             # local build must succeed (catches Vercel's future errors)
# Open a PR — never push directly to main. See CLAUDE.md for the full flow.
```

Vercel watches `main` and deploys in ~1-2 min after merge. Installed
PWAs pick up the new bundle via service-worker autoUpdate on next open
(sometimes needs one manual refresh).

**Verify after deploy**: open PWA → `Settings → 关于` → "构建" row
should show the new `<git-sha>`.

**Rollback if broken**: Vercel dashboard → Deployments → pick the
last good one → *Promote to Production*. Local IndexedDB and the Drive
`.dryj` snapshot are decoupled from app code, so a rollback doesn't
touch user data.

---

## Workspace layout

```
apps/web                 PWA shell (Vite + React 18 + TypeScript + Tailwind) + sync layer
packages/core            Domain types + Zustand store + materializer + selectors + Y.Doc actions
packages/db              Y.Doc schema + .dryj codec + IndexedDB persistence
tools/migrate            v0.6 → v0.7 one-shot JSON-to-Yjs migration script
docs/                    ERD (bilingual) + ROADMAP
```

No `apps/desktop`, no `packages/ui`, no `packages/locales` — those
were sketched in an earlier plan and dropped. Tauri shell stays on
the ROADMAP parking lot, not in scope for self-use.

The v0.7 cutover deleted the SQLite-WASM + OPFS event-sourced layer
(~4600 lines) along with `drizzle-orm`, `@sqlite.org/sqlite-wasm`,
and `immer`. See ERD §7.7 for the design rationale and migration path.

---

## Data safety

User data lives in **IndexedDB** locally (Y.Doc serialized via
`yjsPersistence.ts`) and, when sync is on, mirrored as a `.dryj`
snapshot in your Google Drive `appdata`. Clear browser data on a
device with no Drive connected = data gone. Layered defense:

1. **Persistent storage request** · `boot.ts` calls
   `navigator.storage.persist()` to ask the browser not to evict
   under pressure. Installed PWAs on real HTTPS origins usually get
   auto-granted; `Settings → 关于 → 存储持久化` shows the live state.
2. **Drive sync (recommended)** · Settings → 同步 → Connect Google
   Drive. Once connected, every change is pushed (60s debounce + on
   tab close); every cold start, visibility change, and 5-minute
   periodic probe pulls remote-ahead updates and merges them via Yjs
   CRDT. A second device picks up the same `appdata` automatically.
3. **Manual snapshot** · Settings → 同步 → 「下载本地快照」exports
   `.dryj` (binary, compact); Settings → 高级 → JSON export still
   produces a human-readable backup. Either format imports back via
   `导入 JSON` / 「从快照导入」(overwrite semantics).
4. **Version rollback** · Vercel deploys are atomic; if a new build
   corrupts something, promote the previous deploy. Local IndexedDB
   and the Drive snapshot are decoupled from app code, so a rollback
   doesn't touch user data.

**Habit**: even with Drive sync on, save a `.dryj` to disk monthly.
Both mirrors going bad on the same week is extremely unlikely, but
free insurance is free.

---

## Google Drive sync (v0.6 Drive snapshot · v0.7 Yjs CRDT)

Optional, off by default. Settings → 同步 → Connect Google Drive runs
a one-time OAuth consent flow; from then on the device mirrors its
local Y.Doc to the user's hidden `appdata` folder (no other app can
see it) as `dayrail-snapshot.dryj`. Push triggers: 60s debounce,
visibility-hidden, pagehide, beforeunload keepalive. Pull triggers:
cold-start BootGate, visibility-visible, online-restored, 5-minute
periodic metadata probe. ERD §7.6 / §7.7 have the full design.

**Conflict model**: Yjs CRDT merges field-by-field automatically.
Edits to different fields of the same entity, or to the same field
with the same new value (the "I checked off the same task on two
devices" case), converge silently. Only "two devices wrote different
values to the same field" is a real conflict, which Yjs resolves with
LWW + Lamport clock — no UI prompt. The v0.6 forced "diverged" card
no longer exists; the safety net is the manual `.dryj` import path
described above.

**Wire format**: `.dryj` = 4-byte magic + 2-byte container version +
JSON meta header + `Y.encodeStateAsUpdate` binary. See
`packages/db/src/dryj.ts` for the codec.

### Privacy boundary

Each user's sync data lives in **their own** Google Drive `appdata`,
not the deployer's. The OAuth Client ID is an authentication
credential, not a storage destination — DayRail holds no user data on
any server, and the deployer (whoever owns the GCP project) cannot
see file contents, filenames, or even the email addresses of users
who connected. Only DayRail (this OAuth client, running inside the
user's browser, with that user's explicit consent) can read that
user's `appdata`.

What the deployer **can** see in the GCP console: aggregate API call
counts, quota usage, and an anonymous count of users who have
authorized the client. What the deployer **cannot** see: file
contents, filenames, user identities.

### Setup tiers

DayRail has no shared backend — every deployment supplies its own
OAuth client. There are two tiers depending on how widely the build
is shared.

**Tier 1 · Self-use / small private group** (default, this repo's
current shape):

1. Google Cloud Console → create / pick a project.
2. APIs & Services → OAuth consent screen → User type: **External**,
   Publishing status: **Testing**. App name "DayRail", support email =
   yours. Save.
3. Same screen → **Test users** → add the Google accounts that will
   use this build (yourself, plus up to 100 others). Anyone not on
   this list cannot connect.
4. APIs & Services → Library → enable **Google Drive API**.
5. APIs & Services → Credentials → Create OAuth Client ID, type
   "Web application", Authorized JavaScript origins:
   `http://localhost:5173`, `http://localhost:4173`,
   `https://<your-vercel-url>`. No redirect URI needed (GIS token
   client uses postMessage).
6. Copy the Client ID into `apps/web/.env.local`:
   `VITE_GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com`
7. `pnpm dev` (or `pnpm build`) — the var is baked at build time.

Each test user, on first connect, sees one consent screen ("DayRail
wants to see and manage its own configuration data in your Google
Drive"), picks their account, accepts. From then on, no Google
sign-in page for the lifetime of the browser-account session — token
refresh is silent (~hourly, hidden iframe).

**Tier 2 · Public release** (only if you ever ship this beyond your
test-user list — current ROADMAP says you do not):

To remove the 100-user cap and the "Google hasn't verified this app"
warning, the OAuth consent screen must be moved to **Publishing
status: In production**. Because Drive API counts as a "sensitive"
scope, this triggers Google's OAuth verification review:

- Provide a **homepage URL** + **privacy policy URL** + **terms of
  service URL** for DayRail.
- Add a 30s screen recording showing where in the app the scope is
  used and why it's necessary.
- Submit for review. Google takes 2–6 weeks; usually one round of
  follow-up emails.
- We deliberately picked `drive.appdata` (the lightest sensitive
  scope), not `drive.file` or full Drive, so verification is the
  simpler track — no CASA security assessment required.

Until verification clears, public users would see an "Advanced →
Continue anyway" warning page during consent. Acceptable for a beta
of a few friends; not acceptable for a real public launch. Reopen
this section before flipping to In production.

### Steady-state UX

Connect once, then never see a Google sign-in page again for the
lifetime of the browser-account session. Token refresh is silent
(~hourly, hidden iframe). Two devices on the same Google account
share the same `appdata` folder automatically — no passphrase, no
recovery code, no per-device pairing step.

**Parked** beyond v0.7 (intentional, see ERD §7.7): end-to-end
encryption, encrypted append-only event log, passphrase + recovery
codes, dual-write E2E migration, iCloud / WebDAV / Dropbox backends,
field-level true-conflict UI, `Task.subItems` per-element CRDT op
(currently atomic LWW — see ROADMAP).

---

## Keyboard shortcuts

- `?` · cheatsheet overlay
- `g t / g c / g l / g k / g p / g r / g e / g s` · page nav
  (Today / Cycle / Tasks / Calendar / Pending / Review / Template
  Editor / Settings)
- `g b` · toggle global Backlog drawer

Bigraphs use `g` as the leader; second key must follow within 1.2s.
Inputs / textareas don't steal the leader.

---

## Conventions

- **Code + comments: English only.** UI strings follow the audience
  locale (currently zh-CN primary).
- **ERD is append-only history** — design decisions get new "History:"
  entries, not edits in place. ROADMAP.md is the rewritable
  current-state snapshot.
- **No pre-release compat.** Solo-dev phase; no migration branches
  for renamed fields. Breaking schema changes bump the bundle
  `schemaVersion` in `exportData.ts`; users re-import from backup if
  something can't hydrate.
- **Zustand selectors subscribe to raw maps**, derived arrays/objects
  go through `useMemo`. A selector returning a fresh object inline
  triggers infinite re-renders.

License: MIT.
