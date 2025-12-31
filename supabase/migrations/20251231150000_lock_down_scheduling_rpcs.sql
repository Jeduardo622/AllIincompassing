/*
  Scheduling RPC hardening:
  - Fix SECURITY DEFINER scheduling RPCs to fail closed when org context is missing.
  - Strictly scope scheduling data by organization_id.
  - Revoke default PUBLIC/anon execute privileges; re-grant only to intended roles.

  Background: Supabase/Postgres functions are executable by PUBLIC by default.
  See: https://supabase.com/docs/guides/database/functions#function-privileges
*/

-- ============================================================================
-- 1) Harden scheduling RPC bodies (fail closed + org scoping)
-- ============================================================================

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
      'full_name', t.full_name
    )
  )
  INTO v_therapists
  FROM (
    SELECT DISTINCT id, full_name
    FROM public.therapists
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
    FROM public.clients
    WHERE organization_id = v_org
    ORDER BY full_name
  ) c;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations'
      AND column_name = 'organization_id'
  ) INTO v_has_org_col;

  IF v_has_org_col THEN
    EXECUTE format($sql$
      SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name))
      FROM (
        SELECT DISTINCT id, name
        FROM public.locations
        WHERE is_active = true AND organization_id = $1
        ORDER BY name
      ) l
    $sql$)
    INTO v_locations
    USING v_org;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name))
    INTO v_locations
    FROM (
      SELECT DISTINCT id, name
      FROM public.locations
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
  FROM public.sessions s
  JOIN public.therapists t
    ON s.therapist_id = t.id
   AND t.organization_id = v_org
  JOIN public.clients c
    ON s.client_id = c.id
   AND c.organization_id = v_org
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
    ORDER BY t.full_name
  )
  INTO v_therapists
  FROM public.therapists t
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
    ORDER BY c.full_name
  )
  INTO v_clients
  FROM public.clients c
  WHERE c.organization_id = v_org;

  RETURN jsonb_build_object(
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_session_metrics(
  p_start_date date,
  p_end_date date,
  p_therapist_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_sessions bigint,
  completed_sessions bigint,
  cancelled_sessions bigint,
  no_show_sessions bigint,
  sessions_by_therapist jsonb,
  sessions_by_client jsonb,
  sessions_by_day jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
BEGIN
  IF v_org IS NULL THEN
    RETURN QUERY
    SELECT
      0::bigint,
      0::bigint,
      0::bigint,
      0::bigint,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT *
    FROM public.sessions s
    WHERE s.organization_id = v_org
      AND s.start_time >= p_start_date
      AND s.start_time <= p_end_date + interval '1 day'
      AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE status = 'completed')::bigint,
    COUNT(*) FILTER (WHERE status = 'cancelled')::bigint,
    COUNT(*) FILTER (WHERE status = 'no-show')::bigint,
    (
      SELECT jsonb_object_agg(full_name, session_count)
      FROM (
        SELECT t.full_name, COUNT(*) AS session_count
        FROM base
        JOIN public.therapists t
          ON t.id = base.therapist_id
         AND t.organization_id = v_org
        GROUP BY t.full_name
      ) per_therapist
    ),
    (
      SELECT jsonb_object_agg(full_name, session_count)
      FROM (
        SELECT c.full_name, COUNT(*) AS session_count
        FROM base
        JOIN public.clients c
          ON c.id = base.client_id
         AND c.organization_id = v_org
        GROUP BY c.full_name
      ) per_client
    ),
    (
      SELECT jsonb_object_agg(day_name, session_count)
      FROM (
        SELECT to_char(start_time, 'Day') AS day_name, COUNT(*) AS session_count
        FROM base
        GROUP BY day_name
      ) per_day
    )
  FROM base;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_session_metrics(
  p_start_date text,
  p_end_date text,
  p_therapist_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_sessions bigint,
  completed_sessions bigint,
  cancelled_sessions bigint,
  no_show_sessions bigint,
  sessions_by_therapist jsonb,
  sessions_by_client jsonb,
  sessions_by_day jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.get_session_metrics(p_start_date::date, p_end_date::date, p_therapist_id, p_client_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_alternative_therapists(
  p_client_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  client_preferences jsonb;
  alternative_therapists jsonb;
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_array();
  END IF;

  SELECT to_jsonb(c)
  INTO client_preferences
  FROM public.clients c
  WHERE c.id = p_client_id
    AND c.organization_id = v_org;

  IF client_preferences IS NULL THEN
    RETURN jsonb_build_array();
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'therapist_id', t.id,
      'therapist_name', t.full_name,
      'compatibility_score', public.calculate_therapist_client_compatibility(t.id, p_client_id),
      'alternative_times', public.get_therapist_availability(t.id, p_start_time::date, p_end_time::date)
    )
  )
  INTO alternative_therapists
  FROM public.therapists t
  WHERE t.status = 'active'
    AND t.organization_id = v_org
    AND NOT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.organization_id = v_org
        AND s.therapist_id = t.id
        AND s.status = 'scheduled'
        AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
    );

  RETURN COALESCE(alternative_therapists, jsonb_build_array());
END;
$$;

CREATE OR REPLACE FUNCTION public.get_alternative_times(
  p_therapist_id uuid,
  p_client_id uuid,
  p_original_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  date_range_start date := p_original_time::date;
  date_range_end date := (p_original_time::date + interval '7 days')::date;
  alternative_slots jsonb;
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_array();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.therapists t
    WHERE t.id = p_therapist_id
      AND t.organization_id = v_org
  ) THEN
    RETURN jsonb_build_array();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.organization_id = v_org
  ) THEN
    RETURN jsonb_build_array();
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'suggested_time', slot_time,
      'optimality_score', score,
      'reasoning', reasoning
    )
  )
  INTO alternative_slots
  FROM public.get_optimal_time_slots(
    (SELECT to_jsonb(t) FROM public.therapists t WHERE t.id = p_therapist_id),
    (SELECT to_jsonb(c) FROM public.clients c WHERE c.id = p_client_id),
    60,
    jsonb_build_object('start', date_range_start, 'end', date_range_end)
  ) AS slots(slot_time, score, reasoning, availability_data)
  WHERE score > 0.6
  ORDER BY score DESC
  LIMIT 5;

  RETURN COALESCE(alternative_slots, jsonb_build_array());
