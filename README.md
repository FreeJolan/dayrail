# DayRail

A local-first, cross-platform personal routine manager. Design philosophy: **Be kinder to yourself. Keep moving, gently.**

See [`docs/ERD.en.md`](./docs/ERD.en.md) / [`docs/ERD.zh-CN.md`](./docs/ERD.zh-CN.md) for the full design document.

## Status

Scaffold + Today Track vertical slice (v0.1-pre). In-memory store; SQLite + event log land in v0.2.

## Development

```bash
pnpm install
pnpm dev             # PWA at http://localhost:5173
pnpm dev:desktop     # native desktop (Tauri) — launches the same web app in a native window
```

Desktop build:

```bash
pnpm build:desktop   # .app / .dmg on macOS, .exe on Windows, .AppImage/.deb on Linux
```

Desktop requires Rust (`rustup`) + platform toolchain (Xcode CLT on macOS, MSVC on Windows, standard build-essential on Linux). Mobile (Capacitor) deferred.

## Workspace layout

- `apps/web` — PWA (Vite + React + TypeScript + Tailwind)
- `apps/desktop` — Tauri 2 shell wrapping `apps/web` (macOS / Windows / Linux from one codebase)
- `packages/core` — domain types + default template
- `packages/ui` — shared UI primitives (placeholder)
- `packages/locales` — i18n resources (zh-CN + en)

License: MIT.
