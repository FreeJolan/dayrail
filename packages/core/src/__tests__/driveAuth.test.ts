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
