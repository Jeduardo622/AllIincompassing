import { supabase } from './supabase'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@supabase/supabase-js'

// Types for the new auth system
export interface UserProfile {
  id: string
  email: string
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

export interface UserRole {
  id: string
  name: string
  description?: string
  permissions: string[]
  is_system_role: boolean
}

export interface AuthState {
  user: User | null
  profile: UserProfile | null
  roles: string[]
  permissions: string[]
  loading: boolean
  initialized: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, metadata?: Record<string, unknown>) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: Error | null }>
  hasRole: (role: string) => boolean
  hasAnyRole: (roles: string[]) => boolean
  hasPermission: (permission: string) => boolean
  refreshUserData: () => Promise<void>
  initialize: () => Promise<void>
}

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

                   signIn: async (email: string, password: string) => {
        set({ loading: true })
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          })

          if (error) {
            set({ loading: false })
            return { error }
          }

          // Validate authentication state after sign in
          const validation = await validateAuth()
          if (!validation.isValid) {
            set({ loading: false })
            return { error: new Error(validation.error || 'Authentication validation failed') }
          }

          // Refresh user data after successful sign in
          await get().refreshUserData()
          set({ loading: false })
          return { error: null }
        } catch (error) {
          set({ loading: false })
          return { error: error instanceof Error ? error : new Error('Sign in failed') }
        }
      },

      signUp: async (email: string, password: string, metadata = {}) => {
        set({ loading: true })
        try {
          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: metadata,
            },
          })

          if (error) {
            set({ loading: false })
            return { error }
          }

          set({ loading: false })
          return { error: null }
        } catch (error) {
          set({ loading: false })
          return { error: error instanceof Error ? error : new Error('Sign up failed') }
        }
      },

      signOut: async () => {
        set({ loading: true })
        try {
          await supabase.auth.signOut()
          set({
            user: null,
            profile: null,
            roles: [],
            permissions: [],
            loading: false,
          })
        } catch (error) {
          console.error('Sign out error:', error)
          set({ loading: false })
        }
      },

      updateProfile: async (updates: Partial<UserProfile>) => {
        const { user } = get()
        if (!user) return { error: new Error('Not authenticated') }

        try {
          const { data, error } = await supabase
            .from('user_profiles')
            .update(updates)
            .eq('id', user.id)
            .select()
            .single()

          if (error) return { error }

          set({ profile: data })
          return { error: null }
        } catch (error) {
          return { error: error instanceof Error ? error : new Error('Update profile failed') }
        }
      },

      hasRole: (role: string) => {
        const { roles } = get()
        return roles.includes(role)
      },

      hasAnyRole: (roles: string[]) => {
        const { roles: userRoles } = get()
        return roles.some(role => userRoles.includes(role))
      },

      hasPermission: (permission: string) => {
        const { permissions } = get()
        return permissions.includes('*') || permissions.includes(permission)
      },

      refreshUserData: async () => {
        const { data: { user } } = await supabase.auth.getUser()
        
        if (!user) {
          set({
            user: null,
            profile: null,
            roles: [],
            permissions: [],
          })
          return
        }

        try {
          // Get user profile
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', user.id)
            .single()

          if (profileError) {
            console.error('Profile fetch error:', profileError)
            // If profile doesn't exist, create it
            if (profileError.code === 'PGRST116') {
              const { data: newProfile, error: createError } = await supabase
                .from('user_profiles')
                .insert({
                  id: user.id,
                  email: user.email,
                  first_name: user.user_metadata?.first_name || '',
                  last_name: user.user_metadata?.last_name || '',
                  is_active: true,
                })
                .select()
                .single()

              if (createError) {
                console.error('Profile creation error:', createError)
                return
              }
              
              // Use the newly created profile
              set({
                user,
                profile: newProfile,
                roles: [],
                permissions: [],
              })
            }
            return
          }

          // Get user roles and permissions using the new comprehensive function
          const { data: userRolesData, error: rolesError } = await supabase
            .rpc('get_user_roles_comprehensive', { user_uuid: user.id })

          if (rolesError) {
            console.error('Roles fetch error:', rolesError)
            // Continue with just the profile, no roles
            set({
              user,
              profile,
              roles: [],
              permissions: [],
            })
            return
          }

          // Extract role names and permissions
          const roles = userRolesData?.map((ur: { role_name: string; permissions: string[] }) => ur.role_name) || []
          const allPermissions = userRolesData?.flatMap((ur: { role_name: string; permissions: string[] }) => ur.permissions) || []
          const uniquePermissions = [...new Set(allPermissions)] as string[]

          set({
            user,
            profile,
            roles,
            permissions: uniquePermissions,
          })
        } catch (error) {
          console.error('Error refreshing user data:', error)
          // Set user but with minimal data
          set({
            user,
            profile: null,
            roles: [],
            permissions: [],
          })
        }
      },

      initialize: async () => {
        if (get().initialized) return

        set({ loading: true })
        
        // Get initial session
        const { data: { session } } = await supabase.auth.getSession()
        
        if (session?.user) {
          await get().refreshUserData()
        }

        // Listen for auth changes
       const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session?.user) {
            await get().refreshUserData()
          } else if (event === 'SIGNED_OUT') {
            set({
              user: null,
              profile: null,
              roles: [],
              permissions: [],
            })
          }
        })

        set({ loading: false, initialized: true })
       
       // Clean up subscription to prevent memory leaks
       return () => {
         subscription.unsubscribe();
       };
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        profile: state.profile,
        roles: state.roles,
        permissions: state.permissions,
      }),
    }
  )
)

// Helper functions for role checking
export const isAdmin = () => useAuth.getState().hasRole('admin')
export const isTherapist = () => useAuth.getState().hasRole('therapist')
export const isSupervisor = () => useAuth.getState().hasRole('supervisor')
export const isStaff = () => useAuth.getState().hasRole('staff')

// Permission helpers
export const canViewClients = () => useAuth.getState().hasPermission('view_clients')
export const canManageSessions = () => useAuth.getState().hasPermission('manage_sessions')
export const canViewSchedule = () => useAuth.getState().hasPermission('view_schedule')
export const canSuperviseTherapists = () => useAuth.getState().hasPermission('supervise_therapists')

// Initialize auth on app start
export const initializeAuth = async () => {
  await useAuth.getState().initialize()
}

// Helper function to validate authentication state
export const validateAuth = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { isValid: false, error: 'No user found' }

    // Check if user profile exists
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, email, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return { isValid: false, error: 'User profile not found' }
    }

    if (!profile.is_active) {
      return { isValid: false, error: 'User account is inactive' }
    }

    // Check if user has any roles
    const { data: roles, error: rolesError } = await supabase
      .rpc('get_user_roles', { user_uuid: user.id })

    if (rolesError) {
      return { isValid: false, error: 'Unable to fetch user roles' }
    }

    return { 
      isValid: true, 
      user, 
      profile, 
      roles: roles || [],
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