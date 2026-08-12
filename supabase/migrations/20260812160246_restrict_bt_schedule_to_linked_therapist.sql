-- @migration-intent: Restrict BT and legacy therapist scheduling RPC rows to the caller's linked therapist identity while preserving assigned-client clinical session reads.
-- @migration-dependencies: 20260810171520_restrict_bt_schedule_to_assigned_clients.sql, 20260810190000_enforce_sessions_schedule_read_scope.sql.
-- @migration-rollback: Restore get_sessions_optimized and get_schedule_data_batch from 20260810171520_restrict_bt_schedule_to_assigned_clients.sql; then DROP FUNCTION app.current_user_can_read_schedule_session(uuid, uuid, uuid).

BEGIN;

CREATE OR REPLACE FUNCTION app.current_user_can_read_schedule_session(
  target_organization_id uuid,
  target_client_id uuid,
  target_therapist_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT
    app.current_user_can_read_full_schedule(target_organization_id)
    OR (
      app.current_user_has_exact_role_for_org(
        target_organization_id,
        ARRAY['bt', 'therapist']::text[]
      )
      AND app.current_user_has_active_schedule_client(
        target_organization_id,
        target_client_id
      )
      AND target_therapist_id IS NOT DISTINCT FROM app.current_therapist_id()
    );
$$;

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
    'program_id', s.program_id,
    'goal_id', s.goal_id,
    'started_at', s.started_at,
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
    AND app.current_user_can_read_schedule_session(v_org, s.client_id, s.therapist_id)
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
      'program_id', s.program_id,
      'goal_id', s.goal_id,
      'started_at', s.started_at,
      'duration_minutes', s.duration_minutes,
      'location_type', s.location_type,
      'session_type', s.session_type,
      'rate_per_hour', s.rate_per_hour,
      'total_cost', s.total_cost,
      'therapist', jsonb_build_object('id', t.id, 'full_name', t.full_name),
      'client', jsonb_build_object('id', c.id, 'full_name', c.full_name)
    )
    ORDER BY s.start_time
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
    AND app.current_user_can_read_schedule_session(v_org, s.client_id, s.therapist_id);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type,
      'availability_hours', t.availability_hours
    )
    ORDER BY t.full_name
  )
  INTO v_therapists
  FROM public.therapists t
  WHERE t.status = 'active'
    AND t.organization_id = v_org
    AND (
      app.current_user_can_read_full_schedule(v_org)
      OR t.id = app.current_therapist_id()
    );

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference,
      'availability_hours', c.availability_hours
    )
    ORDER BY c.full_name
  )
  INTO v_clients
  FROM public.clients c
  WHERE c.organization_id = v_org
    AND c.deleted_at IS NULL
    AND app.current_user_can_read_schedule_client(v_org, c.id);

  RETURN jsonb_build_object(
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION app.current_user_can_read_schedule_session(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_user_can_read_schedule_session(uuid, uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
