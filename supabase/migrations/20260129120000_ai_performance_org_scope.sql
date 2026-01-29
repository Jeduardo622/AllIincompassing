/*
  # Add organization scoping to AI performance metrics

  1. Changes
    - Add organization_id to ai_performance_metrics
    - Default organization_id from app.current_user_organization_id()
    - Update RLS policies for org-wide access
    - Add organization index for query performance
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ai_performance_metrics'
  ) THEN
    ALTER TABLE public.ai_performance_metrics
      ADD COLUMN IF NOT EXISTS organization_id uuid;

    ALTER TABLE public.ai_performance_metrics
      ALTER COLUMN organization_id SET DEFAULT app.current_user_organization_id();

    CREATE INDEX IF NOT EXISTS ai_performance_metrics_organization_id_idx
      ON public.ai_performance_metrics (organization_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND cls.relname = 'ai_performance_metrics'
      AND pol.polname = 'ai_performance_metrics_select_v2'
  ) THEN
    ALTER POLICY ai_performance_metrics_select_v2
      ON public.ai_performance_metrics
      USING (
        app.is_admin()
        OR organization_id = app.current_user_organization_id()
        OR user_id = (select auth.uid())
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND cls.relname = 'ai_performance_metrics'
      AND pol.polname = 'ai_performance_metrics_insert_v2'
  ) THEN
    ALTER POLICY ai_performance_metrics_insert_v2
      ON public.ai_performance_metrics
      WITH CHECK (
        app.is_admin()
        OR (
          (organization_id IS NULL OR organization_id = app.current_user_organization_id())
          AND (user_id IS NULL OR user_id = (select auth.uid()))
        )
      );
  END IF;
END $$;
