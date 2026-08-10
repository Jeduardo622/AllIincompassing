-- @migration-intent: Restrict BT and legacy therapist schedule reads to active client assignments without changing schedule write authority.
-- @migration-dependencies: app.current_user_has_exact_role_for_org, app.current_user_organization_id, app.current_therapist_id, client_therapist_links.
-- @migration-rollback: Restore org_read_sessions from 20260701150000_employee_role_capability_matrix.sql, get_sessions_optimized from 20260204201000_update_schedule_rpcs.sql, and get_dropdown_data/get_schedule_data_batch from 20260408142721_schedule_rpc_include_availability_hours.sql; then DROP FUNCTION app.current_user_can_read_schedule_client(uuid, uuid); DROP FUNCTION app.current_user_has_active_schedule_client(uuid, uuid); DROP FUNCTION app.current_user_can_read_full_schedule(uuid).

BEGIN;

CREATE OR REPLACE FUNCTION app.current_user_can_read_full_schedule(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
  SELECT app.current_user_has_exact_role_for_org(
    target_organization_id,
    ARRAY['admin', 'admin_schedule', 'midtier', 'bcba']::text[]
  );
$$;

CREATE OR REPLACE FUNCTION app.current_user_has_active_schedule_client(
  target_organization_id uuid,
  target_client_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_therapist_id uuid;
BEGIN
  IF caller_id IS NULL OR target_organization_id IS NULL OR target_client_id IS NULL THEN
    RETURN false;
  END IF;

  IF target_organization_id IS DISTINCT FROM app.current_user_organization_id() THEN
    RETURN false;
  END IF;

  caller_therapist_id := app.current_therapist_id();

  RETURN EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = target_client_id
      AND c.organization_id = target_organization_id
      AND c.deleted_at IS NULL
      AND (
        c.therapist_id IS NOT DISTINCT FROM caller_id
        OR c.therapist_id IS NOT DISTINCT FROM caller_therapist_id
        OR EXISTS (
          SELECT 1
          FROM public.client_therapist_links ctl
          WHERE ctl.client_id = target_client_id
            AND ctl.organization_id = target_organization_id
            AND ctl.therapist_id = caller_therapist_id
        )
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_read_schedule_client(
  target_organization_id uuid,
  target_client_id uuid
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
      AND app.current_user_has_active_schedule_client(target_organization_id, target_client_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION app.current_user_can_read_full_schedule(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION app.current_user_has_active_schedule_client(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION app.current_user_can_read_schedule_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_user_can_read_full_schedule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_has_active_schedule_client(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_can_read_schedule_client(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS org_read_sessions ON public.sessions;
CREATE POLICY org_read_sessions
ON public.sessions
FOR SELECT
TO authenticated
USING (
  organization_id = app.current_user_organization_id()
  AND app.current_user_can_read_schedule_client(organization_id, client_id)
);

CREATE OR REPLACE FUNCTION public.get_dropdown_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_locations jsonb := '[]'::jsonb;
  v_has_org_col boolean;
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_object(
      'therapists', v_therapists,
      'clients', v_clients,
      'locations', v_locations
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
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
      'availability_hours', c.availability_hours
    )
    ORDER BY c.full_name
  )
  INTO v_clients
  FROM public.clients c
  WHERE c.organization_id = v_org
    AND c.deleted_at IS NULL
    AND app.current_user_can_read_schedule_client(v_org, c.id);

  IF app.current_user_can_read_full_schedule(v_org) THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'locations'
        AND column_name = 'organization_id'
    ) INTO v_has_org_col;

    IF v_has_org_col THEN
      EXECUTE format($sql$
        SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name)
        FROM public.locations
        WHERE is_active = true AND organization_id = $1
      $sql$)
      INTO v_locations
      USING v_org;
    ELSE
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) ORDER BY l.name)
      INTO v_locations
      FROM public.locations l
      WHERE l.is_active = true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb),
    'locations', COALESCE(v_locations, '[]'::jsonb)
  );
END;
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
    AND app.current_user_can_read_schedule_client(v_org, s.client_id)
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
    AND app.current_user_can_read_schedule_client(v_org, s.client_id);

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

REVOKE EXECUTE ON FUNCTION public.get_dropdown_data() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dropdown_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
