/*
  # Tighten user_profiles RLS policies

  1. Changes
     - Ensures row level security is enabled on user_profiles
     - Recreates policies to require authenticated access and align WITH CHECK logic with profiles

  2. Security
     - Blocks anonymous access to user profile data
     - Enforces that only profile owners or admins may modify user_profiles rows
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
  ) THEN
    -- Guarantee row level security is enabled before managing policies
    EXECUTE 'ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY';

    -- Replace existing policies with authenticated-only access rules
    DROP POLICY IF EXISTS "users_can_view_own_profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "users_can_update_own_profile" ON public.user_profiles;
    DROP POLICY IF EXISTS "admins_can_view_all_profiles" ON public.user_profiles;
    DROP POLICY IF EXISTS "admins_can_update_all_profiles" ON public.user_profiles;
    DROP POLICY IF EXISTS "admins_can_insert_profiles" ON public.user_profiles;
    DROP POLICY IF EXISTS "admins_can_delete_profiles" ON public.user_profiles;

    CREATE POLICY "users_can_view_own_profile"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

    CREATE POLICY "users_can_update_own_profile"
    ON public.user_profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

    CREATE POLICY "admins_can_view_all_profiles"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
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

    CREATE POLICY "admins_can_update_all_profiles"
    ON public.user_profiles
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid()
          AND ur.is_active = true
          AND r.permissions @> '["*"]'::jsonb
      )
    )
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

    CREATE POLICY "admins_can_insert_profiles"
    ON public.user_profiles
    FOR INSERT
    TO authenticated
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

    CREATE POLICY "admins_can_delete_profiles"
    ON public.user_profiles
    FOR DELETE
    TO authenticated
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

    RAISE NOTICE 'user_profiles policies updated to authenticated access';
  ELSE
    RAISE NOTICE 'user_profiles table not found; skipping RLS updates';
  END IF;
END $$;
