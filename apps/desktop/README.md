# `@dayrail/desktop` · Tauri 2 desktop shell

Per ERD §15. Wraps the existing `@dayrail/web` Vite output in a system
webview with OS-level integration (keychain, file picker, system
notifications) and built-in auto-update.

This is a v0.9 work-in-progress. PR-A scaffolded the Tauri shell;
PR-B added auto-update infrastructure; PR-C (this commit) wires Drive
auth via the desktop OAuth pattern (refresh token in OS keychain).

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

## Drive OAuth (PR-C)

The PWA's Google sign-in goes through GIS implicit flow, which doesn't
issue refresh tokens — that's why every fresh launch beyond the 1 h
access-token window forces a popup. The desktop build uses the
**authorization-code flow + PKCE** instead and persists the refresh
token in the OS keychain (macOS Keychain Services / Windows Credential
Manager / Linux Secret Service via libsecret), so reconnects are
silent until the user revokes from Google's account-permissions page.

The flow is wired in `src-tauri/src/drive_auth.rs` and exposed to the
frontend as four Tauri commands (`drive_connect`, `drive_get_token`,
`drive_disconnect`, `drive_is_connected`). `apps/web/src/lib/sync/
driveAuth.ts` detects the Tauri runtime and routes through these
commands; the PWA path is unchanged.

### Local setup — Google Cloud Console

The desktop loopback flow needs an OAuth client of type **"Desktop
app"**. Google rejects the loopback `redirect_uri` from a "Web
application" client, so the PWA's existing client cannot be reused.

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   under your existing DayRail project.
2. Click **Create Credentials → OAuth client ID**.
3. **Application type**: `Desktop app`. **Name**: `DayRail Desktop`.
4. Click **Create**. Copy the **Client ID** and **Client secret**.
5. In `apps/desktop/src-tauri/`:
   ```bash
   cp .env.example .env
   ```
   Fill the two values into `.env`. The file is gitignored.

`build.rs` reads `.env` and forwards the two keys via
`cargo:rustc-env=…`; `drive_auth.rs` reads them with `option_env!()`
at compile time, so there's no runtime file IO and no shipped `.env`.

> **On the "client secret" for native apps.** Per
> [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252), the
> "secret" issued to a desktop app is not actually confidential — it
> ends up embedded in every distributed binary. Google still issues
> one because their OAuth library mandates it; treat it as
> identifying-but-not-secret. The PKCE step is what actually protects
> the auth-code exchange.

### CI

`.github/workflows/release.yml` (added in PR-B) reads
`GOOGLE_DESKTOP_CLIENT_ID` and `GOOGLE_DESKTOP_CLIENT_SECRET` from
GitHub Secrets and exports them as env vars before `cargo build`,
which `build.rs` picks up the same way it does the local `.env`. Set
both with `gh secret set GOOGLE_DESKTOP_CLIENT_ID` and
`gh secret set GOOGLE_DESKTOP_CLIENT_SECRET`.

## What's not in PR-A / PR-B / PR-C

Tracked separately per ERD §15:

- **PR-D · platform polish** — menu bar / dock / file picker /
  system notifications. Optional and dogfood-driven.

See ERD §15 for the full architecture sketch + rationale.
