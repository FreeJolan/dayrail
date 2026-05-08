# `@dayrail/desktop` · Tauri 2 desktop shell

Per ERD §15. Wraps the existing `@dayrail/web` Vite output in a system
webview with OS-level integration (keychain, file picker, system
notifications) and built-in auto-update.

This is a v0.9 work-in-progress. PR-A (this commit) only scaffolds
the Tauri shell — sync-layer adaptation (PR-C) and auto-update
infrastructure (PR-B) come in subsequent PRs.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Rust | 1.77+ | Install via [rustup](https://rustup.rs); current repo tested with 1.94 |
| Node + pnpm | 18+ / 7+ | Same as the web app |
| **macOS only** · Xcode CLI tools | latest | `xcode-select --install` |
| **Linux only** · webkit2gtk + various | distro-dependent | See [Tauri prereqs for Linux](https://tauri.app/start/prerequisites/#linux) |
| **Windows only** · WebView2 | system-installed | Modern Windows ships with it |

## Dev / build (from repo root)

```bash
# Live dev — opens a window, frontend hot-reloads via Vite at :5173
pnpm desktop:dev

# Production build — emits .dmg / .AppImage / .msi in
# apps/desktop/src-tauri/target/release/bundle/
pnpm desktop:build
```

The first `pnpm desktop:dev` after install will compile Tauri's Rust
deps, which takes a few minutes. Subsequent builds are incremental.

## First-launch on macOS (unsigned build)

PR-A ships unsigned binaries. macOS Gatekeeper will refuse to launch
the .app on first open with "DayRail.app cannot be opened because it
is from an unidentified developer". Bypass once:

1. Find `DayRail.app` in Finder
2. Right-click → **Open** → confirm in the dialog

After this, macOS remembers and double-click works as normal. Once
Apple Developer cert + notarization are in place (tracked in ERD
§15.5), this dance goes away — every release will pass Gatekeeper
silently.

## Layout

```
apps/desktop/
├── package.json          ← @tauri-apps/cli + scripts
├── README.md             ← you are here
└── src-tauri/
    ├── Cargo.toml        ← Rust deps (tauri 2, plugins)
    ├── tauri.conf.json   ← bundle / window / build config
    ├── build.rs          ← Tauri codegen entry
    ├── capabilities/
    │   └── default.json  ← permission allowlist (Tauri 2 capabilities)
    ├── icons/            ← TODO: real icons (currently placeholders)
    └── src/
        ├── main.rs       ← thin entry shim
        └── lib.rs        ← runtime (Builder + plugins + run)
```

The frontend lives in `apps/web/` and is reused as-is. Tauri config
points `frontendDist` at `../../web/dist`, so `pnpm build` for the
web app is a prerequisite for `pnpm desktop:build`.

## What's not in PR-A

These are tracked separately per ERD §15:

- **PR-B · auto-update** — `tauri-plugin-updater` + GitHub Releases
  pipeline + static manifest JSON. Until then the desktop app has
  no upgrade path; you reinstall manually.
- **PR-C · sync layer** — Drive auth via desktop OAuth pattern
  (auth-code flow + refresh token in OS keychain via
  `tauri-plugin-stronghold`). Until then desktop reuses the web's
  GIS implicit flow + same hourly re-auth UI as PWA.
- **PR-D · platform polish** — menu bar / dock / file picker /
  system notifications. Optional and dogfood-driven.
- **Real icons** — placeholder folder for now; run `pnpm
  --filter @dayrail/desktop icon <master.png>` to generate the full
  PNG/ICNS/ICO set when a master logo is ready.

See ERD §15 for the full architecture sketch + rationale.
