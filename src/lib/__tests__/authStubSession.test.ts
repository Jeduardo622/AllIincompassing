import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStubAuthState, STUB_AUTH_STORAGE_KEY } from '../authStubSession';

describe('readStubAuthState', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    // Ensure Cypress flag is reset before each test
    delete (window as Window & { Cypress?: unknown }).Cypress;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as Window & { Cypress?: unknown }).Cypress;
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

  it('returns null when Cypress flag is absent', () => {
    seedStubStorage();

    expect(readStubAuthState()).toBeNull();
  });

  it('hydrates Supabase-compatible auth state when data is valid', () => {
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
});
