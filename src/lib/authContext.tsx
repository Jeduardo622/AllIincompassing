import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export interface UserProfile {
  id: string;
  email: string;
  role: 'client' | 'therapist' | 'admin' | 'super_admin';
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
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

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
  }, []);

  const initializeAuth = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get initial session
      const { data: { session: initialSession }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Error getting session:', error);
        return;
      }

      if (initialSession?.user) {
        setUser(initialSession.user);
        setSession(initialSession);
        
        // Fetch profile
        const profileData = await fetchProfile(initialSession.user.id);
        setProfile(profileData);
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
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
        setProfile(null);
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
        return { error };
      }

      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error('Sign up failed') };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      return { error };
    } catch (error) {
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

      if (error) return { error };

      setProfile(data);
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error('Update failed') };
    }
  };

  const hasRole = useCallback((role: 'client' | 'therapist' | 'admin' | 'super_admin') => {
    if (!profile) return false;
    
    // Role hierarchy: super_admin > admin > therapist > client
    const roleHierarchy: Record<string, number> = {
      'super_admin': 4,
      'admin': 3,
      'therapist': 2,
      'client': 1,
    };
    
    return roleHierarchy[profile.role] >= roleHierarchy[role];
  }, [profile]);

  const hasAnyRole = useCallback((roles: ('client' | 'therapist' | 'admin' | 'super_admin')[]) => {
    if (!profile) return false;
    
    const roleHierarchy: Record<string, number> = {
      'super_admin': 4,
      'admin': 3,
      'therapist': 2,
      'client': 1,
    };
    
    const userLevel = roleHierarchy[profile.role];
    return roles.some(role => userLevel >= roleHierarchy[role]);
  }, [profile]);

  const isAdmin = useCallback(() => {
    return profile?.role === 'admin' || profile?.role === 'super_admin';
  }, [profile]);

  const isSuperAdmin = useCallback(() => {
    return profile?.role === 'super_admin';
  }, [profile]);

  const value = {
    user,
    profile,
    session,
    loading,
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