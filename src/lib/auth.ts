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

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  roles: [],
  loading: true,
  signIn: async (email: string, password: string) => {
    try {
      // Clear any existing session first
      await supabase.auth.signOut();
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (authError) throw authError;
      if (!authData.user) throw new Error('No user returned from auth');
      if (!authData.session) throw new Error('No session returned from auth');
      
      // Set user immediately
      set({ user: authData.user });
      
      // Fetch user roles
      const { data: rolesData, error: rolesError } = await supabase.rpc('get_user_roles');
      
      if (rolesError) {
        console.error('Error fetching roles on auth change:', rolesError);
        throw rolesError;
      }
      
      // Handle case where roles is null or undefined
      const userRoles = rolesData?.[0]?.roles || [];
      console.log('User roles from auth change:', userRoles);
      
      set({ roles: userRoles, loading: false });

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
      
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            is_admin: isAdmin,
            email_confirmed: true // Auto-confirm for testing
          },
        },
      });
      
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
          const { error } = await supabase.rpc('assign_admin_role', {
            user_email: email
          });
          
          if (error) {
            console.error('Error using assign_admin_role:', error);
            throw new Error('Failed to assign admin role');
          } else {
            console.log('Admin role assigned successfully via assign_admin_role');
          }
        } catch (error) {
          console.error('Error in admin role assignment:', error);
          throw error;
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
      
      // Clear Supabase session
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

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
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      
      if (session?.user) {
        console.log('Session found for user:', session.user.email);
        set({ user: session.user });
        
        // Fetch user roles
        const { data: rolesData, error: rolesError } = await supabase.rpc('get_user_roles');
        if (rolesError) {
          console.error('Error fetching roles during refresh:', rolesError);
          throw rolesError;
        }
        
        const roles = rolesData?.[0]?.roles || [];
        console.log('Roles fetched during refresh:', roles);
        
        if (roles.length === 0) {
          console.warn('No roles found during refresh for user:', session.user.email);
          
          // Try to assign admin role if no roles found
          try {
            console.log('Attempting to assign admin role during refresh...');
            const { error: adminError } = await supabase.rpc('assign_admin_role', {
              user_email: session.user.email
            });
            
            if (adminError) {
              console.error('Error using assign_admin_role:', adminError);
            } else {
              console.log('Admin role assigned successfully using assign_admin_role');
              
              // Fetch roles again after assignment
              const { data: updatedRolesData, error: updatedRolesError } = await supabase.rpc('get_user_roles');
              if (!updatedRolesError && updatedRolesData?.[0]?.roles) {
                console.log('Updated roles after assignment:', updatedRolesData[0].roles);
                set({ roles: updatedRolesData[0].roles, loading: false });
                return;
              }
            }
          } catch (assignError) {
            console.error('Error in admin role assignment during refresh:', assignError);
          }
        }
        
        set({ roles, loading: false });
      } else {
        console.log('No active session found during refresh');
        set({ user: null, roles: [], loading: false });
      }
    } catch (error) {
      console.error('Error refreshing session:', error);
      set({ user: null, roles: [], loading: false });
      throw error;
    }
  }
}));