set search_path = public;

/*
  Tighten user_profiles RLS policies (authenticated + admin via app.user_has_role)
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
      app.user_has_role('admin')
      OR app.user_has_role('super_admin')
    );

    CREATE POLICY "admins_can_update_all_profiles"
    ON public.user_profiles
    FOR UPDATE
    TO authenticated
    USING (
      app.user_has_role('admin')
      OR app.user_has_role('super_admin')
    )
    WITH CHECK (
      app.user_has_role('admin')
      OR app.user_has_role('super_admin')
    );

    CREATE POLICY "admins_can_insert_profiles"
    ON public.user_profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (
      app.user_has_role('admin')
      OR app.user_has_role('super_admin')
    );

    CREATE POLICY "admins_can_delete_profiles"
    ON public.user_profiles
    FOR DELETE
    TO authenticated
    USING (
      app.user_has_role('admin')
      OR app.user_has_role('super_admin')
    );

    RAISE NOTICE 'user_profiles policies updated to authenticated access';
  ELSE
    RAISE NOTICE 'user_profiles table not found; skipping RLS updates';
  END IF;
END $$;
