// ERD §15.3 — Drive auth via desktop OAuth pattern.
//
// Three Tauri commands export the auth surface to the frontend:
//   - drive_connect       · run the full consent flow + persist refresh token
//   - drive_get_token     · refresh the access token silently from stored refresh token
//   - drive_disconnect    · delete the refresh token from the keychain
//   - drive_is_connected  · cheap probe (does a refresh token exist?)
//
// Why this exists: the PWA goes through GIS implicit flow which doesn't
// issue refresh tokens (OAuth spec restriction for browser clients),
// forcing a hourly re-auth UI. Desktop apps are allowed to use the
// authorization-code flow, which DOES issue a refresh token. The
// refresh token lives in the OS keychain forever (until revoked); the
// frontend just asks for fresh access tokens whenever it needs one.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use keyring::Entry;
use oauth2::basic::BasicClient;
use oauth2::reqwest;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    PkceCodeChallenge, RedirectUrl, RefreshToken, Scope, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

// ============ Constants ============

/// Service / username pair for the keychain entry. `keyring` uses
/// these as the lookup key; pick something stable + namespaced so we
/// don't collide with anything else the user has stored.
const KEYCHAIN_SERVICE: &str = "app.dayrail.desktop";
const KEYCHAIN_USERNAME: &str = "google-drive-refresh-token";

/// Filename for the file-fallback storage location under
/// `app.path().app_data_dir()` (resolved per OS). Used when keychain
/// is inaccessible — see refresh_token_io.rs-style helpers below.
const TOKEN_FILE_NAME: &str = "drive-refresh-token";

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_APPDATA_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";

/// Loopback wait timeout. If the user closes the consent page or
/// never authorizes, we don't want to block the IPC channel forever.
const OAUTH_CALLBACK_TIMEOUT_SECS: u64 = 5 * 60;

// ============ Types ============

/// Returned to the frontend on successful connect / refresh.
/// `access_token` goes straight into Drive API `Authorization: Bearer`
/// headers; `expires_at` is a wall-clock so the frontend can decide
/// whether the cached token is still valid before round-tripping back
/// to Rust.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessTokenInfo {
    pub access_token: String,
    /// Epoch milliseconds. Frontend compares against `Date.now()`.
    pub expires_at: i64,
}

// ============ Refresh token storage (hybrid: keychain + file) ============
//
// Why both: macOS unsigned apps rotate their ad-hoc code-signing
// hash on every binary replacement (every auto-update). The keychain
// access ACL is keyed off that hash, so the keychain entry written
// by the previous build becomes inaccessible to the new build → user
// sees "Drive disconnected" after each update. Apple Developer cert
// fixes this (stable Developer ID hash); until then we need a backup
// store that doesn't depend on signing identity.
//
// Strategy:
//   - Write: try keychain (best-effort), ALWAYS write file. File is
//     authoritative; keychain is cache.
//   - Read: keychain first (preferred — encrypted at rest with the
//     login keychain master key); fall back to file if keychain
//     unavailable / inaccessible.
//   - Delete: clear both.
//
// Cross-platform note (per ERD §15.x):
//   - Windows (Credential Manager) — entries indexed by (target, user),
//     not by code-signing → reliable across updates. File fallback
//     is dark-redundant.
//   - Linux (Secret Service via libsecret) — entries indexed by
//     (label, attrs) → reliable across updates. File fallback dark.
//   - macOS signed (future) — keychain is reliable. File fallback dark.
//   - macOS unsigned (current) — keychain unreliable. File path
//     wins.
//
// Threat model justification for plain-text file: the file lives at
// `~/Library/Application Support/app.dayrail.desktop/` (and
// equivalents on Win / Linux), which is per-user OS-protected. An
// attacker with read access to that directory ALSO has access to the
// user's local DayRail data, SSH keys, browser cookies, etc. The
// refresh token's blast radius is "read/write Drive `appdata` folder
// for DayRail" — strictly smaller than what a fs-access attacker
// already gets. So plain-text is acceptable for our threat model.

fn token_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    Ok(dir.join(TOKEN_FILE_NAME))
}

/// Try keychain first, then file. Returns the refresh token string or
/// a "not connected" error string verbatim from whichever read failed.
fn read_refresh_token(app: &AppHandle) -> Result<String, String> {
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USERNAME) {
        if let Ok(token) = entry.get_password() {
            return Ok(token);
        }
    }
    let path = token_file_path(app)?;
    std::fs::read_to_string(&path)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("not connected: {}", e))
}

/// Write to BOTH keychain (best-effort) and file (must succeed).
fn write_refresh_token(app: &AppHandle, token: &str) -> Result<(), String> {
    // File is authoritative: if this fails, the operation fails.
    let path = token_file_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create app_data_dir: {}", e))?;
    }
    std::fs::write(&path, token)
        .map_err(|e| format!("write token file: {}", e))?;
    // Best-effort tighten: 0600 on Unix so other users on the box
    // can't peek. No-op on Windows.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    // Keychain is dark redundancy: if it succeeds (signed mac / win /
    // linux), great; if not (unsigned mac post-update), file alone
    // carries us through.
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USERNAME) {
        let _ = entry.set_password(token);
    }
    Ok(())
}

