import { supabase } from './supabase'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@supabase/supabase-js'

// Types for the new auth system
export interface UserProfile {
  id: string
  email: string
  role: 'client' | 'therapist' | 'admin' | 'super_admin'
  first_name?: string
  last_name?: string
  full_name?: string
  phone?: string
  avatar_url?: string
  time_zone?: string
  preferences?: Record<string, unknown>
  is_active: boolean
  last_login_at?: string
  created_at: string
  updated_at: string
}

export interface AuthState {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  initialized: boolean
  initializing: boolean
  demoMode: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, metadata?: Record<string, unknown>) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: Error | null }>
  hasRole: (role: 'client' | 'therapist' | 'admin' | 'super_admin') => boolean
  hasAnyRole: (roles: ('client' | 'therapist' | 'admin' | 'super_admin')[]) => boolean
  isAdmin: () => boolean
  isSuperAdmin: () => boolean
  refreshUserData: () => Promise<void>
  initialize: () => Promise<void>
  enableDemoMode: () => void
}

// Check if we're in a demo/development environment
const isDemoMode = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  return !supabaseUrl || supabaseUrl.includes('placeholder');
};

// Create auth store with new clean architecture
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      profile: null,
      roles: [],
      permissions: [],
      loading: false,
      initialized: false,
      initializing: false,
      demoMode: isDemoMode(),

      enableDemoMode: () => {
        set({ 
          demoMode: true,
          initialized: true,
          user: {
            id: 'demo-user',
            email: 'demo@example.com',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            role: 'authenticated'
          } as User,
          profile: {
            id: 'demo-user',
            email: 'demo@example.com',
            role: 'admin',
            first_name: 'Demo',
            last_name: 'User',
            full_name: 'Demo User',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        });
      },

      signIn: async (email: string, password: string) => {
        set({ loading: true });
        
        if (get().demoMode) {
          // Demo mode sign in
          setTimeout(() => {
            get().enableDemoMode();
            set({ loading: false });
          }, 1000);
          return { error: null };
        }

        try {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            set({ loading: false });
            return { error };
          }

          // Validate authentication state after sign in
          const validation = await validateAuth();
          if (!validation.isValid) {
            set({ loading: false });
            return { error: new Error(validation.error || 'Authentication validation failed') };
          }

          // Refresh user data after successful sign in
          await get().refreshUserData();
          set({ loading: false });
          return { error: null };
        } catch (error) {
          set({ loading: false });
          return { error: error instanceof Error ? error : new Error('Sign in failed') };
        }
      },

      signUp: async (email: string, password: string, metadata = {}) => {
        set({ loading: true });
        
        if (get().demoMode) {
          // Demo mode sign up
          setTimeout(() => {
            get().enableDemoMode();
            set({ loading: false });
          }, 1000);
          return { error: null };
        }

        try {
          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: metadata,
            },
          });

          if (error) {
            set({ loading: false });
            return { error };
          }

          set({ loading: false });
          return { error: null };
        } catch (error) {
          set({ loading: false });
          return { error: error instanceof Error ? error : new Error('Sign up failed') };
        }
      },

      signOut: async () => {
        set({ loading: true });
        
        if (get().demoMode) {
                  set({
          user: null,
          profile: null,
          loading: false,
          demoMode: true,
          initialized: true
        });
          return;
        }

        try {
          await supabase.auth.signOut();
                  set({
          user: null,
          profile: null,
          loading: false,
        });
        } catch (error) {
          console.error('Sign out error:', error);
          set({ loading: false });
        }
      },

      updateProfile: async (updates: Partial<UserProfile>) => {
        const { user, demoMode } = get();
        if (!user) return { error: new Error('Not authenticated') };

        if (demoMode) {
          // Demo mode - just update local state
          set(state => ({
            profile: state.profile ? { ...state.profile, ...updates } : null
          }));
          return { error: null };
        }

        try {
          const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', user.id)
            .select()
            .single();

          if (error) return { error };

          set({ profile: data });
          return { error: null };
        } catch (error) {
          return { error: error instanceof Error ? error : new Error('Update failed') };
        }
      },

      hasRole: (role: 'client' | 'therapist' | 'admin' | 'super_admin') => {
        const { profile } = get();
        if (!profile) return false;
        
        // Role hierarchy: super_admin > admin > therapist > client
        const roleHierarchy: Record<string, number> = {
          'super_admin': 4,
          'admin': 3,
          'therapist': 2,
          'client': 1,
        };
        
        return roleHierarchy[profile.role] >= roleHierarchy[role];
      },

      hasAnyRole: (roles: ('client' | 'therapist' | 'admin' | 'super_admin')[]) => {
        const { profile } = get();
        if (!profile) return false;
        
        const roleHierarchy: Record<string, number> = {
          'super_admin': 4,
          'admin': 3,
          'therapist': 2,
          'client': 1,
        };
        
        const userLevel = roleHierarchy[profile.role];
        return roles.some(role => userLevel >= roleHierarchy[role]);
      },

      isAdmin: () => {
        const { profile } = get();
        return profile?.role === 'admin' || profile?.role === 'super_admin';
      },

      isSuperAdmin: () => {
        const { profile } = get();
        return profile?.role === 'super_admin';
      },

      refreshUserData: async () => {
        if (get().demoMode) {
          get().enableDemoMode();
          return;
        }

        try {
          const { data: { user } } = await supabase.auth.getUser();
          
          if (!user) {
            set({
              user: null,
              profile: null,
              roles: [],
              permissions: [],
            });
            return;
          }

                  // Get user profile with role
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (profileError) {
          console.error('Profile fetch error:', profileError);
          // Profile should be created by trigger, but if it doesn't exist, something is wrong
          set({
            user: null,
            profile: null,
          });
          return;
        }

        set({
          user,
          profile,
        });
        } catch (error) {
          console.error('Error refreshing user data:', error);
                  // Set user but with minimal data
        set({
          user: get().user,
          profile: null,
        });
        }
      },

      initialize: async () => {
        // Guard against multiple initializations or initialization in progress
        if (get().initialized || get().initializing) return;

        // Set initializing flag to prevent concurrent initialization
        set({ initializing: true, loading: true });
        
        if (isDemoMode()) {
          console.log('🚀 Running in demo mode - Supabase not connected');
          get().enableDemoMode();
          set({ initializing: false, loading: false });
          return;
        }

        // Get initial session
        try {
          const { data: { session } } = await supabase.auth.getSession();
        
          if (session?.user) {
            await get().refreshUserData();
          }

          // Listen for auth changes but avoid setup if we're already initialized
          const authListener = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
              await get().refreshUserData();
            } else if (event === 'SIGNED_OUT') {
              set({
                user: null,
                profile: null,
                roles: [],
                permissions: [],
              });
            }
          });
          
          // Store the unsubscribe function in localStorage to ensure we clean it up later
          const prevListenerJson = localStorage.getItem('auth-listener');
          if (prevListenerJson) {
            try {
              const prevListener = JSON.parse(prevListenerJson);
              if (prevListener.id) {
                // Clean up old listener if it exists
                supabase.removeChannel(prevListener.id);
              }
            } catch (e) {
              console.warn('Failed to parse previous auth listener', e);
            }
          }
          
          // Store new listener reference (safely)
          try {
            localStorage.setItem('auth-listener', JSON.stringify({
              id: authListener.data.subscription.id,
              timestamp: Date.now()
            }));
          } catch (e) {
            console.warn('Failed to store auth listener reference', e);
          }
        } catch (error) {
          console.error('Error during auth initialization:', error);
          // Fallback to demo mode if initialization fails
          get().enableDemoMode();
        } finally { 
          // Always mark as initialized and not loading, even if there was an error
          set({ initializing: false, loading: false, initialized: true });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        profile: state.profile,
        demoMode: state.demoMode,
        initialized: state.initialized,
      }),
    }
  )
);

