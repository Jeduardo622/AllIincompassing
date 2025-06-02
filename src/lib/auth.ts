import { create } from 'zustand';
import { supabase } from './supabase';
import type { User } from '@supabase/supabase-js';
import { showSuccess, showError } from './toast'; 
import { isValidEmail } from './validation';

interface AuthState {
  user: User | null;
  roles: string[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, isAdmin?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
  setRoles: (roles: string[]) => void;
  hasRole: (role: string) => boolean;
  refreshSession: () => Promise<void>;
}

// Constants for timeouts and retry logic
const AUTH_REQUEST_TIMEOUT = 60000; // Increased from 30000 to 60000 (60 seconds)
const SESSION_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY = 1000; // 1 second initial delay

// Helper function to add timeout to promises
const withTimeout = <T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${errorMessage}`)), ms)
    )
  ]) as Promise<T>;
};

// Helper function for exponential backoff retry
const withRetry = async <T>(
  fn: () => Promise<T>, 
  maxRetries: number = MAX_RETRIES,
  initialDelay: number = INITIAL_RETRY_DELAY,
  timeoutMs: number = AUTH_REQUEST_TIMEOUT,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> => {
  let retries = 0;
  let lastError: Error | null = null;
  
  while (retries <= maxRetries) {
    try {
      // If not the first attempt, log retry information
      if (retries > 0) {
        console.log(`Retry attempt ${retries}/${maxRetries} after ${initialDelay * Math.pow(2, retries - 1)}ms delay`);
      }
      
      // Execute the function with timeout
      return await withTimeout(fn(), timeoutMs, timeoutMessage);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Attempt ${retries + 1}/${maxRetries + 1} failed:`, lastError.message);
      
      // If we've reached max retries, throw the last error
      if (retries >= maxRetries) {
        throw lastError;
      }
      
      // Calculate delay with exponential backoff: initialDelay * 2^retries
      const delay = initialDelay * Math.pow(2, retries);
      console.log(`Waiting ${delay}ms before next retry...`);
      
      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, delay));
      retries++;
    }
  }
  
  // This should never be reached due to the throw in the loop,
  // but TypeScript needs it for type safety
  throw lastError || new Error('Unexpected error in retry logic');
};

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  roles: [],
  loading: true,
  signIn: async (email: string, password: string) => {
    try {
      // Don't sign out first - this was causing extra network requests
      // Just sign in directly
      const { data: authData, error: authError } = await withRetry(
        () => supabase.auth.signInWithPassword({
          email,
          password,
        }),
        MAX_RETRIES,
        INITIAL_RETRY_DELAY,
        AUTH_REQUEST_TIMEOUT,
        'Sign in request timed out'
      );
      
      if (authError) throw authError;
      if (!authData.user) throw new Error('No user returned from auth');
      if (!authData.session) throw new Error('No session returned from auth');
      
      // Set user immediately
      set({ user: authData.user });
      
      // Fetch user roles with timeout
      try {
        const { data: rolesData, error: rolesError } = await withRetry(
          () => supabase.rpc('get_user_roles'),
          MAX_RETRIES,
          INITIAL_RETRY_DELAY,
          AUTH_REQUEST_TIMEOUT,
          'Fetching roles timed out'
        );
        
        if (rolesError) {
          console.error('Error fetching roles on auth change:', rolesError);
          // Continue with empty roles rather than throwing
          set({ roles: [], loading: false });
        } else {
          // Handle case where roles is null or undefined
          const userRoles = rolesData?.[0]?.roles || [];
          console.log('User roles from auth change:', userRoles);
          set({ roles: userRoles, loading: false });
        }
      } catch (rolesError) {
        console.error('Timeout fetching roles:', rolesError);
        // Continue with empty roles
        set({ roles: [], loading: false });
      }

      showSuccess('Successfully signed in');
    } catch (error) {
      console.error('Sign in error:', error);
      set({ user: null, roles: [], loading: false });
      throw error;
    }
  },
  signUp: async (email: string, password: string, isAdmin = false) => {
    try {
      // Validate email format
      if (!isValidEmail(email)) {
        throw new Error('Invalid email format');
      }
      
      const { data, error: signUpError } = await withRetry(
        () => supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              is_admin: isAdmin,
              email_confirmed: true // Auto-confirm for testing
            },
          },
        }),
        MAX_RETRIES,
        INITIAL_RETRY_DELAY,
        AUTH_REQUEST_TIMEOUT,
        'Sign up request timed out'
      );
      
      if (signUpError) {
        console.error('Signup error:', signUpError);
        throw signUpError;
      }

      if (!data.user) {
        throw new Error('No user returned from signup');
      }

      // Wait a moment for the auth user to be created
      await new Promise(resolve => setTimeout(resolve, 1000));

      // If registering as admin, assign admin role using RPC
      if (isAdmin) {
        try {
          // Only try one RPC function to reduce potential timeouts
          const { error } = await withRetry(
            () => supabase.rpc('assign_admin_role', {
              user_email: email
            }),
            MAX_RETRIES,
            INITIAL_RETRY_DELAY,
            AUTH_REQUEST_TIMEOUT,
            'Admin role assignment timed out'
          );
          
          if (error) {
            console.error('Error using assign_admin_role:', error);
            // Don't throw, just log the error
          } else {
            console.log('Admin role assigned successfully via assign_admin_role');
          }
        } catch (error) {
          console.error('Error in admin role assignment:', error);
          // Don't throw, just log the error
        }
      }

      showSuccess('Account created successfully! Please check your email to confirm your account.');
    } catch (error) {
      console.error('Sign up error:', error);
      // Ensure the error message is user-friendly
      const errorMessage = error instanceof Error 
        ? error.message
        : 'An unexpected error occurred during signup';
      showError(errorMessage);
      throw error;
    }
  },
  signOut: async () => {
    try {
      // First clear the auth state
      set({ 
        user: null, 
        roles: [],
        loading: false 
      });

      // Clear any stored data in localStorage
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear Supabase session with timeout
      try {
        await withRetry(
          () => supabase.auth.signOut(),
          MAX_RETRIES,
          INITIAL_RETRY_DELAY,
          AUTH_REQUEST_TIMEOUT,
          'Sign out request timed out'
        );
      } catch (error) {
        console.error('Error signing out from Supabase:', error);
        // Continue even if there's an error
      }

      // Clear any query cache if using React Query
      if (window.__REACT_QUERY_GLOBAL_CACHE__) {
        window.__REACT_QUERY_GLOBAL_CACHE__.clear();
      }

      showSuccess('Successfully signed out');

      // Force redirect to login page with a slight delay to ensure everything is cleared
      setTimeout(() => {
        window.location.href = '/login';
      }, 100);
    } catch (error) {
      console.error('Error signing out:', error);
      showError('Error signing out');
      // Even if there's an error, try to force a reload to login page
      setTimeout(() => {
        window.location.href = '/login';
      }, 100);
      throw error;
    }
  },
  setUser: (user) => set({ user, loading: false }),
  setRoles: (roles) => set({ roles }),
  hasRole: (role) => {
    const roles = get().roles;
    return roles.includes(role) || roles.includes('admin'); // Admins have access to everything
  },
  refreshSession: async () => {
    try {
      console.log('Starting session refresh...');
      
      // Add timeout and retry to getSession call
      const { data: { session }, error: sessionError } = await withRetry(
        () => supabase.auth.getSession(),
        MAX_RETRIES,
        INITIAL_RETRY_DELAY,
        AUTH_REQUEST_TIMEOUT,
        'Session refresh timed out'
      );
      
      if (sessionError) {
        console.error('Session refresh error:', sessionError);
        set({ loading: false });
        return;
      }
      
      if (session?.user) {
        console.log('Session found for user:', session.user.email);
        set({ user: session.user });
        
        // Fetch user roles with timeout and retry
        try {
          const { data: rolesData, error: rolesError } = await withRetry(
            () => supabase.rpc('get_user_roles'),
            MAX_RETRIES,
            INITIAL_RETRY_DELAY,
            AUTH_REQUEST_TIMEOUT,
            'Fetching roles timed out'
          );
          
          if (rolesError) {
            console.error('Error fetching roles during refresh:', rolesError);
            // Continue with current roles rather than throwing
            set({ loading: false });
            return;
          }
          
          const roles = rolesData?.[0]?.roles || [];
          console.log('Roles fetched during refresh:', roles);
          
          // Only try to assign admin role if explicitly needed
          // This reduces unnecessary API calls
          if (roles.length === 0 && get().roles.length === 0) {
            console.warn('No roles found during refresh for user:', session.user.email);
            
            // Try to assign admin role if no roles found - only use one method
            try {
              const { error: adminError } = await withRetry(
                () => supabase.rpc('assign_admin_role', {
                  user_email: session.user.email
                }),
                MAX_RETRIES,
                INITIAL_RETRY_DELAY,
                AUTH_REQUEST_TIMEOUT,
                'Admin role assignment timed out'
              );
              
              if (adminError) {
                console.error('Error using assign_admin_role:', adminError);
                set({ roles, loading: false });
              } else {
                console.log('Admin role assigned successfully using assign_admin_role');
                
                // Fetch roles again after assignment
                try {
                  const { data: updatedRolesData, error: updatedRolesError } = await withRetry(
                    () => supabase.rpc('get_user_roles'),
                    MAX_RETRIES,
                    INITIAL_RETRY_DELAY,
                    AUTH_REQUEST_TIMEOUT,
                    'Fetching updated roles timed out'
                  );
                  
                  if (!updatedRolesError && updatedRolesData?.[0]?.roles) {
                    console.log('Updated roles after assignment:', updatedRolesData[0].roles);
                    set({ roles: updatedRolesData[0].roles, loading: false });
                  } else {
                    set({ roles, loading: false });
                  }
                } catch (error) {
                  console.error('Error fetching updated roles:', error);
                  set({ roles, loading: false });
                }
              }
            } catch (assignError) {
              console.error('Error in admin role assignment during refresh:', assignError);
              set({ roles, loading: false });
            }
          } else {
            set({ roles, loading: false });
          }
        } catch (rolesError) {
          console.error('Timeout fetching roles:', rolesError);
          set({ loading: false });
        }
      } else {
        console.log('No active session found during refresh');
        set({ user: null, roles: [], loading: false });
      }
    } catch (error) {
      console.error('Error refreshing session:', error);
      set({ loading: false });
      throw error;
    }
  }
}));