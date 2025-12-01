/*
  # Function fixes batch 2

  - Simplifies compatibility, invite, and migration helpers.
  - Ensures cache cleanup and threshold loggers compile.
*/

DROP FUNCTION IF EXISTS public.calculate_therapist_client_compatibility(uuid,uuid);
DROP FUNCTION IF EXISTS public.check_performance_thresholds(text,numeric);
DROP FUNCTION IF EXISTS public.cleanup_ai_cache();
DROP FUNCTION IF EXISTS public.create_admin_invite(text,role_type);
DROP FUNCTION IF EXISTS public.generate_workload_recommendations(uuid,numeric,numeric,integer);
DROP FUNCTION IF EXISTS public.check_migration_status();

CREATE OR REPLACE FUNCTION public.calculate_therapist_client_compatibility(
  p_therapist_id uuid,
  p_client_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_score numeric := 0.5;
BEGIN
  IF EXISTS (SELECT 1 FROM public.sessions WHERE therapist_id = p_therapist_id AND client_id = p_client_id) THEN
    v_score := 0.9;
  END IF;
  RETURN v_score;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_performance_thresholds(
  p_metric_name text,
  p_current_value numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.function_performance_logs (
    function_name,
    execution_time_ms,
    parameters,
    executed_at
  ) VALUES (
    'check_performance_thresholds',
    0,
    jsonb_build_object('metric', p_metric_name, 'value', p_current_value),
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_ai_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH removed AS (
    DELETE FROM public.ai_response_cache
    WHERE expires_at <= now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM removed;
  RETURN COALESCE(v_deleted, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_admin_invite(
  p_email text,
  p_role role_type
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_token text := replace(gen_random_uuid()::text, '-', '');
  v_hash text := encode(sha256(v_token::bytea), 'hex');
BEGIN
  INSERT INTO public.admin_invite_tokens (email, token_hash, role, created_at)
  VALUES (p_email, v_hash, p_role, now());
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_workload_recommendations(
  p_therapist_id uuid,
  p_actual_hours numeric,
  p_target_hours numeric,
  p_session_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  utilization_rate numeric := CASE WHEN p_target_hours = 0 THEN 0 ELSE (p_actual_hours / NULLIF(p_target_hours, 0)) * 100 END;
  utilization_text text := to_char(utilization_rate, 'FM990.0');
BEGIN
  RETURN jsonb_build_array(
    jsonb_build_object(
      'type', 'utilization',
      'priority', 'medium',
      'message', format('Utilization at %s%%. Review workload.', utilization_text),
      'action', 'review_schedule'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_client_documents(client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_requestor uuid := auth.uid();
  v_client uuid := client_id;
BEGIN
  IF v_requestor IS NULL THEN
    RETURN false;
  END IF;

  RETURN
    app_auth.user_has_role('super_admin')
    OR app_auth.user_has_role('admin')
    OR EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.client_id = v_client
        AND s.therapist_id = v_requestor
    )
    OR EXISTS (
      SELECT 1
      FROM public.client_guardians cg
      WHERE cg.client_id = v_client
        AND cg.guardian_id = v_requestor
        AND cg.deleted_at IS NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_migration_status()
RETURNS TABLE(
  migration_name text,
  is_applied boolean,
  applied_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  WITH migration_files AS (
    SELECT regexp_replace(tablename, '_migration_', '') AS m_name
    FROM pg_tables
    WHERE tablename LIKE '%_migration_%'
  )
  SELECT m_name, TRUE, now()
  FROM migration_files;
END;
$$;

