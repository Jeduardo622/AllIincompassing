import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient'; // Use consistent client
import { logger } from './logger/logger';
import { toError } from './logger/normalizeError';
import { readStubAuthState, STUB_AUTH_STORAGE_KEY } from './authStubSession';

// User profile interface - moved from legacy auth.ts
export interface UserProfile {
  id: string;
  email: string;
  role: 'client' | 'therapist' | 'admin' | 'super_admin';
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

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  metadataRole: Role | null;
  effectiveRole: Role;
  roleMismatch: boolean;
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

  const effectiveRole = useMemo<Role>(() => {
    if (profileRole) return profileRole;
    if (metadataRole) return metadataRole;
    return 'client';
  }, [profileRole, metadataRole]);

  const roleMismatch = useMemo(
    () => Boolean(profileRole && metadataRole && profileRole !== metadataRole),
    [profileRole, metadataRole],
  );

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

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

  const withTimeout = async <T,>(p: Promise<T>, label: string, ms = 10000): Promise<T> => {
    return Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Timeout: ${label}`)), ms)),
    ]) as Promise<T>;
  };

  const initializeAuth = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get initial session
      const { data: { session: initialSession }, error } = await withTimeout(
        supabase.auth.getSession(),
        'supabase.auth.getSession()'
      );
      
      if (error) {
        logger.error('Failed to fetch initial auth session', {
          error: toError(error, 'Auth session fetch failed'),
          metadata: {
            scope: 'authContext.initializeAuth',
          },
        });
        return;
      }

      if (initialSession?.user) {
        setUser(initialSession.user);
        setSession(initialSession);

        // Fetch profile
        const profileData = await withTimeout(fetchProfile(initialSession.user.id), 'fetchProfile');
        setProfile(profileData);
        return;
      }

      const stubAuthState = readStubAuthState();
      if (stubAuthState) {
        setUser(stubAuthState.user);
        setSession(stubAuthState.session);
        setProfile(stubAuthState.profile);
      }
    } catch (error) {
      logger.error('Failed to initialize auth context', {
        error: toError(error, 'Auth initialization failed'),
        metadata: {
          scope: 'authContext.initializeAuth',
        },
      });
    } finally {
      setLoading(false);
    }
  }, [fetchProfile]);

  useEffect(() => {
    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        const profileData = await fetchProfile(session.user.id);
        setProfile(profileData);
      } else {
        const stubAuthState = readStubAuthState();
        if (stubAuthState) {
          setUser(stubAuthState.user);
          setSession(stubAuthState.session);
          setProfile(stubAuthState.profile);
        } else {
          setProfile(null);
        }
      }

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setSession(null);
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [initializeAuth, fetchProfile]);

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
          setProfile(payload.new as UserProfile);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

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
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
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

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
      }

      // Clear local state
      setUser(null);
      setProfile(null);
      setSession(null);
    } catch (error) {
      logger.error('Supabase sign-out request threw an exception', {
        error: toError(error, 'Sign out failed'),
        metadata: {
          scope: 'authContext.signOut',
        },
      });
      throw error instanceof Error ? error : new Error('Sign out failed');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
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
        .select()
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
    const tokenRoles = Array.isArray((session as any)?.user?.user_metadata?.roles)
      ? ((session as any).user.user_metadata.roles as string[])
      : null;

    if (tokenRoles?.includes('super_admin')) return 'super_admin';
    if (tokenRoles?.includes('admin')) return 'admin';
    if (tokenRoles?.includes('therapist')) return 'therapist';
    if (tokenRoles?.includes('client')) return 'client';

    return effectiveRole;
  }, [session, effectiveRole]);

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
    metadataRole,
    effectiveRole,
    roleMismatch,
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
      .single();

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