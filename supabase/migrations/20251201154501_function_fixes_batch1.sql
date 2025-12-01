/*
  # Function fixes batch 1

  - Rebuilds therapist metrics helpers.
  - Ensures admin/therapist role helpers use public schema explicitly.
  - Fixes cache helper to reference ai_response_cache correctly.
*/

DROP FUNCTION IF EXISTS public.get_therapist_metrics(text,text);
DROP FUNCTION IF EXISTS public.get_therapist_metrics(date,date);
DROP FUNCTION IF EXISTS public.assign_therapist_role(uuid);
DROP FUNCTION IF EXISTS public.assign_therapist_role(text,uuid);
DROP FUNCTION IF EXISTS public.cache_ai_response(text,text,text,jsonb,timestamptz);

CREATE OR REPLACE FUNCTION public.get_therapist_metrics(p_start_date date, p_end_date date)
RETURNS TABLE(
  total_therapists bigint,
  active_therapists bigint,
  inactive_therapists bigint,
  specialties jsonb,
  service_types jsonb,
  sessions_per_therapist jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_specialties jsonb;
  v_service_types jsonb;
BEGIN
  WITH specs AS (
    SELECT unnest(COALESCE(t.specialties, ARRAY[]::text[])) AS specialty
    FROM public.therapists t
  )
  SELECT COALESCE(jsonb_object_agg(s.specialty, s.cnt), '{}'::jsonb)
  INTO v_specialties
  FROM (
    SELECT specialty, COUNT(*) AS cnt
    FROM specs
    GROUP BY specialty
  ) s;

  WITH types AS (
    SELECT unnest(COALESCE(t.service_type, ARRAY[]::text[])) AS svc
    FROM public.therapists t
  )
  SELECT COALESCE(jsonb_object_agg(t.svc, t.cnt), '{}'::jsonb)
  INTO v_service_types
  FROM (
    SELECT svc, COUNT(*) AS cnt
    FROM types
    GROUP BY svc
  ) t;

  RETURN QUERY
  WITH active AS (
    SELECT DISTINCT s.therapist_id
    FROM public.sessions s
    WHERE s.start_time >= p_start_date
      AND s.start_time <= (p_end_date + interval '1 day')
  ), totals AS (
    SELECT COUNT(*) AS total FROM public.therapists
  )
  SELECT
    totals.total,
    (SELECT COUNT(*) FROM active),
    totals.total - (SELECT COUNT(*) FROM active),
    v_specialties,
    v_service_types,
    (
      SELECT COALESCE(jsonb_object_agg(full_name, session_count), '{}'::jsonb)
      FROM (
        SELECT t.full_name, COUNT(s.id) AS session_count
        FROM public.therapists t
        LEFT JOIN public.sessions s ON s.therapist_id = t.id
          AND s.start_time >= p_start_date
          AND s.start_time <= (p_end_date + interval '1 day')
        GROUP BY t.full_name
        ORDER BY session_count DESC
        LIMIT 10
      ) top_sessions
    )
  FROM totals;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_therapist_metrics(p_start_date text, p_end_date text)
RETURNS TABLE(
  total_therapists bigint,
  active_therapists bigint,
  inactive_therapists bigint,
  specialties jsonb,
  service_types jsonb,
  sessions_per_therapist jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
    SELECT *
    FROM public.get_therapist_metrics(p_start_date::date, p_end_date::date);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_admin_role(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  admin_role_id uuid;
  target_user_id uuid;
BEGIN
  SELECT id INTO admin_role_id FROM public.roles WHERE name = 'admin';
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Admin role not configured';
  END IF;

  SELECT id INTO target_user_id FROM auth.users WHERE email = user_email;
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (target_user_id, admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_therapist_role(p_therapist_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  therapist_role_id uuid;
BEGIN
  SELECT id INTO therapist_role_id FROM public.roles WHERE name = 'therapist';
  IF therapist_role_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (p_therapist_id, therapist_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_therapist_role(p_email text, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assign_therapist_role(p_user_id);
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