END;
$$;

CREATE OR REPLACE FUNCTION public.get_optimal_time_slots(
  p_therapist_preferences jsonb,
  p_client_preferences jsonb,
  p_duration integer DEFAULT 60,
  p_date_range jsonb DEFAULT '{"start": "today", "end": "+7 days"}'
)
RETURNS TABLE (
  suggested_time timestamptz,
  optimality_score numeric,
  reasoning jsonb,
  availability_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  start_date date;
  end_date date;
  therapist_id uuid := (p_therapist_preferences->>'id')::uuid;
  client_id uuid := (p_client_preferences->>'id')::uuid;
BEGIN
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  IF therapist_id IS NULL OR client_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.therapists t
    WHERE t.id = therapist_id
      AND t.organization_id = v_org
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = client_id
      AND c.organization_id = v_org
  ) THEN
    RETURN;
  END IF;

  start_date := CASE
    WHEN p_date_range->>'start' = 'today' THEN CURRENT_DATE
    WHEN p_date_range->>'start' ~ '^\+\d+\s+days?$' THEN CURRENT_DATE + (regexp_replace(p_date_range->>'start', '\+(\d+)\s+days?', '\1'))::integer
    ELSE (p_date_range->>'start')::date
  END;

  end_date := CASE
    WHEN p_date_range->>'end' = '+7 days' THEN (start_date + interval '7 days')::date
    WHEN p_date_range->>'end' ~ '^\+\d+\s+days?$' THEN (start_date + (regexp_replace(p_date_range->>'end', '\+(\d+)\s+days?', '\1'))::integer)::date
    ELSE (p_date_range->>'end')::date
  END;

  RETURN QUERY
  WITH business_hours AS (
    SELECT generate_series(
      start_date::timestamp + interval '8 hours',
      end_date::timestamp + interval '17 hours',
      interval '30 minutes'
    ) AS slot_time
  ),
  available_slots AS (
    SELECT
      bh.slot_time,
      EXTRACT(dow FROM bh.slot_time) AS day_of_week,
      EXTRACT(hour FROM bh.slot_time) AS hour_of_day
    FROM business_hours bh
    WHERE bh.slot_time + interval '1 minute' * p_duration <= date_trunc('day', bh.slot_time) + interval '18 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.organization_id = v_org
          AND (s.therapist_id = therapist_id OR s.client_id = client_id)
          AND s.status = 'scheduled'
          AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(bh.slot_time, bh.slot_time + interval '1 minute' * p_duration, '[)')
      )
  ),
  scored_slots AS (
    SELECT
      avs.slot_time,
      public.calculate_time_slot_score(
        avs.slot_time,
        avs.day_of_week,
        avs.hour_of_day,
        p_therapist_preferences,
        p_client_preferences,
        therapist_id,
        client_id
      ) AS score
    FROM available_slots avs
  )
  SELECT
    ss.slot_time,
    ss.score,
    public.generate_slot_reasoning(
      ss.slot_time,
      p_therapist_preferences,
      p_client_preferences,
      therapist_id,
      client_id
    ) AS reasoning,
    public.get_slot_availability_context(ss.slot_time, therapist_id, client_id) AS availability_data
  FROM scored_slots ss
  WHERE ss.score > 0.3
  ORDER BY ss.score DESC
  LIMIT 10;
