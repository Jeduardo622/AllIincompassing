-- @migration-intent: Align auth profile select contract and restore persisted query-performance telemetry with guarded access.
-- @migration-dependencies: 20260311153000_lint_and_edi_rls_hardening.sql
-- @migration-rollback: Drop query_performance_metrics table/policies/indexes and remove profiles.organization_id if rollback is required.
--
-- Align auth/profile contract and restore query performance telemetry persistence.
-- Safe to re-run in staging/production.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_organization_id_idx
  ON public.profiles (organization_id);

CREATE TABLE IF NOT EXISTS public.query_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key text NOT NULL,
  operation text NOT NULL,
  duration_ms numeric NOT NULL,
  data_size_bytes integer,
  cache_hit boolean DEFAULT false,
  error_occurred boolean DEFAULT false,
  error_message text,
  query_complexity text CHECK (query_complexity IN ('low', 'medium', 'high')),
  affected_rows integer,
  session_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS query_performance_metrics_timestamp_idx
  ON public.query_performance_metrics (timestamp DESC);

CREATE INDEX IF NOT EXISTS query_performance_metrics_duration_idx
  ON public.query_performance_metrics (duration_ms DESC)
  WHERE duration_ms > 1000;

CREATE INDEX IF NOT EXISTS query_performance_metrics_session_idx
  ON public.query_performance_metrics (session_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS query_performance_metrics_error_idx
  ON public.query_performance_metrics (error_occurred, timestamp DESC)
  WHERE error_occurred = true;

ALTER TABLE public.query_performance_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS query_performance_metrics_insert_authenticated ON public.query_performance_metrics;
CREATE POLICY query_performance_metrics_insert_authenticated
ON public.query_performance_metrics
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NULL OR user_id = (select auth.uid()));

DROP POLICY IF EXISTS query_performance_metrics_select_admin ON public.query_performance_metrics;
CREATE POLICY query_performance_metrics_select_admin
ON public.query_performance_metrics
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (select auth.uid())
      AND p.role IN ('admin', 'super_admin')
  )
);
