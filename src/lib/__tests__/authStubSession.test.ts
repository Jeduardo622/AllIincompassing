import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStubAuthState, STUB_AUTH_STORAGE_KEY } from '../authStubSession';

describe('readStubAuthState', () => {
  const originalLocation = globalThis.location;

  const setHostname = (hostname: string) => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        ...(originalLocation ?? {}),
        hostname,
      } as Location,
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    // Ensure Cypress flag is reset before each test
    delete (window as Window & { Cypress?: unknown }).Cypress;
    setHostname('localhost');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as Window & { Cypress?: unknown }).Cypress;
    if (originalLocation) {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    } else {
      delete (globalThis as { location?: Location }).location;
    }
  });

  const seedStubStorage = (overrides: Partial<Record<string, unknown>> = {}, now = Date.now()) => {
    const base = {
      user: {
        id: 'stub-user-id',
        email: 'stub@example.com',
        role: 'admin',
        full_name: 'Stub User',
        first_name: 'Stub',
        last_name: 'User',
      },
      accessToken: 'stub-access-token',
      refreshToken: 'stub-refresh-token',
      expiresAt: now + 60_000,
    };

    const payload = { ...base, ...overrides };

    localStorage.setItem(STUB_AUTH_STORAGE_KEY, JSON.stringify(payload));
  };

  const seedLegacyStub = (overrides: Partial<Record<string, unknown>> = {}, now = Date.now()) => {
    const base = {
      user: {
        id: 'legacy-user-id',
        email: 'legacy@example.com',
      },
      role: 'therapist',
      access_token: 'legacy-access-token',
      refresh_token: 'legacy-refresh-token',
      expires_at: Math.floor((now + 120_000) / 1000),
    };

    const payload = { ...base, ...overrides };

    localStorage.setItem(STUB_AUTH_STORAGE_KEY, JSON.stringify(payload));
  };

  const seedRouteAuditStub = (role: string, now = Date.now()) => {
    const payload = {
      role,
      user: {
        id: `${role}-user`,
        email: `${role}@example.com`,
      },
      access_token: `${role}-access-token`,
    };

    localStorage.setItem(STUB_AUTH_STORAGE_KEY, JSON.stringify(payload));
  };

  const seedMinimalStub = (role: string) => {
    const payload = {
      role,
      user: {
        id: `${role}-id`,
        email: `${role}@example.com`,
      },
    };

    localStorage.setItem(STUB_AUTH_STORAGE_KEY, JSON.stringify(payload));
  };

  it('returns null when stub auth is not permitted in the current environment', () => {
    seedStubStorage();
    setHostname('app.example.com');

    expect(readStubAuthState()).toBeNull();
  });

  it('hydrates Supabase-compatible auth state when Cypress is present', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    (window as Window & { Cypress?: unknown }).Cypress = {};
    seedStubStorage({}, now);

    const result = readStubAuthState();
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('stub@example.com');
    expect(result?.profile.role).toBe('admin');
    expect(result?.session.user).toBe(result?.user);
    expect(result?.session.expires_at).toBe(Math.floor((now + 60_000) / 1000));
    expect(result?.session.expires_in).toBe(60);
  });

  it('hydrates auth state on localhost even when Cypress is absent', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    seedStubStorage({
      user: {
        id: 'local-role-user',
        email: 'local@example.com',
        role: 'client',
      },
      accessToken: 'local-access',
      refreshToken: 'local-refresh',
    }, now);

    const result = readStubAuthState();
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('local@example.com');
    expect(result?.profile.role).toBe('client');
  });

  it('supports legacy snake_case payloads used by route audit tooling', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    seedLegacyStub({}, now);

    const result = readStubAuthState();
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('legacy@example.com');
    expect(result?.profile.role).toBe('therapist');
    expect(result?.session.expires_at).toBeGreaterThan(Math.floor(now / 1000));
  });

  it('derives a refresh token when the stub payload omits one', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    seedRouteAuditStub('admin', now);

    const result = readStubAuthState();
    expect(result).not.toBeNull();
    expect(result?.session.refresh_token).toBe('stub-refresh-admin-admin-user');
    expect(result?.session.access_token).toBe('admin-access-token');
    expect(result?.session.expires_at).toBeGreaterThan(Math.floor(now / 1000));

    const stored = JSON.parse(localStorage.getItem(STUB_AUTH_STORAGE_KEY) ?? '{}');
    expect(stored.refresh_token).toBe('stub-refresh-admin-admin-user');
    expect(stored.expires_at).toBeGreaterThan(Math.floor(now / 1000));
    expect(stored.refreshToken).toBe('stub-refresh-admin-admin-user');
    expect(stored.expiresAt).toBeGreaterThan(now);
  });

  it('derives an access token and expiry when the stub omits them entirely', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    seedMinimalStub('therapist');

    const result = readStubAuthState();
    expect(result).not.toBeNull();
    expect(result?.session.access_token).toBe('stub-access-therapist-therapist-id');
    expect(result?.session.refresh_token).toBe('stub-refresh-therapist-therapist-id');
    expect(result?.session.expires_at).toBeGreaterThan(Math.floor(now / 1000));

    const stored = JSON.parse(localStorage.getItem(STUB_AUTH_STORAGE_KEY) ?? '{}');
    expect(stored.access_token).toBe('stub-access-therapist-therapist-id');
    expect(stored.expires_at).toBeGreaterThan(Math.floor(now / 1000));
  });

  it('purges storage and returns null when the stub is expired', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    (window as Window & { Cypress?: unknown }).Cypress = {};
    seedStubStorage({ expiresAt: now - 1_000 }, now);

    expect(readStubAuthState(now)).toBeNull();
    expect(localStorage.getItem(STUB_AUTH_STORAGE_KEY)).toBeNull();
  });

  it('purges storage and returns null when payload is invalid', () => {
    (window as Window & { Cypress?: unknown }).Cypress = {};
    localStorage.setItem(STUB_AUTH_STORAGE_KEY, '{ invalid json');

    expect(readStubAuthState()).toBeNull();
    expect(localStorage.getItem(STUB_AUTH_STORAGE_KEY)).toBeNull();
  });

  it('purges storage when required identifiers are missing', () => {
    seedStubStorage({
      accessToken: undefined,
      user: {},
      role: undefined,
    });

    expect(readStubAuthState()).toBeNull();
    expect(localStorage.getItem(STUB_AUTH_STORAGE_KEY)).toBeNull();
  });
});