// Helper functions for role checking
export const isAdmin = () => useAuth.getState().isAdmin()
export const isTherapist = () => useAuth.getState().hasRole('therapist')
export const isSuperAdmin = () => useAuth.getState().isSuperAdmin()
export const isClient = () => useAuth.getState().hasRole('client')

// Permission helpers based on role hierarchy
export const canViewClients = () => useAuth.getState().hasRole('therapist')
export const canManageSessions = () => useAuth.getState().hasRole('therapist')
export const canViewSchedule = () => useAuth.getState().hasRole('client')
export const canManageUsers = () => useAuth.getState().hasRole('admin')
export const canManageRoles = () => useAuth.getState().hasRole('super_admin')

// Initialize auth on app start
export const initializeAuth = () => {
  const state = useAuth.getState();
  if (!state.initialized && !state.initializing) {
    return state.initialize();
  }
  return Promise.resolve();
}

// Helper function to validate authentication state
export const validateAuth = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { isValid: false, error: 'No user found' }

    // Check if user profile exists
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, role, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return { isValid: false, error: 'User profile not found' }
    }

    if (!profile.is_active) {
      return { isValid: false, error: 'User account is inactive' }
    }

    return { 
      isValid: true, 
      user, 
      profile,
      error: null 
    }
  } catch (error) {
    return { 
      isValid: false, 
      error: error instanceof Error ? error.message : 'Authentication validation failed' 
    }
  }
}

// Test function to verify authentication system
export const testAuthSystem = async () => {
  try {
    console.log('🔍 Testing authentication system...')
    
    // Test 1: Check if we can get current user
    const { data: { user } } = await supabase.auth.getUser()
    console.log('✓ User fetch:', user ? `Found user: ${user.email}` : 'No user found')
    
    if (!user) {
      console.log('ℹ️  No user logged in - authentication system ready for login')
      return { success: true, message: 'Authentication system ready' }
    }
    
    // Test 2: Check if user profile exists
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, email, is_active')
      .eq('id', user.id)
      .single()
    
    if (profileError) {
      console.log('❌ Profile fetch failed:', profileError.message)
      return { success: false, error: 'Profile fetch failed' }
    }
    
    console.log('✓ Profile fetch:', profile ? `Found profile: ${profile.email}` : 'No profile found')
    
    // Test 3: Check if user roles work
    const { data: roles, error: rolesError } = await supabase
      .rpc('get_user_roles', { user_uuid: user.id })
    
    if (rolesError) {
      console.log('❌ Roles fetch failed:', rolesError.message)
      return { success: false, error: 'Roles fetch failed' }
    }
    
    console.log('✓ Roles fetch:', roles ? `Found roles: ${roles.join(', ')}` : 'No roles found')
    
    // Test 4: Check comprehensive roles function
    const { data: comprehensiveRoles, error: compRolesError } = await supabase
      .rpc('get_user_roles_comprehensive', { user_uuid: user.id })
    
    if (compRolesError) {
      console.log('❌ Comprehensive roles fetch failed:', compRolesError.message)
      return { success: false, error: 'Comprehensive roles fetch failed' }
    }
    
    console.log('✓ Comprehensive roles fetch:', comprehensiveRoles ? 
      `Found ${comprehensiveRoles.length} roles with permissions` : 'No roles found')
    
    console.log('🎉 Authentication system is working correctly!')
    return { 
      success: true, 
      user, 
      profile, 
      roles, 
      comprehensiveRoles,
      message: 'Authentication system fully functional' 
    }
    
  } catch (error) {
    console.error('❌ Authentication test failed:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}