/// Forget both copies. Idempotent — succeeds even if neither exists.
fn forget_refresh_token(app: &AppHandle) {
    if let Ok(path) = token_file_path(app) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USERNAME) {
        let _ = entry.delete_credential();
    }
}

/// Cheap probe: does either store have a token? Used by the
/// `drive_is_connected` command for UI gating.
fn has_refresh_token(app: &AppHandle) -> bool {
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USERNAME) {
        if entry.get_password().is_ok() {
            return true;
        }
    }
    if let Ok(path) = token_file_path(app) {
        if path.exists() {
            return true;
        }
    }
    false
}

// ============ OAuth client construction ============

/// Build the OAuth client from compile-time env vars (set via
/// `apps/desktop/src-tauri/.env`, loaded by `build.rs`). We intentionally
/// embed the credentials in the binary — per RFC 8252, native-app
/// OAuth credentials are not "confidential" and the practice is
/// industry standard (Slack / Notion / GitHub Desktop / etc.).
fn oauth_client(redirect_uri: Option<RedirectUrl>) -> Result<BasicClient<
    oauth2::EndpointSet,    // HasAuthUrl
    oauth2::EndpointNotSet, // HasDeviceAuthUrl
    oauth2::EndpointNotSet, // HasIntrospectionUrl
    oauth2::EndpointNotSet, // HasRevocationUrl
    oauth2::EndpointSet,    // HasTokenUrl
>, String> {
    let client_id = option_env!("GOOGLE_DESKTOP_CLIENT_ID")
        .ok_or("GOOGLE_DESKTOP_CLIENT_ID not set at build time — see apps/desktop/.env.example")?;
    let client_secret = option_env!("GOOGLE_DESKTOP_CLIENT_SECRET")
        .ok_or("GOOGLE_DESKTOP_CLIENT_SECRET not set at build time")?;

    let mut client = BasicClient::new(ClientId::new(client_id.to_string()))
        .set_client_secret(ClientSecret::new(client_secret.to_string()))
        .set_auth_uri(
            AuthUrl::new(GOOGLE_AUTH_URL.to_string())
                .map_err(|e| format!("bad auth url: {}", e))?,
        )
        .set_token_uri(
            TokenUrl::new(GOOGLE_TOKEN_URL.to_string())
                .map_err(|e| format!("bad token url: {}", e))?,
        );

    if let Some(uri) = redirect_uri {
        client = client.set_redirect_uri(uri);
    }
    Ok(client)
}

/// Build a reqwest HTTP client with the same defaults oauth2's
/// internal helper uses (no redirects — OAuth's redirect handling is
/// done by the caller, not the HTTP client).
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("http client init: {}", e))
}

// ============ Commands ============

/// Run the consent flow end-to-end. Opens the user's default browser
/// at Google's OAuth page, listens on a loopback TCP port for the
/// redirect, exchanges the code for tokens, persists the refresh
/// token in the OS keychain, and returns the fresh access token to
/// the caller.
///
/// Errors propagate verbatim to the frontend as strings; the JS side
/// surfaces them in the existing connect-flow error UI.
#[tauri::command]
pub async fn drive_connect(app: AppHandle) -> Result<AccessTokenInfo, String> {
    // 1. PKCE
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    // 2. Bind a loopback port. Port 0 = let the OS pick anything free.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("loopback bind: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("loopback addr: {}", e))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    // 3. Build authorize URL
    let client = oauth_client(Some(
        RedirectUrl::new(redirect_uri.clone())
            .map_err(|e| format!("bad redirect: {}", e))?,
    ))?;
    let (auth_url, _csrf_state) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(GOOGLE_DRIVE_APPDATA_SCOPE.to_string()))
        // `access_type=offline` is what tells Google to issue a
        // refresh token. Without it, native-app flow still completes
        // but only returns an access token — useless for our case.
        .add_extra_param("access_type", "offline")
        // `prompt=consent` forces the consent screen even if the user
        // has already authorized this client; Google sometimes skips
        // refresh-token issuance on subsequent silent grants
        // otherwise. Re-prompt is a small UX cost for guaranteed
        // refresh-token delivery.
        .add_extra_param("prompt", "consent")
        .set_pkce_challenge(pkce_challenge)
        .url();

    // 4. Open default browser. Errors here mean the user has no
    //    browser configured — surface explicitly.
    open::that(auth_url.to_string())
        .map_err(|e| format!("opening browser: {}", e))?;

    // 5. Wait for the callback (with a timeout)
    let code = tokio::time::timeout(
        Duration::from_secs(OAUTH_CALLBACK_TIMEOUT_SECS),
        wait_for_callback(listener),
    )
    .await
    .map_err(|_| {
        "OAuth flow timed out after 5 minutes — close the browser tab and try again.".to_string()
    })??;

    // 6. Exchange the code for tokens
    let http = http_client()?;
    let token_result = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http)
        .await
        .map_err(|e| format!("token exchange: {}", e))?;

    let access_token = token_result.access_token().secret().to_string();
    let expires_in = token_result
        .expires_in()
        .unwrap_or_else(|| Duration::from_secs(3600));
    let expires_at = (Utc::now()
        + ChronoDuration::from_std(expires_in).unwrap_or(ChronoDuration::seconds(3600)))
    .timestamp_millis();

    let refresh_token = token_result
        .refresh_token()
        .ok_or_else(|| {
            "Google did not return a refresh token — try clicking Disconnect in Settings → Sync, then reconnect.".to_string()
        })?
        .secret()
        .to_string();

    // 7. Persist refresh token. Hybrid: keychain (when usable) + file
    //    (authoritative for unsigned-mac post-update reliability).
    write_refresh_token(&app, &refresh_token)?;

    Ok(AccessTokenInfo {
        access_token,
        expires_at,
    })
}