END;
$$;

-- ============================================================================
-- 2) Lock down confirm_session_hold (used by edge pipelines; must not be public)
--    - Keep existing signature but fix tenant scoping + required organization_id writes.
--    - Do NOT grant execute to anon/authenticated/public.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_session_hold(
  p_hold_key uuid,
  p_session jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hold public.session_holds;
  v_session public.sessions;
  v_session_id uuid;
  v_therapist_id uuid;
  v_client_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_notes text;
  v_location text;
  v_session_type text;
  v_rate numeric;
  v_total numeric;
  v_raw_duration numeric;
  v_duration integer;
  v_cpt_increment constant integer := 15;
  v_org uuid;
BEGIN
  DELETE FROM public.session_holds
  WHERE expires_at <= timezone('utc', now());

  SELECT *
  INTO v_hold
  FROM public.session_holds
  WHERE hold_key = p_hold_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'HOLD_NOT_FOUND', 'error_message', 'Hold has expired or does not exist.');
  END IF;

  v_org := v_hold.organization_id;

  v_session_id := nullif(p_session->>'id', '')::uuid;
  v_therapist_id := nullif(p_session->>'therapist_id', '')::uuid;
  v_client_id := nullif(p_session->>'client_id', '')::uuid;
  v_start := nullif(p_session->>'start_time', '')::timestamptz;
  v_end := nullif(p_session->>'end_time', '')::timestamptz;
  v_status := COALESCE(nullif(p_session->>'status', ''), 'scheduled');
  v_notes := nullif(p_session->>'notes', '');
  v_location := nullif(p_session->>'location_type', '');
  v_session_type := nullif(p_session->>'session_type', '');
  v_rate := nullif(p_session->>'rate_per_hour', '')::numeric;
  v_total := nullif(p_session->>'total_cost', '')::numeric;
  v_raw_duration := COALESCE(
    nullif(p_session->>'duration_minutes', '')::numeric,
    (EXTRACT(epoch FROM (v_end - v_start)) / 60)::numeric
  );

  v_duration := GREATEST(v_cpt_increment, (round(v_raw_duration / v_cpt_increment)::int) * v_cpt_increment);

  IF v_therapist_id IS NULL OR v_client_id IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_FIELDS', 'error_message', 'Missing required session fields.');
  END IF;

  IF v_hold.therapist_id <> v_therapist_id OR v_hold.start_time <> v_start OR v_hold.end_time <> v_end THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'HOLD_MISMATCH', 'error_message', 'Session details do not match the held slot.');
  END IF;

  IF v_hold.client_id <> v_client_id THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'CLIENT_MISMATCH', 'error_message', 'Client differs from the hold.');
  END IF;

  IF v_hold.expires_at <= timezone('utc', now()) THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'HOLD_EXPIRED', 'error_message', 'Hold has expired.');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.therapists t
    WHERE t.id = v_therapist_id
      AND t.organization_id = v_org
  ) THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'error_message', 'Therapist not in organization scope.');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = v_client_id
      AND c.organization_id = v_org
  ) THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'error_message', 'Client not in organization scope.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.organization_id = v_org
      AND s.therapist_id = v_therapist_id
      AND (v_session_id IS NULL OR s.id <> v_session_id)
      AND s.status <> 'cancelled'
      AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_CONFLICT', 'error_message', 'Therapist already has a session during this time.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.organization_id = v_org
      AND s.client_id = v_client_id
      AND (v_session_id IS NULL OR s.id <> v_session_id)
      AND s.status <> 'cancelled'
      AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'CLIENT_CONFLICT', 'error_message', 'Client already has a session during this time.');
  END IF;

  IF v_session_id IS NULL THEN
    INSERT INTO public.sessions (
      organization_id,
      therapist_id,
      client_id,
      start_time,
      end_time,
      status,
      notes,
      location_type,
      session_type,
      rate_per_hour,
      total_cost,
      duration_minutes
    )
    VALUES (
      v_org,
      v_therapist_id,
      v_client_id,
      v_start,
      v_end,
      v_status,
      v_notes,
      v_location,
      v_session_type,
      v_rate,
      v_total,
      v_duration
    )
    RETURNING * INTO v_session;
  ELSE
    UPDATE public.sessions
    SET
      organization_id = v_org,
      therapist_id = v_therapist_id,
      client_id = v_client_id,
      start_time = v_start,
      end_time = v_end,
      status = v_status,
      notes = v_notes,
      location_type = v_location,
      session_type = v_session_type,
      rate_per_hour = v_rate,
      total_cost = v_total,
      duration_minutes = v_duration
    WHERE id = v_session_id
      AND organization_id = v_org
    RETURNING * INTO v_session;
  END IF;

  DELETE FROM public.session_holds WHERE id = v_hold.id;

  RETURN jsonb_build_object('success', true, 'session', row_to_json(v_session));
