import type { Session, User } from '@supabase/supabase-js';
import type { UserProfile } from './authContext';

export const STUB_AUTH_STORAGE_KEY = 'auth-storage';

type Role = 'client' | 'therapist' | 'admin' | 'super_admin';

const VALID_ROLES = new Set<Role>(['client', 'therapist', 'admin', 'super_admin']);

type StubPayload = {
  readonly user?: {
    readonly id?: unknown;
    readonly email?: unknown;
    readonly role?: unknown;
    readonly full_name?: unknown;
    readonly fullName?: unknown;
    readonly first_name?: unknown;
    readonly firstName?: unknown;
    readonly last_name?: unknown;
    readonly lastName?: unknown;
  };
  readonly role?: unknown;
  readonly accessToken?: unknown;
  readonly refreshToken?: unknown;
  readonly expiresAt?: unknown;
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_at?: unknown;
  readonly profile?: Partial<UserProfile> | null;
};

const isBrowser = (): window is Window & { Cypress?: unknown } => typeof window !== 'undefined';

const allowStubAuth = (currentWindow: Window & { Cypress?: unknown }): boolean => {
  if (currentWindow.Cypress) {
    return true;
  }

  const hostname = typeof globalThis.location?.hostname === 'string' ? globalThis.location.hostname : '';
  return hostname === '127.0.0.1' || hostname === 'localhost';
};

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normaliseExpiresAt = (candidate: unknown, now: number): number | null => {
  if (typeof candidate !== 'number' || Number.isNaN(candidate)) {
    return now + 60 * 60 * 1000;
  }

  const asMs = candidate < 10_000_000_000 ? candidate * 1000 : candidate;
  if (!Number.isFinite(asMs) || asMs <= now) {
    return null;
  }
  return asMs;
};

const buildUser = (params: { id: string; email: string; role: Role; nowIso: string }): User => {
  const { id, email, role, nowIso } = params;

  return {
    id,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {
      provider: 'stub',
      providers: ['stub'],
      role,
    },
    user_metadata: {
      email,
      role,
    },
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
    last_sign_in_at: nowIso,
    factors: [],
    confirmed_at: nowIso,
    email_confirmed_at: nowIso,
    phone: '',
    is_anonymous: false,
  } as unknown as User;
};

const buildSession = (params: { accessToken: string; refreshToken: string; expiresAt: number; now: number; user: User }): Session => {
  const { accessToken, refreshToken, expiresAt, now, user } = params;
  const expiresInMs = Math.max(0, expiresAt - now);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: Math.floor(expiresInMs / 1000),
    expires_at: Math.floor(expiresAt / 1000),
    user,
    provider_token: null,
    provider_refresh_token: null,
  } as unknown as Session;
};

const buildProfile = (params: {
  id: string;
  email: string;
  role: Role;
  nowIso: string;
  user: StubPayload['user'];
  profile: Partial<UserProfile> | null;
}): UserProfile => {
  const { id, email, role, nowIso, user, profile } = params;
  const userFullName = toOptionalString(user?.full_name) ?? toOptionalString(user?.fullName);
  const userFirstName = toOptionalString(user?.first_name) ?? toOptionalString(user?.firstName);
  const userLastName = toOptionalString(user?.last_name) ?? toOptionalString(user?.lastName);
  const derivedFullNameCandidate = [userFirstName, userLastName].filter(Boolean).join(' ').trim();
  const derivedFullName = derivedFullNameCandidate.length > 0 ? derivedFullNameCandidate : undefined;

  return {
    id,
    email,
    role,
    first_name: toOptionalString(profile?.first_name) ?? userFirstName,
    last_name: toOptionalString(profile?.last_name) ?? userLastName,
    full_name: toOptionalString(profile?.full_name) ?? userFullName ?? derivedFullName,
    phone: toOptionalString(profile?.phone),
    avatar_url: toOptionalString(profile?.avatar_url),
    time_zone: toOptionalString(profile?.time_zone),
    preferences: typeof profile?.preferences === 'object' && profile?.preferences !== null ? profile.preferences : undefined,
    is_active: typeof profile?.is_active === 'boolean' ? profile.is_active : true,
    last_login_at: toOptionalString(profile?.last_login_at) ?? nowIso,
    created_at: toOptionalString(profile?.created_at) ?? nowIso,
    updated_at: toOptionalString(profile?.updated_at) ?? nowIso,
  };
};

export interface StubAuthState {
  user: User;
  session: Session;
  profile: UserProfile;
}

const normaliseRole = (payload: StubPayload): Role | null => {
  const role = toOptionalString(payload.user?.role) ?? toOptionalString(payload.role);
  if (!role || !VALID_ROLES.has(role as Role)) {
    return null;
  }
  return role as Role;
};

const normaliseStubPayload = (payload: StubPayload, now: number): StubAuthState | null => {
  const role = normaliseRole(payload);
  if (!role) {
    return null;
  }

  const id = toOptionalString(payload.user?.id) ?? `stub-${role}`;
  const email = toOptionalString(payload.user?.email) ?? `${role}@example.com`;
  const accessToken = toOptionalString(payload.accessToken) ?? toOptionalString(payload.access_token);
  const refreshToken = toOptionalString(payload.refreshToken) ?? toOptionalString(payload.refresh_token);
  const expiresAt = normaliseExpiresAt(payload.expiresAt ?? payload.expires_at, now);

  if (!accessToken || !refreshToken || !expiresAt || !id || !email) {
    return null;
  }

  const nowIso = new Date(now).toISOString();
  const supabaseUser = buildUser({ id, email, role, nowIso });
  const session = buildSession({ accessToken, refreshToken, expiresAt, now, user: supabaseUser });
  const profile = buildProfile({ id, email, role, nowIso, user: payload.user, profile: payload.profile ?? null });

  return {
    user: supabaseUser,
    session,
    profile,
  };
};

export const readStubAuthState = (now = Date.now()): StubAuthState | null => {
  if (!isBrowser()) {
    return null;
  }

  const currentWindow = window as Window & { Cypress?: unknown };
  if (!allowStubAuth(currentWindow)) {
    return null;
  }

  const raw = currentWindow.localStorage.getItem(STUB_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StubPayload;
    const state = normaliseStubPayload(parsed, now);
    if (!state) {
      currentWindow.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
      return null;
    }
    return state;
  } catch {
    currentWindow.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
    return null;
  }
};
