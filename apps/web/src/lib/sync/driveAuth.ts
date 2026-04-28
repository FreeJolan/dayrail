// Google Identity Services token-client wrapper. Pure browser OAuth
// per ERD §7.1 ("no DayRail account backend"); access tokens live in
// memory only, never persisted.
//
// The GIS script (`https://accounts.google.com/gsi/client`) is loaded
// by index.html with `async defer`, so on first call we may need to
// wait for it. `ensureAccessToken` is the everyday entry-point: it
// returns a fresh, non-expired token, performing a silent refresh if
// the cached token is expired or near-expiry. `connect()` performs
// the one-time consent dance (popup); `disconnect()` revokes the
// token and forgets the connection.

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const NEAR_EXPIRY_MS = 5 * 60 * 1000; // refresh when < 5 min remains

const KEY_CONNECTED = 'dayrail.sync.driveConnected';

type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GisErrorResponse = {
  type?: string; // 'popup_failed_to_open' | 'popup_closed' | 'unknown'
  message?: string;
};

type TokenClientCallback = (resp: GisTokenResponse) => void;
type TokenClientErrorCallback = (resp: GisErrorResponse) => void;

interface TokenClient {
  callback: TokenClientCallback;
  error_callback?: TokenClientErrorCallback;
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (opts: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: TokenClientCallback;
            error_callback?: TokenClientErrorCallback;
          }) => TokenClient;
          revoke: (token: string, done: () => void) => void;
        };
      };
    };
  }
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let scriptPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;
let cachedToken: CachedToken | null = null;

function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!id || typeof id !== 'string' || id.length === 0) {
    throw new Error(
      '未配置 VITE_GOOGLE_OAUTH_CLIENT_ID — 请按 README "Google Drive 同步" 章节获取 OAuth Client ID 并填进 .env',
    );
  }
  return id;
}

/** Lazily load the GIS script. Idempotent. */
function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${GIS_SCRIPT_URL}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('GIS script failed to load')),
        { once: true },
      );
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', () => resolve(), { once: true });
    s.addEventListener(
      'error',
      () => reject(new Error('GIS script failed to load')),
      { once: true },
    );
    document.head.appendChild(s);
  });
  return scriptPromise;
}

async function ensureTokenClient(): Promise<TokenClient> {
  await loadScript();
  if (tokenClient) return tokenClient;
  const oauth2 = window.google?.accounts.oauth2;
  if (!oauth2) throw new Error('GIS oauth2 namespace unavailable');
  tokenClient = oauth2.initTokenClient({
    client_id: getClientId(),
    scope: SCOPE,
    callback: () => {
      /* per-request callback set inline below */
    },
  });
  return tokenClient;
}

function requestToken(prompt: '' | 'consent'): Promise<CachedToken> {
  return new Promise<CachedToken>((resolve, reject) => {
    void ensureTokenClient().then((client) => {
      let settled = false;
      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const settleResolve = (v: CachedToken) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      client.callback = (resp) => {
        if (resp.error) {
          settleReject(
            new Error(
              `Google 授权失败：${resp.error}${resp.error_description ? ' · ' + resp.error_description : ''}`,
            ),
          );
          return;
        }
        if (!resp.access_token || !resp.expires_in) {
          settleReject(new Error('Google 返回的 token 不完整'));
          return;
        }
        const fresh: CachedToken = {
          token: resp.access_token,
          expiresAt: Date.now() + resp.expires_in * 1000,
        };
        cachedToken = fresh;
        settleResolve(fresh);
      };
      client.error_callback = (err) => {
        // Fired when the popup itself fails. Three real-world
        // sub-cases:
        //   1. user closed the consent popup → 'popup_closed'
        //   2. silent refresh fell back to popup at boot, where no
        //      user gesture is active → browser blocks → fires
        //      'popup_failed_to_open'. Common after Chrome's
        //      third-party-cookie phase-out broke GIS's iframe
        //      silent path. The fix is NOT "allow popups" — the
        //      block is for unactivated popups, not for popups in
        //      general — but to retry from a user gesture (the
        //      `重新连接` button in the offline branch).
        //   3. anything else GIS gives us
        // The first two need a Reconnect prompt, not a Retry. The
        // `NEEDS_RECONNECT · ` prefix is a contract with the offline
        // branch in BootGate to flip its UI accordingly.
        const friendly =
          err.type === 'popup_closed'
            ? 'NEEDS_RECONNECT · Google 同意页被关闭，未完成授权'
            : err.type === 'popup_failed_to_open'
              ? 'NEEDS_RECONNECT · Google Drive 授权已过期或被浏览器限制静默刷新（这是预期行为，点 重新连接 重新授权）'
              : `Google 授权未完成：${err.type ?? 'unknown'}${err.message ? ' · ' + err.message : ''}`;
        settleReject(new Error(friendly));
      };
      try {
        client.requestAccessToken({ prompt });
      } catch (err) {
        settleReject(err as Error);
      }
    }, reject);
  });
}

/** Run the full consent flow once (popup). Marks the device as
 *  connected on success so subsequent boots can attempt silent
 *  refresh without a prior user interaction. */
export async function connectDrive(): Promise<void> {
  await requestToken('consent');
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY_CONNECTED, '1');
    } catch {
      /* private browsing — non-fatal */
    }
  }
}

/** Drop the in-memory token + the "connected" flag. Best-effort
 *  revocation against Google so the user's account-permissions page
 *  reflects the disconnect. */
export async function disconnectDrive(): Promise<void> {
  const had = cachedToken;
  cachedToken = null;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(KEY_CONNECTED);
    } catch {
      /* swallow */
    }
  }
  if (!had) return;
  try {
    await loadScript();
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      window.google?.accounts.oauth2.revoke(had.token, () => resolve());
    } catch {
      resolve();
    }
  });
}

/** Has the user finished a consent flow on this device? Doesn't
 *  guarantee the token is still valid — only that we should *try* a
 *  silent refresh on boot. */
export function isDriveConnected(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY_CONNECTED) === '1';
  } catch {
    return false;
  }
}

/** The everyday entry-point. Returns a fresh, non-expired access
 *  token, performing a silent refresh when needed. Throws if the
 *  device hasn't connected yet, or if the silent refresh fails (e.g.
 *  user signed out of Google in this browser, or revoked DayRail
 *  from Google's account-permissions page) — caller should treat
 *  that as the boot-gate "offline" branch. */
export async function ensureAccessToken(): Promise<string> {
  if (!isDriveConnected()) {
    throw new Error('NOT_CONNECTED');
  }
  if (cachedToken && cachedToken.expiresAt - Date.now() > NEAR_EXPIRY_MS) {
    return cachedToken.token;
  }
  const fresh = await requestToken('');
  return fresh.token;
}

/** Drop the cached token without disconnecting. Use after a 401 to
 *  force the next call to silent-refresh. */
export function invalidateCachedToken(): void {
  cachedToken = null;
}