END;
$$;

-- ============================================================================
-- 3) Function privileges (revoke default PUBLIC execution; regrant explicitly)
-- ============================================================================

-- Read-only scheduling RPCs: authenticated only
REVOKE EXECUTE ON FUNCTION public.get_dropdown_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dropdown_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dropdown_data() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_session_metrics(date, date, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_session_metrics(date, date, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_session_metrics(date, date, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_session_metrics(text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_session_metrics(text, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_session_metrics(text, text, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_alternative_times(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_alternative_times(uuid, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_alternative_times(uuid, uuid, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_alternative_therapists(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_alternative_therapists(uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_alternative_therapists(uuid, timestamptz, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_optimal_time_slots(jsonb, jsonb, integer, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_optimal_time_slots(jsonb, jsonb, integer, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_optimal_time_slots(jsonb, jsonb, integer, jsonb) TO authenticated;

-- Confirm function(s): service_role only (used by trusted backend/edge pipelines).
REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) TO service_role;

-- Legacy/unsafe overload: do not expose to any API role.
REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb, uuid) FROM service_role;

-- Other helper scheduling routines restored previously: remove PUBLIC/anon access.
-- (These are building blocks used by the scheduling RPCs; keep callable by authenticated only.)
DO $$
BEGIN
  -- best-effort hardening: ignore missing functions in older branches.
  PERFORM 1;
  BEGIN
    REVOKE EXECUTE ON FUNCTION public.calculate_time_slot_score(timestamptz, numeric, numeric, jsonb, jsonb, uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.calculate_time_slot_score(timestamptz, numeric, numeric, jsonb, jsonb, uuid, uuid) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.generate_slot_reasoning(timestamptz, jsonb, jsonb, uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.generate_slot_reasoning(timestamptz, jsonb, jsonb, uuid, uuid) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.get_slot_availability_context(timestamptz, uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_slot_availability_context(timestamptz, uuid, uuid) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.get_client_preference_factor(uuid, timestamptz) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_client_preference_factor(uuid, timestamptz) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.get_scheduling_efficiency_factor(uuid, timestamptz) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_scheduling_efficiency_factor(uuid, timestamptz) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.get_therapist_workload_factor(uuid, timestamptz) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_therapist_workload_factor(uuid, timestamptz) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.get_therapist_availability(uuid, date, date) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_therapist_availability(uuid, date, date) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    REVOKE EXECUTE ON FUNCTION public.calculate_therapist_client_compatibility(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.calculate_therapist_client_compatibility(uuid, uuid) TO authenticated;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;
END;
$$;

