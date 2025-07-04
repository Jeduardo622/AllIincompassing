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
  preferences?: Record<string, any>
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
          const { data, error } = await supabase.auth.signUp({
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
          return { error }
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
          return { error }
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
            return
          }

          // Get user roles and permissions
          const { data: userRoles, error: rolesError } = await supabase
            .from('user_roles')
            .select(`
              roles (
                name,
                permissions
              )
            `)
            .eq('user_id', user.id)
            .eq('is_active', true)

          if (rolesError) {
            console.error('Roles fetch error:', rolesError)
            return
          }

                     // Extract role names and permissions
           const roles = userRoles?.map((ur: any) => ur.roles.name) || []
           const allPermissions = userRoles?.flatMap((ur: any) => ur.roles.permissions) || []
           const uniquePermissions = [...new Set(allPermissions)]

          set({
            user,
            profile,
            roles,
            permissions: uniquePermissions,
          })
        } catch (error) {
          console.error('Error refreshing user data:', error)
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
        supabase.auth.onAuthStateChange(async (event, session) => {
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