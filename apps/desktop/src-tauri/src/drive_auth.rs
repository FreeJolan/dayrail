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
// refresh token is stored locally; the frontend asks for fresh access
// tokens whenever needed. Google can still expire or revoke the grant
// (including after 7 days while the OAuth project is in Testing).

use std::path::PathBuf;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use keyring::Entry;
use oauth2::basic::{BasicClient, BasicErrorResponse, BasicErrorResponseType};
use oauth2::reqwest;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    PkceCodeChallenge, RedirectUrl, RefreshToken, RequestTokenError, Scope, TokenResponse, TokenUrl,
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
    let token = std::fs::read_to_string(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "NEEDS_RECONNECT: refresh token is missing".to_string()
        } else {
            format!("read refresh token: {}", e)
        }
    })?;
    let token = token.trim();
    if token.is_empty() {
        return Err("NEEDS_RECONNECT: refresh token is missing".to_string());
    }
    Ok(token.to_string())
}

/// Write to BOTH keychain (best-effort) and file (must succeed).
fn write_refresh_token(app: &AppHandle, token: &str) -> Result<(), String> {
    // File is authoritative: if this fails, the operation fails.
    let path = token_file_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create app_data_dir: {}", e))?;
    }
    write_refresh_token_file(&path, token)?;
    // Keychain is dark redundancy: if it succeeds (signed mac / win /
    // linux), great; if not (unsigned mac post-update), file alone
    // carries us through.
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USERNAME) {
        let _ = entry.set_password(token);
    }
    Ok(())
}

/// Atomic + permission-safe token file write.
///
/// Why not a plain `std::fs::write`: (a) it truncates in place, so a
/// crash mid-write leaves an EMPTY authoritative token file — and when
/// Google has just rotated the refresh token the old value is already
/// revoked server-side, forcing the user through the whole OAuth flow
/// again; (b) creating with the default umask and chmod-ing afterwards
/// leaves a window where the full token sits world-readable.
///
/// So: create a sibling temp file with 0600 from the start, write +
/// fsync, then rename into place (rename keeps the temp file's mode).
fn write_refresh_token_file(path: &std::path::Path, token: &str) -> Result<(), String> {
    use std::io::Write;

    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);

    let result = (|| -> std::io::Result<()> {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            // Applied at create time — the file is never readable by
            // other users, not even between create and chmod.
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        // If a stale temp file survived an earlier crash, `mode` above
        // didn't apply (it only affects newly created files) — tighten
        // explicitly before writing the secret into it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        f.write_all(token.as_bytes())?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        // Best-effort: don't leave a secret-bearing temp file behind.
        let _ = std::fs::remove_file(&tmp);
    }
    result.map_err(|e| format!("write token file: {}", e))
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
    let (auth_url, csrf_state) = client
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

    // 5. Wait for the callback (with an overall timeout). The state
    //    parameter ties the callback to THIS flow (RFC 8252 §8.9);
    //    stray connections (port scanners, browser speculative
    //    connections, favicon probes) are answered and ignored while
    //    we keep listening for the real redirect.
    let code = tokio::time::timeout(
        Duration::from_secs(OAUTH_CALLBACK_TIMEOUT_SECS),
        wait_for_callback(listener, csrf_state.secret()),
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
/// Only missing credentials and Google's `invalid_grant` require
/// reauthorization. Other failures preserve the connection for retry.
#[tauri::command]
pub async fn drive_get_token(app: AppHandle) -> Result<AccessTokenInfo, String> {
    let refresh_token = read_refresh_token(&app)?;

    let client = oauth_client(None)?;
    let http = http_client()?;
    let token_result = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token.clone()))
        .request_async(&http)
        .await
        .map_err(format_refresh_error)?;

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

fn format_refresh_error<RE: std::error::Error + 'static>(
    err: RequestTokenError<RE, BasicErrorResponse>,
) -> String {
    if matches!(
        &err,
        RequestTokenError::ServerResponse(response)
            if response.error() == &BasicErrorResponseType::InvalidGrant
    ) {
        return "NEEDS_RECONNECT: Google Drive authorization has expired or been revoked".to_string();
    }
    format!("refresh: {}", err)
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

/// Hard cap on how long one accepted connection may take to deliver a
/// complete request line. A stray connection that connects but never
/// sends (e.g. a browser's speculative socket) must not wedge the flow
/// while the real redirect waits in the accept backlog.
const PER_CONNECTION_READ_TIMEOUT_SECS: u64 = 10;

/// Upper bound on buffered request bytes. Google's redirect easily
/// fits; anything larger is garbage.
const MAX_REQUEST_LINE_BYTES: usize = 8192;

/// What one accepted loopback connection turned out to be.
#[derive(Debug, PartialEq)]
enum CallbackOutcome {
    /// Valid callback — `state` matched — carrying the authorization code.
    Code(String),
    /// Valid callback — `state` matched — but Google reported an error
    /// (typically the user denied consent).
    Denied(String),
    /// Anything else: stray connection, port scan, favicon probe,
    /// wrong/missing state. Ignored; keep listening.
    Stray,
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let mut parts = kv.splitn(2, '=');
        match (parts.next(), parts.next()) {
            (Some(k), Some(v)) if k == key => Some(v.to_string()),
            _ => None,
        }
    })
}

