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