/// Refresh the access token silently using the stored refresh token.
/// Frontend calls this whenever its cached access token is about to
/// expire (or has expired).
///
/// Returns an error string when the refresh token is missing
/// (frontend should treat this as "not connected, prompt user to
/// re-authorize") or when Google rejects the refresh (token revoked
/// — same path).
#[tauri::command]
pub async fn drive_get_token(app: AppHandle) -> Result<AccessTokenInfo, String> {
    let refresh_token = read_refresh_token(&app)?;

    let client = oauth_client(None)?;
    let http = http_client()?;
    let token_result = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token.clone()))
        .request_async(&http)
        .await
        .map_err(|e| format!("refresh: {}", e))?;

    let access_token = token_result.access_token().secret().to_string();
    let expires_in = token_result
        .expires_in()
        .unwrap_or_else(|| Duration::from_secs(3600));
    let expires_at = (Utc::now()
        + ChronoDuration::from_std(expires_in).unwrap_or(ChronoDuration::seconds(3600)))
    .timestamp_millis();

    // If Google rotated the refresh token (rare, but happens for
    // long-lived `appdata`-scoped tokens), persist the new one. The
    // old refresh token will be invalidated server-side; if we don't
    // capture the new one, the next refresh fails.
    if let Some(new_rt) = token_result.refresh_token() {
        let new_secret = new_rt.secret();
        if new_secret != &refresh_token {
            let _ = write_refresh_token(&app, new_secret);
        }
    }

    Ok(AccessTokenInfo {
        access_token,
        expires_at,
    })
}

/// Forget the stored refresh token. Idempotent — calling on a
/// not-connected state succeeds.
#[tauri::command]
pub async fn drive_disconnect(app: AppHandle) -> Result<(), String> {
    forget_refresh_token(&app);
    Ok(())
}

/// Cheap probe: does the keychain have a refresh token for us?
/// Frontend uses this to render "Connect Drive" vs "Disconnect Drive"
/// without having to round-trip a full refresh.
#[tauri::command]
pub async fn drive_is_connected(app: AppHandle) -> bool {
    has_refresh_token(&app)
}

// ============ Loopback callback parsing ============

/// Accept a single connection on the loopback listener, parse the
/// `code` query parameter from the request line, send a friendly
/// HTML success page, and return the code.
async fn wait_for_callback(listener: TcpListener) -> Result<String, String> {
    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|e| format!("loopback accept: {}", e))?;

    let mut buf = vec![0u8; 8192];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("loopback read: {}", e))?;
    let request = std::str::from_utf8(&buf[..n])
        .map_err(|e| format!("loopback utf8: {}", e))?;

    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "empty request".to_string())?;
    let path_with_query = first_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "malformed request line".to_string())?;
    let query = path_with_query.splitn(2, '?').nth(1).unwrap_or("");

    let code_encoded = query
        .split('&')
        .find_map(|kv| {
            let mut parts = kv.splitn(2, '=');
            match (parts.next(), parts.next()) {
                (Some("code"), Some(v)) => Some(v.to_string()),
                _ => None,
            }
        })
        .ok_or_else(|| {
            // The redirect can also carry `error=...` if the user denied;
            // surface that as the more useful message.
            let err = query.split('&').find_map(|kv| {
                let mut parts = kv.splitn(2, '=');
                match (parts.next(), parts.next()) {
                    (Some("error"), Some(v)) => Some(v.to_string()),
                    _ => None,
                }
            });
            match err {
                Some(e) => format!("OAuth denied: {}", urlencoding::decode(&e).unwrap_or_default()),
                None => "no `code` in callback".to_string(),
            }
        })?;

    let code = urlencoding::decode(&code_encoded)
        .map_err(|e| format!("decode code: {}", e))?
        .into_owned();

    // Confirmation page so the user knows the flow worked.
    let body = "<!doctype html>\n\
<html lang=\"zh-CN\">\n\
<head><meta charset=\"utf-8\"><title>DayRail · 已连接</title>\n\
<style>body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#222;line-height:1.6}h1{font-weight:500;font-size:1.4rem}p{color:#555}</style>\n\
</head>\n\
<body><h1>✓ Drive 已连接</h1><p>可以关闭此页面，回到 DayRail。</p></body></html>\n";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;

    Ok(code)
}
