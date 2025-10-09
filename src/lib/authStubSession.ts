import type { Session, User } from '@supabase/supabase-js';
import type { UserProfile } from './authContext';

export const STUB_AUTH_STORAGE_KEY = 'auth-storage';

const VALID_ROLES = new Set(['client', 'therapist', 'admin', 'super_admin']);

interface StubAuthStorage {
  user?: {
    id?: string;
    email?: string;
    role?: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
  };
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

const isBrowser = (): window is Window & { Cypress?: unknown } => typeof window !== 'undefined';

const hasCypress = (currentWindow: Window & { Cypress?: unknown }): boolean => Boolean(currentWindow.Cypress);

const buildUser = (params: { id: string; email: string; role: 'client' | 'therapist' | 'admin' | 'super_admin'; nowIso: string; }): User => {
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

const buildProfile = (params: { id: string; email: string; role: 'client' | 'therapist' | 'admin' | 'super_admin'; nowIso: string; user: StubAuthStorage['user']; }): UserProfile => {
  const { id, email, role, nowIso, user } = params;

  return {
    id,
    email,
    role,
    first_name: user?.first_name,
    last_name: user?.last_name,
    full_name: user?.full_name,
    phone: undefined,
    avatar_url: undefined,
    time_zone: undefined,
    preferences: undefined,
    is_active: true,
    last_login_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  };
};

const buildSession = (params: { accessToken: string; refreshToken: string; expiresAt: number; now: number; user: User; }): Session => {
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

export interface StubAuthState {
  user: User;
  session: Session;
  profile: UserProfile;
}

export const readStubAuthState = (now = Date.now()): StubAuthState | null => {
  if (!isBrowser()) {
    return null;
  }

  const currentWindow = window as Window & { Cypress?: unknown };

  if (!hasCypress(currentWindow)) {
    return null;
  }

  const raw = currentWindow.localStorage.getItem(STUB_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StubAuthStorage;

    const { user, accessToken, refreshToken, expiresAt } = parsed;

    if (!user || typeof user.id !== 'string' || typeof user.email !== 'string' || typeof user.role !== 'string') {
      currentWindow.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
      return null;
    }

    if (!VALID_ROLES.has(user.role)) {
      currentWindow.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
      return null;
    }

    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
      currentWindow.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
      return null;
    }

    if (typeof expiresAt !== 'number' || Number.isNaN(expiresAt) || expiresAt <= now) {
      currentWindow.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
      return null;
    }

    const normalizedRole = user.role as 'client' | 'therapist' | 'admin' | 'super_admin';
    const nowIso = new Date(now).toISOString();
    const supabaseUser = buildUser({
      id: user.id,
      email: user.email,
      role: normalizedRole,
      nowIso,
    });

    const session = buildSession({
      accessToken,
      refreshToken,
      expiresAt,
      now,
      user: supabaseUser,
    });

    const profile = buildProfile({
      id: user.id,
      email: user.email,
      role: normalizedRole,
      nowIso,
      user,
    });

    return {
      user: supabaseUser,
      session,
      profile,
    };
  } catch {
    currentWindow.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
    return null;
  }
};