/// Classify one HTTP request line against the CSRF state of the flow
/// in progress. Only requests that echo back our exact `state` are
/// treated as OAuth callbacks (RFC 8252 §8.9); everything else is a
/// stray that must not abort — or be able to spoof — the flow.
fn evaluate_callback_request(first_line: &str, expected_state: &str) -> CallbackOutcome {
    let Some(path_with_query) = first_line.split_whitespace().nth(1) else {
        return CallbackOutcome::Stray;
    };
    let query = path_with_query.splitn(2, '?').nth(1).unwrap_or("");

    let state = query_param(query, "state")
        .and_then(|s| urlencoding::decode(&s).ok().map(|d| d.into_owned()));
    if state.as_deref() != Some(expected_state) {
        return CallbackOutcome::Stray;
    }

    if let Some(code) = query_param(query, "code") {
        if let Ok(decoded) = urlencoding::decode(&code) {
            if !decoded.is_empty() {
                return CallbackOutcome::Code(decoded.into_owned());
            }
        }
        return CallbackOutcome::Stray;
    }
    match query_param(query, "error") {
        Some(e) => CallbackOutcome::Denied(
            urlencoding::decode(&e)
                .map(|d| d.into_owned())
                .unwrap_or_else(|_| e),
        ),
        None => CallbackOutcome::Stray,
    }
}

