/*
  # Scope optimized scheduling RPCs to caller organization

  1. Security
    - Ensure dropdown, schedule, session metrics, and optimized sessions RPCs respect
      the requester's organization context.
    - Avoid leaking cross-organization data by filtering on app.current_user_organization_id().

  2. Behaviour
    - Returns empty payloads when the caller has no organization context.
*/

-- Scope get_dropdown_data to the caller organization
CREATE OR REPLACE FUNCTION get_dropdown_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_locations jsonb := '[]'::jsonb;
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
      'full_name', t.full_name
    )
  )
  INTO v_therapists
  FROM (
    SELECT DISTINCT id, full_name
    FROM therapists
    WHERE status = 'active'
      AND organization_id = v_org
    ORDER BY full_name
  ) t;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name
    )
  )
  INTO v_clients
  FROM (
    SELECT DISTINCT id, full_name
    FROM clients
    WHERE organization_id = v_org
    ORDER BY full_name
  ) c;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations'
      AND column_name = 'organization_id'
  ) THEN
    EXECUTE $$
      SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name))
      FROM (
        SELECT DISTINCT id, name
        FROM locations
        WHERE is_active = true
          AND organization_id = $1
        ORDER BY name
      ) l
    $$ INTO v_locations USING v_org;
  ELSE
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'name', l.name
      )
    )
    INTO v_locations
    FROM (
      SELECT DISTINCT id, name
      FROM locations
      WHERE is_active = true
      ORDER BY name
    ) l;
  END IF;

  RETURN jsonb_build_object(
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb),
    'locations', COALESCE(v_locations, '[]'::jsonb)
  );
END;
$$;

-- Scope get_sessions_optimized to the caller organization
CREATE OR REPLACE FUNCTION get_sessions_optimized(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_therapist_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE (
  session_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  FROM sessions s
  JOIN therapists t ON s.therapist_id = t.id AND t.organization_id = v_org
  JOIN clients c ON s.client_id = c.id AND c.organization_id = v_org
  WHERE s.organization_id = v_org
    AND s.start_time >= p_start_date
    AND s.start_time <= p_end_date
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
  ORDER BY s.start_time;
END;
$$;

-- Scope get_schedule_data_batch to the caller organization
CREATE OR REPLACE FUNCTION get_schedule_data_batch(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_sessions jsonb := '[]'::jsonb;
  v_therapists jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_object(
      'sessions', v_sessions,
      'therapists', v_therapists,
      'clients', v_clients
    );
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
  FROM sessions s
  JOIN therapists t ON s.therapist_id = t.id AND t.organization_id = v_org
  JOIN clients c ON s.client_id = c.id AND c.organization_id = v_org
  WHERE s.organization_id = v_org
    AND s.start_time >= p_start_date
    AND s.start_time <= p_end_date;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name,
      'email', t.email,
      'service_type', t.service_type,
      'specialties', t.specialties,
      'availability_hours', t.availability_hours
    )
  )
  INTO v_therapists
  FROM therapists t
  WHERE t.status = 'active'
    AND t.organization_id = v_org;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name,
      'email', c.email,
      'service_preference', c.service_preference,
      'availability_hours', c.availability_hours
    )
  )
  INTO v_clients
  FROM clients c
  WHERE c.organization_id = v_org;

  RETURN jsonb_build_object(
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb)
  );
END;
$$;

-- Scope get_session_metrics to the caller organization
CREATE OR REPLACE FUNCTION get_session_metrics(
  p_start_date date,
  p_end_date date,
  p_therapist_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_total_sessions bigint := 0;
  v_completed_sessions bigint := 0;
  v_cancelled_sessions bigint := 0;
  v_no_show_sessions bigint := 0;
  v_completion_rate numeric := 0;
  v_sessions_by_therapist jsonb := '{}'::jsonb;
  v_sessions_by_client jsonb := '{}'::jsonb;
  v_sessions_by_day jsonb := '{}'::jsonb;
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_object(
      'totalSessions', v_total_sessions,
      'completedSessions', v_completed_sessions,
      'cancelledSessions', v_cancelled_sessions,
      'noShowSessions', v_no_show_sessions,
      'completionRate', v_completion_rate,
      'sessionsByTherapist', v_sessions_by_therapist,
      'sessionsByClient', v_sessions_by_client,
      'sessionsByDayOfWeek', v_sessions_by_day
    );
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COUNT(*) FILTER (WHERE status = 'no-show')
  INTO v_total_sessions, v_completed_sessions, v_cancelled_sessions, v_no_show_sessions
  FROM sessions s
  WHERE s.organization_id = v_org
    AND s.start_time >= p_start_date
    AND s.start_time <= (p_end_date + INTERVAL '1 day')
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id);

  v_completion_rate := CASE
    WHEN v_total_sessions > 0 THEN (v_completed_sessions::numeric / v_total_sessions::numeric) * 100
    ELSE 0
  END;

  SELECT jsonb_object_agg(t.full_name, session_count)
  INTO v_sessions_by_therapist
  FROM (
    SELECT t.full_name, COUNT(s.id) AS session_count
    FROM sessions s
    JOIN therapists t ON s.therapist_id = t.id
    WHERE s.organization_id = v_org
      AND t.organization_id = v_org
      AND s.start_time >= p_start_date
      AND s.start_time <= (p_end_date + INTERVAL '1 day')
      AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    GROUP BY t.id, t.full_name
    ORDER BY session_count DESC
    LIMIT 20
  ) t;

  SELECT jsonb_object_agg(c.full_name, session_count)
  INTO v_sessions_by_client
  FROM (
    SELECT c.full_name, COUNT(s.id) AS session_count
    FROM sessions s
    JOIN clients c ON s.client_id = c.id
    WHERE s.organization_id = v_org
      AND c.organization_id = v_org
      AND s.start_time >= p_start_date
      AND s.start_time <= (p_end_date + INTERVAL '1 day')
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
    GROUP BY c.id, c.full_name
    ORDER BY session_count DESC
    LIMIT 20
  ) c;

  SELECT jsonb_object_agg(day_name, session_count)
  INTO v_sessions_by_day
  FROM (
    SELECT
      to_char(s.start_time, 'Day') AS day_name,
      COUNT(s.id) AS session_count
    FROM sessions s
    WHERE s.organization_id = v_org
      AND s.start_time >= p_start_date
      AND s.start_time <= (p_end_date + INTERVAL '1 day')
      AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
    GROUP BY to_char(s.start_time, 'Day'), EXTRACT(DOW FROM s.start_time)
    ORDER BY EXTRACT(DOW FROM s.start_time)
  ) d;

  RETURN jsonb_build_object(
    'totalSessions', v_total_sessions,
    'completedSessions', v_completed_sessions,
    'cancelledSessions', v_cancelled_sessions,
    'noShowSessions', v_no_show_sessions,
    'completionRate', v_completion_rate,
    'sessionsByTherapist', COALESCE(v_sessions_by_therapist, '{}'::jsonb),
    'sessionsByClient', COALESCE(v_sessions_by_client, '{}'::jsonb),
    'sessionsByDayOfWeek', COALESCE(v_sessions_by_day, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_dropdown_data() TO authenticated;
GRANT EXECUTE ON FUNCTION get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_schedule_data_batch(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_metrics(date, date, uuid, uuid) TO authenticated;
