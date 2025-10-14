-- RLS hardening and function search_path fixes

-- 1) Tighten ai_cache
ALTER TABLE IF EXISTS public.ai_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_cache_insert_policy ON public.ai_cache;
DROP POLICY IF EXISTS ai_cache_update_policy ON public.ai_cache;
DROP POLICY IF EXISTS ai_cache_select_policy ON public.ai_cache;
CREATE POLICY ai_cache_admin_manage ON public.ai_cache FOR ALL TO authenticated USING (app.is_admin()) WITH CHECK (app.is_admin());

-- 2) Restrict company_settings writes to admins
DROP POLICY IF EXISTS "Allow authenticated users to insert company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Allow authenticated users to update company settings" ON public.company_settings;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_settings' AND policyname='company_settings_admin'
  ) THEN
    CREATE POLICY company_settings_admin ON public.company_settings FOR ALL TO authenticated USING (app.is_admin()) WITH CHECK (app.is_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_settings' AND policyname='company_settings_read'
  ) THEN
    CREATE POLICY company_settings_read ON public.company_settings FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- 3) Split roles policy by command
DROP POLICY IF EXISTS roles_access_policy ON public.roles;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='roles' AND policyname='roles_select_all'
  ) THEN
    CREATE POLICY roles_select_all ON public.roles FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='roles' AND policyname='roles_admin_write'
  ) THEN
    CREATE POLICY roles_admin_write ON public.roles FOR ALL TO public USING (app.is_admin()) WITH CHECK (app.is_admin());
  END IF;
END $$;

-- 4) Tighten storage.objects by dropping broad authenticated policies (keep path-scoped policies defined elsewhere)
DROP POLICY IF EXISTS "Allow authenticated users to upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update client documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to download client documents" ON storage.objects;

-- 5) Restrict ai_processing_logs INSERT
DROP POLICY IF EXISTS "System can create AI processing logs" ON public.ai_processing_logs;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_processing_logs' AND policyname='ai_proc_logs_authenticated_insert'
  ) THEN
    CREATE POLICY ai_proc_logs_authenticated_insert ON public.ai_processing_logs FOR INSERT TO authenticated WITH CHECK (
      session_id IN (SELECT s.id FROM public.sessions s WHERE s.therapist_id = auth.uid())
    );
  END IF;
END $$;

-- 6) Optional: add organization scoping examples (commented out to avoid breaking tenants without orgs)
-- DROP POLICY IF EXISTS "Allow authenticated users to insert locations" ON public.locations;
-- DROP POLICY IF EXISTS "Allow authenticated users to update locations" ON public.locations;
-- CREATE POLICY locations_admin_write ON public.locations FOR ALL TO authenticated USING (app.is_admin()) WITH CHECK (app.is_admin());
-- Or multi-tenant:
-- CREATE POLICY locations_org_write ON public.locations FOR ALL TO authenticated USING (
--   app.is_admin() OR organization_id = app.current_user_organization_id()
--) WITH CHECK (
--   app.is_admin() OR organization_id = app.current_user_organization_id()
--);

-- 7) Clamp search_path for flagged SECURITY DEFINER functions
DO $$ BEGIN
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='app_auth' AND p.proname='get_user_roles';
  EXECUTE 'ALTER FUNCTION app_auth.get_user_roles() SECURITY DEFINER SET search_path = public, app, app_auth, pg_temp';
EXCEPTION WHEN undefined_function THEN
  -- function may take args; adjust manually later
  NULL;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='app_auth' AND p.proname='user_has_role';
  EXECUTE 'ALTER FUNCTION app_auth.user_has_role(role_name text) SECURITY DEFINER SET search_path = public, app, app_auth, pg_temp';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='app_auth' AND p.proname='is_admin';
  EXECUTE 'ALTER FUNCTION app_auth.is_admin() SECURITY DEFINER SET search_path = public, app, app_auth, pg_temp';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='_is_admin';
  EXECUTE 'ALTER FUNCTION public._is_admin(uid uuid) SECURITY INVOKER SET search_path = public, app, app_auth, pg_temp';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='_is_therapist';
  EXECUTE 'ALTER FUNCTION public._is_therapist(uid uuid) SECURITY INVOKER SET search_path = public, app, app_auth, pg_temp';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_organization_id_from_metadata';
  -- immutable but clamp anyway
  EXECUTE 'ALTER FUNCTION public.get_organization_id_from_metadata(p_metadata jsonb) SECURITY INVOKER SET search_path = public, pg_temp';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='set_updated_at';
  EXECUTE 'ALTER FUNCTION public.set_updated_at() SECURITY INVOKER SET search_path = public, pg_temp';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

-- 8) (Optional) Move btree_gist out of public if supported
-- ALTER EXTENSION btree_gist SET SCHEMA extensions;


