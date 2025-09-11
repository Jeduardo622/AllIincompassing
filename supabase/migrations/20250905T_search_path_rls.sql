-- Transactional migration: search_path hardening and RLS consolidation
-- This migration:
-- 1) Sets immutable search_path on key security-sensitive functions
-- 2) Consolidates permissive RLS on public.ai_performance_metrics into minimal policies

BEGIN;

-- 1) Immutable search_path on functions
ALTER FUNCTION public.sync_user_profile() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- 2) RLS consolidation on ai_performance_metrics
-- Ensure RLS is enabled
ALTER TABLE public.ai_performance_metrics ENABLE ROW LEVEL SECURITY;

-- Create consolidated policies (v2). These cover both regular users and admins in a single policy per action.
-- Select policy: allow owner or admin/super_admin via profiles.role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname='public' AND cls.relname='ai_performance_metrics' AND pol.polname='ai_performance_metrics_select_v2'
  ) THEN
    CREATE POLICY ai_performance_metrics_select_v2
      ON public.ai_performance_metrics
      FOR SELECT
      USING (
        user_id = (select auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = (select auth.uid())
            AND p.role = ANY (ARRAY['admin'::role_type, 'super_admin'::role_type])
        )
      );
  END IF;
END$$;

-- Insert policy: allow self-owned rows or admins
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname='public' AND cls.relname='ai_performance_metrics' AND pol.polname='ai_performance_metrics_insert_v2'
  ) THEN
    CREATE POLICY ai_performance_metrics_insert_v2
      ON public.ai_performance_metrics
      FOR INSERT
      WITH CHECK (
        (user_id IS NULL) OR (user_id = (select auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = (select auth.uid())
            AND p.role = ANY (ARRAY['admin'::role_type, 'super_admin'::role_type])
        )
      );
  END IF;
END$$;

-- After v2 policies exist, drop overlapping legacy policies (kept permissive coverage until here)
DO $$
DECLARE
  has_select_v2 boolean;
  has_insert_v2 boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname='public' AND cls.relname='ai_performance_metrics' AND pol.polname='ai_performance_metrics_select_v2'
  ) INTO has_select_v2;

  SELECT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname='public' AND cls.relname='ai_performance_metrics' AND pol.polname='ai_performance_metrics_insert_v2'
  ) INTO has_insert_v2;

  IF NOT (has_select_v2 AND has_insert_v2) THEN
    RAISE EXCEPTION 'v2 policies must exist before dropping legacy policies';
  END IF;

  -- Drop legacy/overlapping policies if present
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname='ai_performance_admin_only_optimized') THEN
    DROP POLICY ai_performance_admin_only_optimized ON public.ai_performance_metrics;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname='ai_performance_metrics_select_policy') THEN
    DROP POLICY ai_performance_metrics_select_policy ON public.ai_performance_metrics;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname='ai_performance_metrics_insert_policy') THEN
    DROP POLICY ai_performance_metrics_insert_policy ON public.ai_performance_metrics;
  END IF;
END$$;

COMMIT;


