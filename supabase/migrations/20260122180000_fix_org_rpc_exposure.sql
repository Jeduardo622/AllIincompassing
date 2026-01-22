BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION public.current_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_organization_id();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_organization_id() TO authenticated;

CREATE OR REPLACE FUNCTION app.guardian_link_queue_admin_view(
  p_organization_id uuid,
  p_status text DEFAULT 'pending'
)
RETURNS TABLE (
  id uuid,
  guardian_id uuid,
  guardian_email text,
  status text,
  organization_id uuid,
  invite_token text,
  metadata jsonb,
  requested_client_ids uuid[],
  approved_client_ids uuid[],
  created_at timestamptz,
  updated_at timestamptz,
  processed_at timestamptz,
  processed_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid := COALESCE(p_organization_id, app.current_user_organization_id());
  v_status text := COALESCE(p_status, 'pending');
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context is required to review guardian requests';
  END IF;

  IF NOT app.user_has_role_for_org(app.current_user_id(), v_org, ARRAY['org_admin']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Insufficient privileges to review guardian requests for this organization';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.guardian_id,
    q.guardian_email,
    q.status,
    q.organization_id,
    q.invite_token,
    q.metadata,
    q.requested_client_ids,
    q.approved_client_ids,
    q.created_at,
    q.updated_at,
    q.processed_at,
    q.processed_by
  FROM public.guardian_link_queue q
  WHERE q.organization_id = v_org
    AND (v_status = 'any' OR q.status = v_status)
  ORDER BY q.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION app.guardian_link_queue_admin_view(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guardian_link_queue_admin_view(
  p_organization_id uuid,
  p_status text DEFAULT 'pending'
)
RETURNS TABLE (
  id uuid,
  guardian_id uuid,
  guardian_email text,
  status text,
  organization_id uuid,
  invite_token text,
  metadata jsonb,
  requested_client_ids uuid[],
  approved_client_ids uuid[],
  created_at timestamptz,
  updated_at timestamptz,
  processed_at timestamptz,
  processed_by uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT *
  FROM app.guardian_link_queue_admin_view(p_organization_id, p_status);
$$;

GRANT EXECUTE ON FUNCTION public.guardian_link_queue_admin_view(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sessions_optimized(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_therapist_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE (session_data jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context is required';
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
    'updated_at', s.updated_at,
    'updated_by', s.updated_by,
    'therapist_id', s.therapist_id,
    'client_id', s.client_id,
    'duration_minutes', s.duration_minutes,
    'location_type', s.location_type,
    'session_type', s.session_type,
    'rate_per_hour', s.rate_per_hour,
    'total_cost', s.total_cost,
    'therapist', jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type
    ),
    'client', jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference
    )
  ) AS session_data
  FROM public.sessions s
  JOIN public.therapists t
    ON s.therapist_id = t.id
   AND t.organization_id = v_org
  JOIN public.clients c
    ON s.client_id = c.id
   AND c.organization_id = v_org
  WHERE s.organization_id = v_org
    AND s.start_time >= p_start_date
    AND s.start_time <= p_end_date
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
  ORDER BY s.start_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_schedule_data_batch(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_sessions jsonb := '[]'::jsonb;
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context is required';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'notes', s.notes,
      'created_at', s.created_at,
      'created_by', s.created_by,
      'updated_at', s.updated_at,
      'updated_by', s.updated_by,
      'therapist_id', s.therapist_id,
      'client_id', s.client_id,
      'duration_minutes', s.duration_minutes,
      'location_type', s.location_type,
      'session_type', s.session_type,
      'rate_per_hour', s.rate_per_hour,
      'total_cost', s.total_cost,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  )
  INTO v_sessions
  FROM public.sessions s
  JOIN public.therapists t
    ON s.therapist_id = t.id
   AND t.organization_id = v_org
  JOIN public.clients c
    ON s.client_id = c.id
   AND c.organization_id = v_org
  WHERE s.organization_id = v_org
    AND s.start_time >= p_start_date
    AND s.start_time <= p_end_date
  ORDER BY s.start_time;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type
    )
  )
  INTO v_therapists
  FROM public.therapists t
  WHERE t.organization_id = v_org
    AND t.is_active = true
  ORDER BY t.full_name;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference
    )
  )
  INTO v_clients
  FROM public.clients c
  WHERE c.organization_id = v_org
    AND c.is_active = true
  ORDER BY c.full_name;

  RETURN jsonb_build_object(
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb)
  );
END;
$$;

COMMIT;
