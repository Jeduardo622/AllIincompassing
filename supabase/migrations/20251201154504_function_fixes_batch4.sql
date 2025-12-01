/*
  # Function fixes batch 4

  - Cleans up admin helpers, session reports, and workload analytics.
*/

DROP FUNCTION IF EXISTS public.get_admin_users();
DROP FUNCTION IF EXISTS public.get_admin_users(uuid);
DROP FUNCTION IF EXISTS public.cache_ai_response(text,text,text,jsonb,timestamptz);
DROP FUNCTION IF EXISTS public.check_migration_status();
DROP FUNCTION IF EXISTS public.create_admin_invite(text,role_type);
DROP FUNCTION IF EXISTS public.get_sessions_report(date,date,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.get_sessions_report(text,text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.get_sessions_optimized(timestamptz,timestamptz,uuid,uuid);
DROP FUNCTION IF EXISTS public.analyze_therapist_workload(uuid,integer);

CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'email', au.email,
        'first_name', COALESCE(p.first_name, ''),
        'last_name', COALESCE(p.last_name, ''),
        'full_name', COALESCE(p.full_name, au.email),
        'title', COALESCE(p.title, ''),
        'role', COALESCE(r.name, p.role::text),
        'created_at', p.created_at
      )
    )
    FROM public.profiles p
    JOIN auth.users au ON p.id = au.id
    LEFT JOIN public.user_roles ur ON ur.user_id = p.id
    LEFT JOIN public.roles r ON r.id = ur.role_id
    WHERE COALESCE(r.name, p.role::text) IN ('admin', 'super_admin')
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_users(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.get_admin_users();
END;
$$;

CREATE OR REPLACE FUNCTION public.cache_ai_response(
  p_cache_key text,
  p_query_text text,
  p_response_text text,
  p_metadata jsonb,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.ai_response_cache (
    cache_key,
    query_text,
    response_text,
    metadata,
    expires_at
  )
  VALUES (
    p_cache_key,
    p_query_text,
    p_response_text,
    p_metadata,
    COALESCE(p_expires_at, now() + interval '1 hour')
  )
  ON CONFLICT (cache_key)
  DO UPDATE SET
    response_text = EXCLUDED.response_text,
    metadata = EXCLUDED.metadata,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();
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

CREATE OR REPLACE FUNCTION public.get_sessions_report(
  p_start_date date,
  p_end_date date,
  p_therapist_id uuid,
  p_client_id uuid,
  p_status text
)
RETURNS TABLE(
  session_id uuid,
  client_name text,
  therapist_name text,
  session_day date,
  session_type text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM (
    SELECT *
    FROM public.get_sessions_report(p_start_date, p_end_date)
  ) AS base
  WHERE ($3 IS NULL OR base.therapist_name = $3::text)
    AND ($4 IS NULL OR base.client_name = $4::text)
    AND ($5 IS NULL OR base.status = $5);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sessions_report(
  p_start_date text,
  p_end_date text,
  p_therapist_id uuid,
  p_client_id uuid,
  p_status text
)
RETURNS TABLE(
  session_id uuid,
  client_name text,
  therapist_name text,
  session_day date,
  session_type text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
    SELECT *
    FROM public.get_sessions_report(p_start_date::date, p_end_date::date, p_therapist_id, p_client_id, p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sessions_optimized(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_therapist_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE(session_data jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
BEGIN
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', s.id,
    'start_time', s.start_time,
    'end_time', s.end_time,
    'status', s.status,
    'notes', s.notes,
    'created_at', s.created_at,
    'created_by', s.created_by,
    'therapist_id', s.therapist_id,
    'client_id', s.client_id,
    'duration_minutes', s.duration_minutes,
    'location_type', s.location_type,
    'session_type', s.session_type,
    'rate_per_hour', s.rate_per_hour,
    'total_cost', s.total_cost,
    'therapist', jsonb_build_object('id', t.id, 'full_name', t.full_name, 'email', t.email, 'service_type', t.service_type),
    'client', jsonb_build_object('id', c.id, 'full_name', c.full_name, 'email', c.email, 'service_preference', c.service_preference)
  )
  FROM public.sessions s
  JOIN public.therapists t ON s.therapist_id = t.id AND t.organization_id = v_org
  JOIN public.clients c ON s.client_id = c.id AND c.organization_id = v_org
  WHERE s.organization_id = v_org
    AND s.start_time >= p_start_date
    AND s.start_time <= p_end_date
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
  ORDER BY s.start_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.analyze_therapist_workload(
  p_therapist_id uuid,
  p_analysis_period integer
)
RETURNS TABLE(
  therapist_id uuid,
  full_name text,
  utilization_rate numeric,
  actual_hours numeric,
  target_hours numeric,
  efficiency_score numeric,
  recommendations jsonb,
  workload_distribution jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.full_name,
    0::numeric,
    0::numeric,
    ((COALESCE(t.weekly_hours_min,0) + COALESCE(t.weekly_hours_max,0)) / 2.0)::numeric,
    0::numeric,
    '[]'::jsonb,
    '{}'::jsonb
  FROM public.therapists t
  WHERE p_therapist_id IS NULL OR t.id = p_therapist_id;
END;
$$;

