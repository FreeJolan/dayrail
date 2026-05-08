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

## Releasing a new version

Auto-update infrastructure is wired (PR-B). Cutting a release:

```bash
# 1. Update version in apps/desktop/src-tauri/tauri.conf.json
#    (and Cargo.toml if you're tracking package version explicitly)

# 2. Tag + push
git tag v0.9.0
git push origin v0.9.0
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`:

- Builds for macOS (arm64 + x86_64), Linux x86_64, Windows x86_64
- Signs the update bundle with the Tauri updater key
- Creates a draft GitHub Release with the platform installers + `latest.json` manifest attached
- macOS code-signs + notarizes if Apple secrets are present (currently no — first release will ship unsigned)

You then review the draft release on GitHub and click "Publish". Existing desktop app installs check the `latest.json` URL on startup + every 30 minutes; when they see a newer version they prompt the user to install.

### Required GitHub Secrets

Before the first release works, set these on the repo:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.dayrail/tauri-updater.key` (the private key, raw text) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | passphrase used when generating the key |

Set via `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.dayrail/tauri-updater.key`.

**Don't lose the private key.** Without it you can't sign update bundles, and existing installs won't accept new versions until they're manually reinstalled. The key is stored at `~/.dayrail/tauri-updater.key` and `~/.dayrail/tauri-updater.key.pub`; back both up to a password manager.

### Apple code-signing (later)

Once the Apple Developer Program enrollment completes, add these secrets and the workflow will automatically sign + notarize macOS builds:

- `APPLE_CERTIFICATE` — base64 of the Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD` — `.p12` passphrase
- `APPLE_SIGNING_IDENTITY` — `Developer ID Application: <Your Name> (TEAM_ID)`
- `APPLE_ID` — Apple ID email
- `APPLE_PASSWORD` — app-specific password generated at appleid.apple.com
- `APPLE_TEAM_ID` — 10-character Apple Developer Team ID

Until then, macOS builds are unsigned and users must right-click → Open the first time.

## What's not in PR-A or PR-B

These are tracked separately per ERD §15:

- **PR-C · sync layer** — Drive auth via desktop OAuth pattern
  (auth-code flow + refresh token in OS keychain via
  `tauri-plugin-stronghold`). Until then desktop reuses the web's
  GIS implicit flow + same hourly re-auth UI as PWA.
- **PR-D · platform polish** — menu bar / dock / file picker /
  system notifications. Optional and dogfood-driven.

See ERD §15 for the full architecture sketch + rationale.