/// Read until a complete request line ("...\r\n") is buffered. A single
/// `read()` is not enough — the request may arrive across several TCP
/// segments and a partial read would truncate the query string.
async fn read_request_line(stream: &mut tokio::net::TcpStream) -> Result<String, String> {
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line = &buf[..pos];
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            return Ok(String::from_utf8_lossy(line).into_owned());
        }
        if buf.len() >= MAX_REQUEST_LINE_BYTES {
            return Err("request line too long".to_string());
        }
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("loopback read: {}", e))?;
        if n == 0 {
            return Err("connection closed before a full request line".to_string());
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

async fn respond_and_close(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn result_page(heading: &str, detail: &str) -> String {
    format!(
        "<!doctype html>\n\
<html lang=\"zh-CN\">\n\
<head><meta charset=\"utf-8\"><title>DayRail</title>\n\
<style>body{{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#222;line-height:1.6}}h1{{font-weight:500;font-size:1.4rem}}p{{color:#555}}</style>\n\
</head>\n\
<body><h1>{}</h1><p>{}</p></body></html>\n",
        heading, detail
    )
}

/// Accept connections on the loopback listener until one of them is a
/// genuine OAuth callback for this flow (its `state` matches), parse
/// out the `code`, send a friendly HTML result page, and return the
/// code. Stray connections are answered with a 404 and ignored —
/// they can neither abort the flow nor inject a callback. The caller
/// wraps this in the overall OAUTH_CALLBACK_TIMEOUT_SECS timeout.
async fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("loopback accept: {}", e))?;

        // Bound each connection so an idle stray can't starve the real
        // redirect sitting in the accept backlog.
        let first_line = match tokio::time::timeout(
            Duration::from_secs(PER_CONNECTION_READ_TIMEOUT_SECS),
            read_request_line(&mut stream),
        )
        .await
        {
            Ok(Ok(line)) => line,
            // Read error / slow or silent peer → drop it, keep waiting.
            _ => continue,
        };

        match evaluate_callback_request(&first_line, expected_state) {
            CallbackOutcome::Code(code) => {
                let body = result_page("✓ Drive 已连接", "可以关闭此页面，回到 DayRail。");
                respond_and_close(&mut stream, "200 OK", &body).await;
                return Ok(code);
            }
            CallbackOutcome::Denied(err) => {
                let body = result_page("Drive 连接未完成", "授权被拒绝。可以关闭此页面，回到 DayRail 重试。");
                respond_and_close(&mut stream, "200 OK", &body).await;
                return Err(format!("OAuth denied: {}", err));
            }
            CallbackOutcome::Stray => {
                respond_and_close(&mut stream, "404 Not Found", "").await;
                continue;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_error(
        error: BasicErrorResponseType,
    ) -> RequestTokenError<std::io::Error, BasicErrorResponse> {
        RequestTokenError::ServerResponse(BasicErrorResponse::new(error, None, None))
    }

    #[test]
    fn expired_or_revoked_grant_requires_reconnect() {
        let message = format_refresh_error(server_error(BasicErrorResponseType::InvalidGrant));
        assert!(message.starts_with("NEEDS_RECONNECT:"));
    }

    #[test]
    fn service_and_client_errors_preserve_connection() {
        for error in [
            BasicErrorResponseType::InvalidClient,
            BasicErrorResponseType::Extension("temporarily_unavailable".to_string()),
        ] {
            let message = format_refresh_error(server_error(error));
            assert!(message.starts_with("refresh:"));
            assert!(!message.contains("NEEDS_RECONNECT"));
        }
    }

    #[test]
    fn network_failure_preserves_connection() {
        let error = RequestTokenError::<_, BasicErrorResponse>::Request(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "network timeout",
        ));
        let message = format_refresh_error(error);
        assert!(message.starts_with("refresh:"));
        assert!(!message.contains("NEEDS_RECONNECT"));
    }

    // ---- loopback callback classification ----

    const STATE: &str = "expected-state-abc123";

    #[test]
    fn callback_with_matching_state_and_code_is_accepted() {
        let line = format!("GET /callback?state={}&code=4%2F0AbCdEf HTTP/1.1", STATE);
        assert_eq!(
            evaluate_callback_request(&line, STATE),
            CallbackOutcome::Code("4/0AbCdEf".to_string())
        );
        // Param order must not matter.
        let line = format!("GET /callback?code=xyz&state={} HTTP/1.1", STATE);
        assert_eq!(
            evaluate_callback_request(&line, STATE),
            CallbackOutcome::Code("xyz".to_string())
        );
    }

    #[test]
    fn requests_without_or_with_wrong_state_are_strays() {
        // A `code` arriving without our state must NOT be treated as a
        // callback — that's the RFC 8252 §8.9 guard.
        for line in [
            "GET /callback?code=evil HTTP/1.1",
            "GET /callback?state=some-other-flow&code=evil HTTP/1.1",
            "GET /favicon.ico HTTP/1.1",
            "GET / HTTP/1.1",
            "",
            "garbage",
        ] {
            assert_eq!(
                evaluate_callback_request(line, STATE),
                CallbackOutcome::Stray,
                "line {line:?} must be classified as stray"
            );
        }
    }

    #[test]
    fn denial_with_matching_state_is_surfaced() {
        let line = format!("GET /callback?state={}&error=access_denied HTTP/1.1", STATE);
        assert_eq!(
            evaluate_callback_request(&line, STATE),
            CallbackOutcome::Denied("access_denied".to_string())
        );
        // A denial without our state is just a stray.
        let line = "GET /callback?error=access_denied HTTP/1.1";
        assert_eq!(evaluate_callback_request(line, STATE), CallbackOutcome::Stray);
    }

    #[tokio::test]
    async fn stray_connections_do_not_abort_the_flow() {
        use tokio::net::TcpStream;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let flow = tokio::spawn(async move { wait_for_callback(listener, STATE).await });

        // 1. Speculative connection that opens and closes without a byte.
        drop(TcpStream::connect(("127.0.0.1", port)).await.unwrap());

        // 2. Stray request carrying a code but no state — must be
        //    ignored, not accepted and not fatal.
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(b"GET /callback?code=evil HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut sink = Vec::new();
        let _ = s.read_to_end(&mut sink).await; // server replies 404 + close
        drop(s);

        // 3. The real callback, split across two TCP writes so a
        //    single-read implementation would see a truncated query.
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let full = format!("GET /callback?state={}&code=good%2Fcode HTTP/1.1\r\nHost: x\r\n\r\n", STATE);
        let (a, b) = full.as_bytes().split_at(30);
        s.write_all(a).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.write_all(b).await.unwrap();

        let code = flow.await.unwrap().unwrap();
        assert_eq!(code, "good/code");
    }

    #[tokio::test]
    async fn denial_from_the_real_flow_fails_with_oauth_denied() {
        use tokio::net::TcpStream;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let flow = tokio::spawn(async move { wait_for_callback(listener, STATE).await });

        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(
            format!("GET /callback?state={}&error=access_denied HTTP/1.1\r\n\r\n", STATE)
                .as_bytes(),
        )
        .await
        .unwrap();

        let err = flow.await.unwrap().unwrap_err();
        assert!(err.contains("OAuth denied: access_denied"), "got: {err}");
    }

    // ---- refresh-token file write ----

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "dayrail-drive-auth-test-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn token_file_write_is_atomic_and_private() {
        let scratch = Scratch::new();
        let path = scratch.0.join(TOKEN_FILE_NAME);

        write_refresh_token_file(&path, "refresh-token-1").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "refresh-token-1");
        // No temp file left behind.
        let tmp = scratch.0.join(format!("{}.tmp", TOKEN_FILE_NAME));
        assert!(!tmp.exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "token file must be 0600");
        }

        // Overwrite (the rotation path) keeps content + permissions.
        write_refresh_token_file(&path, "refresh-token-2").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "refresh-token-2");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }
}
