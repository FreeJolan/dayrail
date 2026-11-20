/// <reference path="../../../../apps/web/src/vite-env.d.ts" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY_CONNECTED = 'dayrail.sync.driveConnected';
const KEY_CACHED_TOKEN = 'dayrail.sync.cachedAccessToken';

describe('desktop Drive authorization', () => {
  const storage = new Map<string, string>();
  const invoke = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    storage.clear();
    storage.set(KEY_CONNECTED, '1');
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: { invoke },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    'refresh: network timeout',
    'refresh: server returned 503',
    'read refresh token: permission denied',
    'refresh: invalid_client',
  ])('keeps authorization after %s and silently retries', async (failure) => {
    invoke.mockRejectedValueOnce(failure).mockResolvedValueOnce({
      access_token: 'renewed-token',
      expires_at: Date.now() + 3_600_000,
    });
    // Exercise the real auth module and its Tauri IPC boundary. No browser
    // window, keychain or Google account is needed for these regressions.
    const auth = await import('../../../../apps/web/src/lib/sync/driveAuth');

    await expect(auth.ensureAccessToken()).rejects.toThrow(failure);
    expect(auth.isDriveConnected()).toBe(true);
    await expect(auth.ensureAccessToken()).resolves.toBe('renewed-token');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.every(([command]) => command === 'drive_get_token')).toBe(true);
    expect(storage.get(KEY_CONNECTED)).toBe('1');
    expect(JSON.parse(storage.get(KEY_CACHED_TOKEN)!)).toMatchObject({ token: 'renewed-token' });
  });

  it.each([
    'NEEDS_RECONNECT: Google Drive authorization has expired or been revoked',
    'NEEDS_RECONNECT: refresh token is missing',
  ])('requests consent again only after %s', async (failure) => {
    invoke.mockRejectedValueOnce(failure);
    const auth = await import('../../../../apps/web/src/lib/sync/driveAuth');

    await expect(auth.ensureAccessToken()).rejects.toThrow('NEEDS_RECONNECT');
    expect(auth.isDriveConnected()).toBe(false);
    expect(storage.has(KEY_CACHED_TOKEN)).toBe(false);
    await expect(auth.ensureAccessToken()).rejects.toThrow('NOT_CONNECTED');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reuses a persisted access token without refreshing it on every launch', async () => {
    storage.set(KEY_CACHED_TOKEN, JSON.stringify({
      token: 'still-valid-token',
      expiresAt: Date.now() + 3_600_000,
    }));
    const auth = await import('../../../../apps/web/src/lib/sync/driveAuth');

    await expect(auth.ensureAccessToken()).resolves.toBe('still-valid-token');
    expect(invoke).not.toHaveBeenCalled();
  });
});

// Browser (GIS) path. The GIS token client is a singleton whose
// `callback` is reassigned per request — concurrent requests used to
// clobber each other's settle closures, leaving the earlier Promise
// pending forever (and with it inFlightPush / the whole session's
// sync). These tests drive the real driveAuth module against a fake
// GIS client that, like the real one, invokes whatever callback is
// CURRENT at response-delivery time.
describe('browser (GIS) concurrent token requests', () => {
  const storage = new Map<string, string>();

  type TokenResponse = {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  let client: {
    callback: (resp: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
    requestAccessToken: ReturnType<typeof vi.fn>;
  };
  let pendingResponses: Array<() => void>;

  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    storage.set(KEY_CONNECTED, '1');
    pendingResponses = [];
    let tokenSerial = 0;
    client = {
      callback: () => {},
      requestAccessToken: vi.fn(() => {
        const serial = ++tokenSerial;
        // Deliver later, through the callback that is assigned on the
        // client AT DELIVERY TIME — the clobber the fix defends against.
        pendingResponses.push(() =>
          client.callback({ access_token: `token-${serial}`, expires_in: 3600 }),
        );
      }),
    };
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      google: {
        accounts: {
          oauth2: {
            initTokenClient: () => client,
            revoke: (_token: string, done: () => void) => done(),
          },
        },
      },
    });
    vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', 'test-client-id');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('settles BOTH concurrent silent refreshes instead of stranding the first', async () => {
    const auth = await import('../../../../apps/web/src/lib/sync/driveAuth');
    const p1 = auth.ensureAccessToken();
    const p2 = auth.ensureAccessToken();
    await flush();
    // Serialized: only one GIS request may be outstanding at a time.
    expect(client.requestAccessToken).toHaveBeenCalledTimes(1);
    pendingResponses[0]!();
    await expect(p1).resolves.toBe('token-1');
    // The queued request finds the just-refreshed cache — no second
    // GIS round-trip (which could pop a consent window).
    await expect(p2).resolves.toBe('token-1');
    expect(client.requestAccessToken).toHaveBeenCalledTimes(1);
  });

  it('a rejected request does not poison the queue for later requests', async () => {
    const auth = await import('../../../../apps/web/src/lib/sync/driveAuth');
    const p1 = auth.ensureAccessToken();
    await flush();
    client.callback({ error: 'interaction_required' });
    await expect(p1).rejects.toThrow('Google 授权失败');

    const p2 = auth.ensureAccessToken();
    await flush();
    expect(client.requestAccessToken).toHaveBeenCalledTimes(2);
    pendingResponses[1]!();
    await expect(p2).resolves.toBe('token-2');
  });
});
