# DayRail

Local-first personal planning · **Stay on the Rail** 🚉

> Design philosophy: *Be kinder to yourself. Keep moving, gently.*
> A tool that records your rhythm, doesn't demand you have none.

- **Full design doc** · [`docs/ERD.zh-CN.md`](./docs/ERD.zh-CN.md) · [`docs/ERD.en.md`](./docs/ERD.en.md)（双语同等权威）
- **Current state + next work** · [`docs/ROADMAP.md`](./docs/ROADMAP.md)

---

## Status

**v0.4 · Self-use MVP shipping.** PWA deployed to Vercel, daily-use
ready. Single-device scope — sync / mobile / AI integration are
explicitly parked (see ROADMAP).

Core data model is event-sourced (SQLite-WASM + OPFS), with a
materialised Zustand view on top. 35 vitest cases cover the
auto-task pipeline + the §10.3 purge flow + timeline selectors.

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
origin from `:5173`, so **OPFS data is isolated from the dev
database** — useful for validating a build without polluting dev
state.

---

## Ship a new version

```bash
pnpm test              # 35 cases must be green
pnpm build             # local build must succeed (catches Vercel's future errors)
git add -A && git commit -m "..."
git push origin main   # Vercel auto-deploys
```

Vercel watches `main` and deploys in ~1-2 min. Installed PWAs pick
up the new bundle via service-worker autoUpdate on next open
(sometimes needs one manual refresh).

**Verify after deploy**: open PWA → `Settings → 关于` → "构建" row
should show the new `<git-sha>`.

**Rollback if broken**: Vercel dashboard → Deployments → pick the
last good one → *Promote to Production*. OPFS data is decoupled
from app code, so a rollback doesn't touch user data.

---

## Workspace layout

```
apps/web                 PWA shell (Vite + React 18 + TypeScript + Tailwind)
packages/core            Domain types + event log + Zustand store + materializer + selectors
packages/db              Drizzle schema + SQLite-WASM worker + OPFS persistence
docs/                    ERD (bilingual) + ROADMAP
```

No `apps/desktop`, no `packages/ui`, no `packages/locales` — those
were sketched in an earlier plan and dropped. Tauri shell stays on
the ROADMAP parking lot, not in scope for self-use.

---

## Data safety (self-use · single device)

All user data lives in **OPFS** (Origin Private File System). Clear
browser cache, reinstall browser, or lose the device = data gone.
Three-layer defense:

1. **Persistent storage request** · `boot.ts` calls
   `navigator.storage.persist()` to ask the browser not to evict
   under pressure. Installed PWAs on real HTTPS origins usually get
   auto-granted; `Settings → 关于 → 存储持久化` shows the live state.
2. **Backup / restore** · `Settings → 高级 → 下载 JSON` exports the
   full state; `导入 JSON` on the same panel restores (overwrite
   semantics). Keep the JSON in iCloud Drive / Dropbox so a device
   loss isn't a data loss.
3. **Version rollback** · Vercel deploys are atomic; if a new build
   corrupts something, promote the previous deploy while user data
   stays in OPFS.

**Habit**: export JSON weekly. Takes five seconds, insures against
everything.

---

## Google Drive sync (v0.6 · `feat/sync-drive`)

Optional, off by default. Settings → 同步 → Connect Google Drive runs a
one-time OAuth consent flow; from then on the device pushes a snapshot
to **the user's own** Google account hidden `appdata` folder (no other
app can see it) on a 60s debounce, on tab close, and on demand. On
every cold start the boot gate probes the remote and either silently
pulls the latest, asks before pulling, or shows a forced conflict card
if both sides have unsynced edits. ERD §7.6 has the full design.

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

**Parked** for v0.6 (intentional, see ERD §7.6): end-to-end encryption,
Yjs CRDT runtime merge, encrypted append-only event log, recovery
codes, dual-write E2E migration, iCloud / WebDAV backends.

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
