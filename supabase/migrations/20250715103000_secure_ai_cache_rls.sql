/*
  # Harden AI cache and performance log access

  ## Security
  - Enable row level security for ai_response_cache and function_performance_logs
  - Restrict table access to admins (including super_admins) and the service role
*/

-- Ensure row level security is enforced on ai_response_cache
ALTER TABLE IF EXISTS public.ai_response_cache ENABLE ROW LEVEL SECURITY;

-- Replace any prior policies with admin/service-role specific ones
DROP POLICY IF EXISTS ai_response_cache_admin_manage ON public.ai_response_cache;
DROP POLICY IF EXISTS "Admins manage ai response cache" ON public.ai_response_cache;
DROP POLICY IF EXISTS ai_response_cache_admin_select ON public.ai_response_cache;
DROP POLICY IF EXISTS ai_response_cache_service_role_manage ON public.ai_response_cache;
DROP POLICY IF EXISTS "Service role manages ai response cache" ON public.ai_response_cache;

CREATE POLICY ai_response_cache_admin_manage
  ON public.ai_response_cache
  FOR ALL
  TO authenticated
  USING (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  )
  WITH CHECK (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  );

CREATE POLICY ai_response_cache_service_role_manage
  ON public.ai_response_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Ensure row level security is enforced on function_performance_logs
ALTER TABLE IF EXISTS public.function_performance_logs ENABLE ROW LEVEL SECURITY;

-- Replace existing telemetry policies with admin/service-role only access
DROP POLICY IF EXISTS function_performance_logs_admin_manage ON public.function_performance_logs;
DROP POLICY IF EXISTS "function_performance_logs_admin_manage" ON public.function_performance_logs;
DROP POLICY IF EXISTS function_performance_logs_admin_read ON public.function_performance_logs;
DROP POLICY IF EXISTS function_performance_logs_service_role_manage ON public.function_performance_logs;

CREATE POLICY function_performance_logs_admin_manage
  ON public.function_performance_logs
  FOR ALL
  TO authenticated
  USING (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  )
  WITH CHECK (
    auth.user_has_role('admin')
    OR auth.user_has_role('super_admin')
  );

CREATE POLICY function_performance_logs_service_role_manage
  ON public.function_performance_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
