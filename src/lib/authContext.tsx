import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { clearSupabaseAuthStorage, supabase } from './supabaseClient'; // Use consistent client
import { appQueryClient } from './queryClient';
import { logger } from './logger/logger';
import { toError } from './logger/normalizeError';
import { readStubAuthState, STUB_AUTH_STORAGE_KEY } from './authStubSession';
import { getDefaultOrganizationId } from './runtimeConfig';

const normalizeOrgId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveAuthFlowForEvent = (event: AuthChangeEvent): 'normal' | 'password_recovery' => {
  switch (event) {
    case 'PASSWORD_RECOVERY':
      return 'password_recovery';
    case 'INITIAL_SESSION':
    case 'SIGNED_IN':
    case 'SIGNED_OUT':
    case 'TOKEN_REFRESHED':
    case 'USER_UPDATED':
    case 'USER_DELETED':
    case 'MFA_CHALLENGE_VERIFIED':
      return 'normal';
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
};

// User profile interface - moved from legacy auth.ts
export interface UserProfile {
  id: string;
  email: string;
  role: 'client' | 'therapist' | 'admin' | 'super_admin';
  organization_id?: string | null;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  phone?: string;
  avatar_url?: string;
  time_zone?: string;
  preferences?: Record<string, unknown>;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

type Role = UserProfile['role'];
type RoleRow = { is_active?: unknown; expires_at?: unknown; roles?: { name?: unknown } | null };

const toRole = (value: unknown): Role | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'client':
    case 'therapist':
    case 'admin':
      return normalized;
    case 'super_admin':
    case 'superadmin':
      return 'super_admin';
    default:
      return null;
  }
};

const roleOrder: readonly Role[] = ['super_admin', 'admin', 'therapist', 'client'];

const roleRowIsActive = (isActive: unknown, expiresAt: unknown): boolean => {
  if (isActive === false) {
    return false;
  }

  if (typeof expiresAt !== 'string' || expiresAt.trim().length === 0) {
    return true;
  }

  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }

  return parsed.getTime() > Date.now();
};

const resolveRoleFromRoleRows = (rows: RoleRow[]): Role | null => {
  const granted = new Set<Role>();

  for (const row of rows) {
    if (!roleRowIsActive(row.is_active, row.expires_at)) {
      continue;
    }

    const parsed = toRole(row.roles?.name);
    if (parsed) {
      granted.add(parsed);
    }
  }

  for (const role of roleOrder) {
    if (granted.has(role)) {
      return role;
    }
  }

  return null;
};

const sanitizeSignupRoleMetadata = (value: unknown): 'client' | 'therapist' => {
  const normalized = toRole(value);
  return normalized === 'therapist' ? 'therapist' : 'client';
};

const toLowerCaseString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const isExplicitTrue = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  const normalized = toLowerCaseString(value);
  if (!normalized) {
    return false;
  }
  return ['true', '1', 'yes', 'y'].includes(normalized);
};

const isGuardianRoleValue = (value: unknown): boolean => {
  const normalized = toLowerCaseString(value);
  return normalized === 'guardian';
};

const PROFILE_SELECT_COLUMNS = [
  'id',
  'email',
  'role',
  'organization_id',
  'first_name',
  'last_name',
  'full_name',
  'phone',
  'avatar_url',
  'time_zone',
  'preferences',
  'is_active',
  'last_login_at',
  'created_at',
  'updated_at',
].join(', ');

const PROFILE_SELECT_COLUMNS_FALLBACK = PROFILE_SELECT_COLUMNS
  .split(',')
  .map((column) => column.trim())
  .filter((column) => column !== 'organization_id')
  .join(', ');

const isMissingOrganizationIdColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeCode = 'code' in error ? (error as { code?: unknown }).code : null;
  const maybeMessage = 'message' in error ? (error as { message?: unknown }).message : null;

  return (
    maybeCode === '42703' &&
    typeof maybeMessage === 'string' &&
    maybeMessage.includes('profiles.organization_id')
  );
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  profileLoading: boolean;
  metadataRole: Role | null;
  effectiveRole: Role;
  roleMismatch: boolean;
  isGuardian?: boolean;
  authFlow: 'normal' | 'password_recovery';
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, metadata?: Record<string, unknown>) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: Error | null }>;
  hasRole: (role: 'client' | 'therapist' | 'admin' | 'super_admin') => boolean;
  hasAnyRole: (roles: ('client' | 'therapist' | 'admin' | 'super_admin')[]) => boolean;
  isAdmin: () => boolean;
  isSuperAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [roleFromAssignments, setRoleFromAssignments] = useState<Role | null>(null);
  const [authFlow, setAuthFlow] = useState<'normal' | 'password_recovery'>('normal');
  const signOutInProgressRef = useRef(false);

  const metadataRole = useMemo<Role | null>(() => {
    if (!user) return null;
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const keys = [
      'role',
      'signup_role',
      'signupRole',
      'default_role',
      'defaultRole',
      'primary_role',
      'primaryRole',
    ] as const;

    for (const key of keys) {
      const candidate = toRole(metadata[key]);
      if (candidate) return candidate;
    }

    return null;
  }, [user]);

  const profileRole = profile?.role ?? null;

  const rolePriority: Record<Role, number> = {
    client: 1,
    therapist: 2,
    admin: 3,
    super_admin: 4,
  };

  const effectiveRole = useMemo<Role>(() => {
    if (profileRole && roleFromAssignments) {
      // Prefer the highest role granted by authoritative role assignments.
      return rolePriority[roleFromAssignments] > rolePriority[profileRole] ? roleFromAssignments : profileRole;
    }
    if (roleFromAssignments) return roleFromAssignments;
    if (profileRole) return profileRole;
    return 'client';
  }, [profileRole, roleFromAssignments]);

  const roleMismatch = useMemo(
    () =>
      Boolean(
        (profileRole && metadataRole && profileRole !== metadataRole) ||
          (profileRole && roleFromAssignments && profileRole !== roleFromAssignments),
      ),
    [profileRole, metadataRole, roleFromAssignments],
  );

  const isGuardian = useMemo(() => {
    if (!user) {
      return false;
    }

    const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const profilePreferences =
      profile && typeof profile.preferences === 'object' && profile.preferences !== null
        ? (profile.preferences as Record<string, unknown>)
        : null;

    const guardianFlagCandidates = [
      userMetadata.guardian_signup,
      userMetadata.is_guardian,
      userMetadata.isGuardian,
      userMetadata.guardian,
      profilePreferences?.guardian_signup,
      profilePreferences?.is_guardian,
      profilePreferences?.isGuardian,
      profilePreferences?.guardian,
    ];

    if (guardianFlagCandidates.some(isExplicitTrue)) {
      return true;
    }

    const guardianRoleCandidates = [
      userMetadata.signup_role,
      userMetadata.signupRole,
      userMetadata.account_type,
      userMetadata.accountType,
      userMetadata.user_type,
      userMetadata.userType,
      userMetadata.role,
      profilePreferences?.account_type,
      profilePreferences?.accountType,
      profilePreferences?.user_type,
      profilePreferences?.userType,
      profilePreferences?.role,
    ];

    return guardianRoleCandidates.some(isGuardianRoleValue);
  }, [profile, user]);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const primaryQuery = supabase
        .from('profiles')
        .select(PROFILE_SELECT_COLUMNS)
        .eq('id', userId)
        .maybeSingle();

      const { data, error } = await primaryQuery;

      if (error && isMissingOrganizationIdColumnError(error)) {
        logger.warn('Profiles table is missing organization_id; retrying profile fetch without it', {
          metadata: {
            scope: 'authContext.fetchProfile',
            userId,
          },
        });

        const { data: fallbackData, error: fallbackError } = await supabase
          .from('profiles')
          .select(PROFILE_SELECT_COLUMNS_FALLBACK)
          .eq('id', userId)
          .maybeSingle();

        if (fallbackError) {
          logger.error('Failed to fetch profile record after fallback select', {
            error: toError(fallbackError, 'Profile fetch fallback failed'),
            metadata: {
              scope: 'authContext.fetchProfile',
              userId,
            },
          });
          return null;
        }

        return fallbackData as UserProfile | null;
      }

      if (error) {
        logger.error('Failed to fetch profile record', {
          error: toError(error, 'Profile fetch failed'),
          metadata: {
            scope: 'authContext.fetchProfile',
            userId,
          },
        });
        return null;
      }

      return data;
    } catch (error) {
      logger.error('Failed to fetch profile record', {
        error: toError(error, 'Profile fetch failed'),
        metadata: {
          scope: 'authContext.fetchProfile',
          userId,
        },
      });
      return null;
    }
  }, []);

  const fetchAssignedRole = useCallback(async (userId: string): Promise<Role | null> => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('is_active, expires_at, roles(name)')
        .eq('user_id', userId);

      if (error || !Array.isArray(data)) {
        logger.warn('Unable to resolve role assignments; falling back to profile role', {
          error: error ? toError(error, 'Role assignment query failed') : undefined,
          metadata: {
            scope: 'authContext.fetchAssignedRole',
            userId,
          },
        });
        return null;
      }

      return resolveRoleFromRoleRows(data as RoleRow[]);
    } catch (error) {
      logger.warn('Role assignment lookup failed unexpectedly; falling back to profile role', {
        error: toError(error, 'Role assignment query failed'),
        metadata: {
          scope: 'authContext.fetchAssignedRole',
          userId,
        },
      });
      return null;
    }
  }, []);

  const withTimeout = async <T,>(p: Promise<T>, label: string, ms = 10000): Promise<T> => {
    return Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Timeout: ${label}`)), ms)),
    ]) as Promise<T>;
  };

  const forceInactiveAccountSignOut = useCallback(async (userId: string, source: string) => {
    logger.warn('Inactive account detected during auth runtime; forcing sign-out', {
      metadata: {
        scope: 'authContext.inactiveAccount',
        userId,
        source,
      },
    });

    signOutInProgressRef.current = true;
    setAuthFlow('normal');
    setSession(null);
    setUser(null);
    setProfile(null);
    setRoleFromAssignments(null);
    setProfileLoading(false);

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
        clearSupabaseAuthStorage();
      }
      await supabase.auth.signOut();
    } catch (error) {
      logger.warn('Failed to fully sign out inactive account session', {
        error: toError(error, 'Inactive account sign-out failed'),
        metadata: {
          scope: 'authContext.inactiveAccount',
          userId,
          source,
        },
      });
    } finally {
      signOutInProgressRef.current = false;
      clearSupabaseAuthStorage();
      appQueryClient.clear();
    }
  }, []);

  const performInitialization = useCallback(async () => {
    const {
      data: { session: initialSession },
      error,
    } = await withTimeout(supabase.auth.getSession(), 'supabase.auth.getSession()', 15000);

    if (error) {
      throw error;
    }

    if (initialSession?.user) {
      setUser(initialSession.user);
      setSession(initialSession);
      setProfileLoading(true);
      const profileData = await withTimeout(fetchProfile(initialSession.user.id), 'fetchProfile');
      const assignedRole = await withTimeout(fetchAssignedRole(initialSession.user.id), 'fetchAssignedRole');
      if (profileData && profileData.is_active === false) {
        await forceInactiveAccountSignOut(initialSession.user.id, 'initializeAuth');
        return;
      }
      setProfile(profileData);
      setRoleFromAssignments(assignedRole);
      setProfileLoading(false);
      return;
    }

    const stubAuthState = readStubAuthState();
    if (stubAuthState) {
      setUser(stubAuthState.user);
      setSession(stubAuthState.session);
      setProfile(stubAuthState.profile);
      setRoleFromAssignments(null);
      setProfileLoading(false);
      return;
    }

    setUser(null);
    setSession(null);
    setProfile(null);
    setRoleFromAssignments(null);
    setProfileLoading(false);
  }, [fetchAssignedRole, fetchProfile, forceInactiveAccountSignOut]);

  const initializeAuth = useCallback(async () => {
    setLoading(true);
    const maxAttempts = 2;
    let attempt = 0;
    let initialized = false;

    try {
      while (attempt < maxAttempts && !initialized) {
        try {
          await performInitialization();
          initialized = true;
        } catch (error) {
          logger.error('Failed to initialize auth context', {
            error: toError(error, 'Auth initialization failed'),
            metadata: {
              scope: 'authContext.initializeAuth',
              attempt: attempt + 1,
            },
          });
          attempt += 1;

          if (attempt >= maxAttempts) {
            break;
          }

          try {
            await supabase.auth.signOut();
          } catch (signOutError) {
            logger.warn('Unable to reset Supabase session after auth init failure', {
              error: toError(signOutError, 'Auth session reset failed'),
              metadata: {
                scope: 'authContext.initializeAuth',
                attempt,
              },
            });
          }
        }
      }
    } finally {
      if (!initialized) {
        setUser(null);
        setSession(null);
        setProfile(null);
        setRoleFromAssignments(null);
        setProfileLoading(false);
      }
      setLoading(false);
    }
  }, [performInitialization]);

  const refreshProfileForSession = useCallback(async (nextSession: Session, event: string) => {
    setProfileLoading(true);
    logger.debug('Refreshing profile after auth state change', {
      metadata: {
        scope: 'authContext.onAuthStateChange',
        phase: 'profileRefresh.start',
        userId: nextSession.user.id,
        event,
      },
    });

    const [profileData, assignedRole] = await Promise.all([
      withTimeout(
        fetchProfile(nextSession.user.id),
        'fetchProfile in onAuthStateChange',
        10000
      ).catch((error) => {
        logger.error('Failed to fetch profile in auth state change', {
          error: toError(error, 'Profile fetch failed in listener'),
          metadata: {
            scope: 'authContext.onAuthStateChange',
            userId: nextSession.user.id,
            event,
          },
        });
        return null;
      }),
      fetchAssignedRole(nextSession.user.id),
    ]);

    logger.debug('Completed profile refresh after auth state change', {
      metadata: {
        scope: 'authContext.onAuthStateChange',
        phase: 'profileRefresh.complete',
        userId: nextSession.user.id,
        event,
        profileFound: Boolean(profileData),
      },
    });

    if (profileData && profileData.is_active === false) {
      await forceInactiveAccountSignOut(nextSession.user.id, `authStateChange:${event}`);
      return;
    }

    setRoleFromAssignments(assignedRole);
    setProfile((currentProfile) => {
      if (profileData) {
        return profileData;
      }

      // Keep the current profile for the same user when refresh-time profile
      // reads fail so route guards do not incorrectly downgrade permissions.
      if (currentProfile?.id === nextSession.user.id) {
        return currentProfile;
      }

      return null;
    });
    setProfileLoading(false);
  }, [fetchAssignedRole, fetchProfile, forceInactiveAccountSignOut]);

  const waitForSignedOutEvent = useCallback((timeoutMs = 5000): Promise<void> => {
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        subscription.unsubscribe();
        resolve();
      };

      const timeoutId = globalThis.setTimeout(() => {
        logger.warn('Timed out waiting for SIGNED_OUT auth event during sign-out', {
          metadata: {
            scope: 'authContext.signOut',
            timeoutMs,
          },
        });
        settle();
      }, timeoutMs);

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event !== 'SIGNED_OUT') {
          return;
        }
        globalThis.clearTimeout(timeoutId);
        settle();
      });
    });
  }, []);

  useEffect(() => {
    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      try {
        if (signOutInProgressRef.current) {
          if (event === 'SIGNED_OUT' || !session?.user) {
            setAuthFlow('normal');
            setSession(null);
            setUser(null);
            setProfile(null);
            setRoleFromAssignments(null);
            setProfileLoading(false);
            signOutInProgressRef.current = false;
          }
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);
        setAuthFlow(resolveAuthFlowForEvent(event));

        if (session?.user) {
          setProfileLoading(true);
          // Supabase warns against awaiting additional Supabase calls directly inside
          // this callback. Schedule profile refresh in a separate task to avoid
          // re-entrancy stalls that can lead to timeout errors during SIGNED_IN.
          window.setTimeout(() => {
            void refreshProfileForSession(session, event);
          }, 0);
        } else {
          const stubAuthState = readStubAuthState();
          if (stubAuthState) {
            setUser(stubAuthState.user);
            setSession(stubAuthState.session);
            setProfile(stubAuthState.profile);
            setRoleFromAssignments(null);
            setProfileLoading(false);
          } else {
            setProfile(null);
            setRoleFromAssignments(null);
            setProfileLoading(false);
          }
        }

        if (event === 'SIGNED_OUT') {
          setAuthFlow('normal');
          setUser(null);
          setProfile(null);
          setSession(null);
          setRoleFromAssignments(null);
          setProfileLoading(false);
        }
      } catch (error) {
        logger.error('Failed to process auth state change', {
          error: toError(error, 'Auth state change failed'),
          metadata: {
            scope: 'authContext.onAuthStateChange',
            event,
          },
        });
      } finally {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [initializeAuth, refreshProfileForSession]);

  // Set up real-time profile updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('profiles')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const nextProfile = payload.new as UserProfile;
          if (nextProfile.is_active === false) {
            void forceInactiveAccountSignOut(user.id, 'profilesRealtimeUpdate');
            return;
          }
          setProfile(nextProfile);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, forceInactiveAccountSignOut]);

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        return { error };
      }

      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error('Sign in failed') };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, metadata = {}) => {
    try {
      setLoading(true);

      const normalizedMetadata = { ...metadata } as Record<string, unknown>;
      normalizedMetadata.role = sanitizeSignupRoleMetadata(normalizedMetadata.role);
      normalizedMetadata.signup_role = sanitizeSignupRoleMetadata(normalizedMetadata.signup_role);
      const explicitSnake = normalizeOrgId(normalizedMetadata.organization_id);
      const explicitCamel = normalizeOrgId(normalizedMetadata.organizationId);
      const defaultOrganizationId = (() => {
        try {
          return normalizeOrgId(getDefaultOrganizationId());
        } catch {
          return null;
        }
      })();
      const resolvedOrganizationId = explicitSnake ?? explicitCamel ?? defaultOrganizationId;

      if (resolvedOrganizationId) {
        normalizedMetadata.organization_id = resolvedOrganizationId;
        normalizedMetadata.organizationId = resolvedOrganizationId;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: normalizedMetadata,
        },
      });
      
      if (error) {
        logger.error('Supabase sign-up request returned an error', {
          error: toError(error, 'Sign up failed'),
          metadata: {
            scope: 'authContext.signUp',
          },
        });
        return { error };
      }

      return { error: null };
    } catch (error) {
      logger.error('Supabase sign-up request threw an exception', {
        error: toError(error, 'Sign up failed'),
        metadata: {
          scope: 'authContext.signUp',
        },
      });
      return { error: error instanceof Error ? error : new Error('Sign up failed') };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      signOutInProgressRef.current = true;

      // Optimistically clear local auth state so route-level queries disable
      // immediately and do not continue firing with a stale session.
      setUser(null);
      setProfile(null);
      setSession(null);
      setRoleFromAssignments(null);

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
        clearSupabaseAuthStorage();
      }

      const signedOutEvent = waitForSignedOutEvent();
      const { error } = await supabase.auth.signOut();

      if (error) {
        logger.error('Supabase sign-out request returned an error', {
          error: toError(error, 'Sign out failed'),
          metadata: {
            scope: 'authContext.signOut',
          },
        });
        throw error;
      }

      await signedOutEvent;
    } catch (error) {
      signOutInProgressRef.current = false;
      logger.error('Supabase sign-out request threw an exception', {
        error: toError(error, 'Sign out failed'),
        metadata: {
          scope: 'authContext.signOut',
        },
      });
      throw error instanceof Error ? error : new Error('Sign out failed');
    } finally {
      signOutInProgressRef.current = false;
      clearSupabaseAuthStorage();
      appQueryClient.clear();
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/recovery`,
      });
      
      if (error) {
        logger.error('Supabase reset-password request returned an error', {
          error: toError(error, 'Password reset failed'),
          metadata: {
            scope: 'authContext.resetPassword',
          },
        });
        return { error };
      }

      return { error: null };
    } catch (error) {
      logger.error('Supabase reset-password request threw an exception', {
        error: toError(error, 'Password reset failed'),
        metadata: {
          scope: 'authContext.resetPassword',
        },
      });
      return { error: error instanceof Error ? error : new Error('Password reset failed') };
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return { error: new Error('Not authenticated') };

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select(PROFILE_SELECT_COLUMNS)
        .single();

      if (error) {
        logger.error('Supabase profile update returned an error', {
          error: toError(error, 'Profile update failed'),
          metadata: {
            scope: 'authContext.updateProfile',
            userId: user.id,
          },
        });
        return { error };
      }

      setProfile(data);
      return { error: null };
    } catch (error) {
      logger.error('Supabase profile update threw an exception', {
        error: toError(error, 'Profile update failed'),
        metadata: {
          scope: 'authContext.updateProfile',
          userId: user.id,
        },
      });
      return { error: error instanceof Error ? error : new Error('Update failed') };
    }
  };

  const resolveRoleForComparison = useCallback((): Role => {
    return effectiveRole;
  }, [effectiveRole]);

  const roleHierarchy: Record<Role, number> = {
    super_admin: 4,
    admin: 3,
    therapist: 2,
    client: 1,
  } as const;

  const hasRole = useCallback((role: Role) => {
    const currentRole = resolveRoleForComparison();
    return roleHierarchy[currentRole] >= roleHierarchy[role];
  }, [resolveRoleForComparison]);

  const hasAnyRole = useCallback((roles: Role[]) => {
    const currentRole = resolveRoleForComparison();
    const userLevel = roleHierarchy[currentRole];
    return roles.some((r) => userLevel >= roleHierarchy[r]);
  }, [resolveRoleForComparison]);

  const isAdmin = useCallback(() => {
    return effectiveRole === 'admin' || effectiveRole === 'super_admin';
  }, [effectiveRole]);

  const isSuperAdmin = useCallback(() => {
    return effectiveRole === 'super_admin';
  }, [effectiveRole]);

  const value = {
    user,
    profile,
    session,
    loading,
    profileLoading,
    metadataRole,
    effectiveRole,
    roleMismatch,
    isGuardian,
    authFlow,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updateProfile,
    hasRole,
    hasAnyRole,
    isAdmin,
    isSuperAdmin,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Helper function to validate authentication state
export const validateAuth = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { isValid: false, error: 'No user found' };

    // Check if user profile exists
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return { isValid: false, error: 'User profile not found' };
    }

    if (!profile.is_active) {
      return { isValid: false, error: 'User account is inactive' };
    }

    return { 
      isValid: true, 
      user, 
      profile,
      error: null 
    };
  } catch (error) {
    return { 
      isValid: false, 
      error: error instanceof Error ? error.message : 'Authentication validation failed' 
    };
  }
};