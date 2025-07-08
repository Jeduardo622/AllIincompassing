/*
  # Fix user_profiles RLS policies with correct JSON syntax
  
  1. Changes
     - Drops problematic policies causing infinite recursion
     - Recreates policies with proper JSON syntax (no escaping needed in single quotes)
     - Maintains same access control logic with non-recursive structure
     - Only applies if user_profiles table exists
     
  2. Security
     - Users can view and update their own profiles
     - Admins maintain full access to all profiles
*/

-- Only proceed if user_profiles table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'user_profiles'
  ) THEN
    -- Drop the problematic policy causing infinite recursion
    DROP POLICY IF EXISTS "user_profiles_unified_access" ON public.user_profiles;

    -- Create separate, non-recursive policies for each operation
    -- Allow users to view their own profile
    CREATE POLICY "users_can_view_own_profile" 
    ON public.user_profiles 
    FOR SELECT 
    TO public
    USING (id = auth.uid());

    -- Allow users to update their own profile
    CREATE POLICY "users_can_update_own_profile" 
    ON public.user_profiles 
    FOR UPDATE 
    TO public
    USING (id = auth.uid());

    -- Allow users with admin role to view any profile
    CREATE POLICY "admins_can_view_all_profiles" 
    ON public.user_profiles 
    FOR SELECT 
    TO public
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND ur.is_active = true
        AND r.permissions @> '["*"]'::jsonb
      )
    );

    -- Allow users with admin role to update any profile
    CREATE POLICY "admins_can_update_all_profiles" 
    ON public.user_profiles 
    FOR UPDATE 
    TO public
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND ur.is_active = true
        AND r.permissions @> '["*"]'::jsonb
      )
    );

    -- Allow users with admin role to insert profiles
    CREATE POLICY "admins_can_insert_profiles" 
    ON public.user_profiles 
    FOR INSERT 
    TO public
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND ur.is_active = true
        AND r.permissions @> '["*"]'::jsonb
      )
    );

    -- Allow users with admin role to delete profiles
    CREATE POLICY "admins_can_delete_profiles" 
    ON public.user_profiles 
    FOR DELETE 
    TO public
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND ur.is_active = true
        AND r.permissions @> '["*"]'::jsonb
      )
    );

    RAISE NOTICE 'User profiles RLS policies updated successfully';
  ELSE
    RAISE NOTICE 'user_profiles table does not exist, skipping RLS policy creation';
  END IF;
END $$;