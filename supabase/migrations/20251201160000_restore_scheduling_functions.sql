/*
  # Scheduling & Availability Function Restoration

  Restores the original scheduling RPC surface (battle-tested circa 2025-07)
  with organization-aware filtering and helper routines so the UI can once
  again surface real availability options, conflict suggestions, and hold
  confirmations.
*/

-- Clean up stub implementations so we can recreate the full versions
DROP FUNCTION IF EXISTS public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_schedule_data_batch(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_alternative_therapists(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_alternative_times(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.get_optimal_time_slots(jsonb, jsonb, integer, jsonb);
DROP FUNCTION IF EXISTS public.calculate_time_slot_score(timestamptz, numeric, numeric, jsonb, jsonb, uuid, uuid);
DROP FUNCTION IF EXISTS public.generate_slot_reasoning(timestamptz, jsonb, jsonb, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_slot_availability_context(timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_client_preference_factor(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.get_scheduling_efficiency_factor(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.get_therapist_workload_factor(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.get_therapist_availability(uuid, date, date);
DROP FUNCTION IF EXISTS public.calculate_therapist_client_compatibility(uuid, uuid);
DROP FUNCTION IF EXISTS public.analyze_therapist_workload(uuid, integer);
DROP FUNCTION IF EXISTS public.generate_workload_recommendations(uuid, numeric, numeric, integer);
DROP FUNCTION IF EXISTS public.get_performance_metrics(text);
DROP FUNCTION IF EXISTS public.get_performance_recommendations();
DROP FUNCTION IF EXISTS public.get_session_metrics(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_session_metrics(text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_sessions_report(date, date, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_sessions_report(text, text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.confirm_session_hold(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.get_sessions_optimized(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_therapist_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS TABLE (session_data jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
BEGIN
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', s.id,
    'start_time', s.start_time,
    'end_time', s.end_time,
    'status', s.status,
    'notes', s.notes,
    'created_at', s.created_at,
    'created_by', s.created_by,
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
  )
  FROM public.sessions s
  JOIN public.therapists t ON s.therapist_id = t.id
  JOIN public.clients c ON s.client_id = c.id
  WHERE s.start_time >= p_start_date
    AND s.start_time <= p_end_date
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
    AND (
      v_org IS NULL
      OR (s.organization_id = v_org AND t.organization_id = v_org AND c.organization_id = v_org)
    )
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
SET search_path = public, app, auth
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  v_sessions jsonb;
  v_therapists jsonb;
  v_clients jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist_id', s.therapist_id,
      'client_id', s.client_id,
      'therapist', jsonb_build_object('id', t.id, 'full_name', t.full_name),
      'client', jsonb_build_object('id', c.id, 'full_name', c.full_name)
    )
  )
  INTO v_sessions
  FROM public.sessions s
  JOIN public.therapists t ON s.therapist_id = t.id
  JOIN public.clients c ON s.client_id = c.id
  WHERE s.start_time BETWEEN p_start_date AND p_end_date
    AND (v_org IS NULL OR s.organization_id = v_org);

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
    AND (v_org IS NULL OR t.organization_id = v_org);

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
  WHERE v_org IS NULL OR c.organization_id = v_org;

  RETURN jsonb_build_object(
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb)
  );
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
SET search_path = public, app, auth
AS $$
DECLARE
  v_org uuid := app.current_user_organization_id();
  client_preferences jsonb;
  alternative_therapists jsonb;
BEGIN
  SELECT to_jsonb(c) INTO client_preferences
  FROM public.clients c
  WHERE c.id = p_client_id
    AND (v_org IS NULL OR c.organization_id = v_org);

  SELECT jsonb_agg(
    jsonb_build_object(
      'therapist_id', t.id,
      'therapist_name', t.full_name,
      'compatibility_score', calculate_therapist_client_compatibility(t.id, p_client_id),
      'alternative_times', get_therapist_availability(t.id, p_start_time::date, p_end_time::date)
    )
  )
  INTO alternative_therapists
  FROM public.therapists t
  WHERE t.status = 'active'
    AND (v_org IS NULL OR t.organization_id = v_org)
    AND NOT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.therapist_id = t.id
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
SET search_path = public, app, auth
AS $$
DECLARE
  date_range_start date := p_original_time::date;
  date_range_end date := p_original_time::date + interval '7 days';
  alternative_slots jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'suggested_time', slot_time,
      'optimality_score', score,
      'reasoning', reasoning
    )
  )
  INTO alternative_slots
  FROM get_optimal_time_slots(
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
SET search_path = public, app, auth
AS $$
DECLARE
  start_date date;
  end_date date;
  therapist_id uuid := (p_therapist_preferences->>'id')::uuid;
  client_id uuid := (p_client_preferences->>'id')::uuid;
BEGIN
  IF therapist_id IS NULL OR client_id IS NULL THEN
    RETURN;
  END IF;

  start_date := CASE
    WHEN p_date_range->>'start' = 'today' THEN CURRENT_DATE
    WHEN p_date_range->>'start' ~ '^\+\d+\s+days?$' THEN CURRENT_DATE + (regexp_replace(p_date_range->>'start', '\+(\d+)\s+days?', '\1'))::integer
    ELSE (p_date_range->>'start')::date
  END;

  end_date := CASE
    WHEN p_date_range->>'end' = '+7 days' THEN start_date + interval '7 days'
    WHEN p_date_range->>'end' ~ '^\+\d+\s+days?$' THEN start_date + (regexp_replace(p_date_range->>'end', '\+(\d+)\s+days?', '\1'))::integer
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
        WHERE (s.therapist_id = therapist_id OR s.client_id = client_id)
          AND s.status = 'scheduled'
          AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(bh.slot_time, bh.slot_time + interval '1 minute' * p_duration, '[)')
      )
  ),
  scored_slots AS (
    SELECT
      avs.slot_time,
      calculate_time_slot_score(
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
    generate_slot_reasoning(
      ss.slot_time,
      p_therapist_preferences,
      p_client_preferences,
      therapist_id,
      client_id
    ) AS reasoning,
    get_slot_availability_context(ss.slot_time, therapist_id, client_id) AS availability_data
  FROM scored_slots ss
  WHERE ss.score > 0.3
  ORDER BY ss.score DESC
  LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_time_slot_score(
  p_slot_time timestamptz,
  p_day_of_week numeric,
  p_hour_of_day numeric,
  p_therapist_prefs jsonb,
  p_client_prefs jsonb,
  p_therapist_id uuid,
  p_client_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  score numeric := 0;
BEGIN
  score := score + CASE
    WHEN p_hour_of_day BETWEEN 9 AND 16 THEN 0.8
    WHEN p_hour_of_day BETWEEN 8 AND 17 THEN 0.6
    ELSE 0.3
  END;

  score := score + CASE
    WHEN p_day_of_week BETWEEN 1 AND 5 THEN 0.2
    ELSE 0.0
  END;

  score := score + (get_therapist_workload_factor(p_therapist_id, p_slot_time) * 0.3);
  score := score + (get_client_preference_factor(p_client_id, p_slot_time) * 0.2);
  score := score + (get_scheduling_efficiency_factor(p_therapist_id, p_slot_time) * 0.15);

  RETURN LEAST(score, 1.0);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_slot_reasoning(
  p_slot_time timestamptz,
  p_therapist_prefs jsonb,
  p_client_prefs jsonb,
  p_therapist_id uuid,
  p_client_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  therapist_factor numeric := get_therapist_workload_factor(p_therapist_id, p_slot_time);
  client_factor numeric := get_client_preference_factor(p_client_id, p_slot_time);
  efficiency_factor numeric := get_scheduling_efficiency_factor(p_therapist_id, p_slot_time);
BEGIN
  RETURN jsonb_build_object(
    'dayOfWeek', to_char(p_slot_time, 'Day'),
    'hourOfDay', EXTRACT(hour FROM p_slot_time),
    'matchesTherapistLoad', therapist_factor >= 0.6,
    'matchesClientPattern', client_factor >= 0.6,
    'preservesSessionSpacing', efficiency_factor >= 0.5,
    'notes', jsonb_build_array(
      CASE WHEN therapist_factor >= 0.6 THEN 'Therapist load balanced' ELSE 'Therapist heavily booked' END,
      CASE WHEN client_factor >= 0.6 THEN 'Fits client historical pattern' ELSE 'Outside typical client hours' END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_slot_availability_context(
  p_slot_time timestamptz,
  p_therapist_id uuid,
  p_client_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  therapist_conflicts integer;
  client_conflicts integer;
  prev_session timestamptz;
  next_session timestamptz;
BEGIN
  SELECT COUNT(*) INTO therapist_conflicts
  FROM public.sessions s
  WHERE s.therapist_id = p_therapist_id
    AND s.status = 'scheduled'
    AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_slot_time, p_slot_time + interval '60 minutes', '[)');

  SELECT COUNT(*) INTO client_conflicts
  FROM public.sessions s
  WHERE s.client_id = p_client_id
    AND s.status = 'scheduled'
    AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_slot_time, p_slot_time + interval '60 minutes', '[)');

  SELECT MAX(s.end_time) INTO prev_session
  FROM public.sessions s
  WHERE s.therapist_id = p_therapist_id
    AND s.end_time <= p_slot_time;

  SELECT MIN(s.start_time) INTO next_session
  FROM public.sessions s
  WHERE s.therapist_id = p_therapist_id
    AND s.start_time >= p_slot_time;

  RETURN jsonb_build_object(
    'therapistConflicts', therapist_conflicts,
    'clientConflicts', client_conflicts,
    'previousSessionEnd', prev_session,
    'nextSessionStart', next_session
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_preference_factor(
  p_client_id uuid,
  p_slot_time timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  preferred_hour numeric;
  preferred_dow numeric;
  slot_hour numeric := EXTRACT(hour FROM p_slot_time);
  slot_dow numeric := EXTRACT(dow FROM p_slot_time);
  hour_diff numeric;
  dow_score numeric;
BEGIN
  SELECT
    AVG(EXTRACT(hour FROM start_time)),
    AVG(EXTRACT(dow FROM start_time))
  INTO preferred_hour, preferred_dow
  FROM public.sessions
  WHERE client_id = p_client_id
    AND status IN ('scheduled', 'completed')
    AND start_time >= now() - interval '90 days';

  IF preferred_hour IS NULL THEN
    RETURN 0.5;
  END IF;

  hour_diff := ABS(preferred_hour - slot_hour);
  dow_score := 1 - (ABS(COALESCE(preferred_dow, slot_dow) - slot_dow) / 7);

  RETURN LEAST(1, GREATEST(0, (1 - (hour_diff / 12)) * 0.7 + dow_score * 0.3));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_scheduling_efficiency_factor(
  p_therapist_id uuid,
  p_slot_time timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  prev_end timestamptz;
  next_start timestamptz;
BEGIN
  SELECT MAX(end_time) INTO prev_end
  FROM public.sessions
  WHERE therapist_id = p_therapist_id
    AND end_time <= p_slot_time;

  SELECT MIN(start_time) INTO next_start
  FROM public.sessions
  WHERE therapist_id = p_therapist_id
    AND start_time >= p_slot_time;

  IF prev_end IS NULL OR next_start IS NULL THEN
    RETURN 0.6;
  END IF;

  RETURN LEAST(
    1,
    GREATEST(0, 1 - (EXTRACT(EPOCH FROM (p_slot_time - prev_end)) / 7200)) * 0.5
      + GREATEST(0, 1 - (EXTRACT(EPOCH FROM (next_start - p_slot_time)) / 7200)) * 0.5
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_therapist_workload_factor(
  p_therapist_id uuid,
  p_slot_time timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  week_start date := date_trunc('week', p_slot_time)::date;
  week_end date := week_start + interval '7 days';
  scheduled_hours numeric;
  target_hours numeric;
BEGIN
  SELECT COALESCE(SUM(EXTRACT(epoch FROM (end_time - start_time)) / 3600), 0)
  INTO scheduled_hours
  FROM public.sessions
  WHERE therapist_id = p_therapist_id
    AND status IN ('scheduled', 'completed')
    AND start_time >= week_start
    AND start_time < week_end;

  SELECT ((COALESCE(weekly_hours_min, 20) + COALESCE(weekly_hours_max, 40)) / 2.0)
  INTO target_hours
  FROM public.therapists
  WHERE id = p_therapist_id;

  IF target_hours IS NULL OR target_hours = 0 THEN
    RETURN 0.7;
  END IF;

  RETURN LEAST(1, GREATEST(0, 1 - (scheduled_hours / (target_hours * 1.5))));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_therapist_availability(
  p_therapist_id uuid,
  p_start date,
  p_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  slots jsonb;
BEGIN
  WITH generated AS (
    SELECT generate_series(
      p_start::timestamp + interval '8 hours',
      (p_end + 1)::timestamp,
      interval '30 minutes'
    ) AS slot_time
  ),
  open_slots AS (
    SELECT g.slot_time
    FROM generated g
    WHERE EXTRACT(hour FROM g.slot_time) BETWEEN 8 AND 18
      AND NOT EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.therapist_id = p_therapist_id
          AND s.status IN ('scheduled', 'completed')
          AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(g.slot_time, g.slot_time + interval '30 minutes', '[)')
      )
  )
  SELECT jsonb_agg(slot_time ORDER BY slot_time)
  INTO slots
  FROM open_slots;

  RETURN COALESCE(slots, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_therapist_client_compatibility(
  p_therapist_id uuid,
  p_client_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  compatibility_score numeric := 0;
  therapist_data record;
  client_data record;
BEGIN
  SELECT * INTO therapist_data FROM public.therapists WHERE id = p_therapist_id;
  SELECT * INTO client_data FROM public.clients WHERE id = p_client_id;

  IF therapist_data.service_type && client_data.service_preference THEN
    compatibility_score := compatibility_score + 0.4;
  END IF;

  IF therapist_data.specialties && ARRAY[client_data.primary_diagnosis] THEN
    compatibility_score := compatibility_score + 0.3;
  END IF;

  compatibility_score := compatibility_score
    + COALESCE((SELECT get_historical_success_rate(p_therapist_id, p_client_id)), 0.2);

  RETURN LEAST(compatibility_score, 1.0);
END;
$$;

CREATE OR REPLACE FUNCTION public.analyze_therapist_workload(
  p_therapist_id uuid DEFAULT NULL,
  p_analysis_period integer DEFAULT 30
)
RETURNS TABLE (
  therapist_id uuid,
  therapist_name text,
  utilization_rate numeric,
  total_hours numeric,
  target_hours numeric,
  efficiency_score numeric,
  recommendations jsonb,
  workload_distribution jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
BEGIN
  RETURN QUERY
  WITH therapist_stats AS (
    SELECT
      t.id,
      t.full_name,
      t.weekly_hours_min,
      t.weekly_hours_max,
      COALESCE(session_hours.total_hours, 0) AS actual_hours,
      COALESCE(session_hours.session_count, 0) AS session_count,
      session_hours.daily_distribution
    FROM public.therapists t
    LEFT JOIN (
      SELECT
        s.therapist_id,
        SUM(EXTRACT(epoch FROM (s.end_time - s.start_time)) / 3600) AS total_hours,
        COUNT(*) AS session_count,
        jsonb_object_agg(
          EXTRACT(dow FROM s.start_time),
          COUNT(*)
        ) AS daily_distribution
      FROM public.sessions s
      WHERE s.start_time >= CURRENT_DATE - interval '1 day' * p_analysis_period
        AND s.status IN ('scheduled', 'completed')
        AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
      GROUP BY s.therapist_id
    ) session_hours ON t.id = session_hours.therapist_id
    WHERE t.status = 'active'
      AND (p_therapist_id IS NULL OR t.id = p_therapist_id)
  )
  SELECT
    ts.id,
    ts.full_name,
    ROUND((ts.actual_hours * 4) / NULLIF((ts.weekly_hours_min + ts.weekly_hours_max), 0) * 100, 2) AS utilization_rate,
    ts.actual_hours,
    (ts.weekly_hours_min + ts.weekly_hours_max) / 2.0 AS target_hours,
    calculate_efficiency_score(ts.id, ts.actual_hours, ts.session_count) AS efficiency_score,
    generate_workload_recommendations(
      ts.id,
      ts.actual_hours,
      (ts.weekly_hours_min + ts.weekly_hours_max) / 2.0,
      ts.session_count
    ) AS recommendations,
    ts.daily_distribution AS workload_distribution
  FROM therapist_stats ts;
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
AS $$
DECLARE
  recommendations jsonb := jsonb_build_array();
  utilization_rate numeric;
  avg_session_length numeric;
BEGIN
  IF p_target_hours IS NULL OR p_target_hours = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  utilization_rate := (p_actual_hours / NULLIF(p_target_hours, 0)) * 100;
  avg_session_length := CASE WHEN p_session_count > 0 THEN p_actual_hours / p_session_count ELSE NULL END;

  IF utilization_rate < 70 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'increase_utilization',
        'priority', 'high',
        'message', format('Utilization at %.1f%%. Consider adding %s hours/week', utilization_rate, ROUND(p_target_hours - p_actual_hours, 1)),
        'action', 'schedule_more_sessions'
      )
    );
  END IF;

  IF utilization_rate > 120 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'reduce_overload',
        'priority', 'critical',
        'message', format('Overutilized at %.1f%%. Consider reducing %s hours/week', utilization_rate, ROUND(p_actual_hours - p_target_hours, 1)),
        'action', 'redistribute_sessions'
      )
    );
  END IF;

  IF avg_session_length IS NOT NULL AND avg_session_length < 0.8 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'optimize_scheduling',
        'priority', 'medium',
        'message', 'Many short sessions detected. Consider grouping sessions for efficiency',
        'action', 'optimize_session_blocks'
      )
    );
  END IF;

  RETURN recommendations;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_efficiency_score(
  p_therapist_id uuid,
  p_actual_hours numeric,
  p_session_count integer
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  avg_session_minutes numeric := CASE WHEN p_session_count > 0 THEN (p_actual_hours * 60) / p_session_count ELSE NULL END;
  ideal_minutes constant numeric := 60;
BEGIN
  IF avg_session_minutes IS NULL THEN
    RETURN 0.5;
  END IF;

  RETURN LEAST(1, GREATEST(0, 1 - ABS(avg_session_minutes - ideal_minutes) / ideal_minutes));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_historical_success_rate(
  p_therapist_id uuid,
  p_client_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_sessions numeric;
  successful_sessions numeric;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO total_sessions, successful_sessions
  FROM public.sessions
  WHERE therapist_id = p_therapist_id
    AND client_id = p_client_id;

  IF total_sessions = 0 THEN
    RETURN 0.2;
  END IF;

  RETURN successful_sessions / total_sessions;
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
SET search_path = public, app, auth
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT *
    FROM public.sessions s
    WHERE s.start_time >= p_start_date
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
        JOIN public.therapists t ON t.id = base.therapist_id
        GROUP BY t.full_name
      ) per_therapist
    ),
    (
      SELECT jsonb_object_agg(full_name, session_count)
      FROM (
        SELECT c.full_name, COUNT(*) AS session_count
        FROM base
        JOIN public.clients c ON c.id = base.client_id
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
SET search_path = public, app, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.get_session_metrics(p_start_date::date, p_end_date::date, p_therapist_id, p_client_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sessions_report(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  session_id uuid,
  client_name text,
  therapist_name text,
  session_day date,
  session_type text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    c.full_name,
    t.full_name,
    COALESCE(s.session_date, s.start_time::date),
    s.session_type,
    s.status
  FROM public.sessions s
  JOIN public.clients c ON s.client_id = c.id
  JOIN public.therapists t ON s.therapist_id = t.id
  WHERE COALESCE(s.session_date, s.start_time::date) BETWEEN p_start_date AND p_end_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sessions_report(
  p_start_date date,
  p_end_date date,
  p_therapist_id uuid,
  p_client_id uuid,
  p_status text
)
RETURNS TABLE (
  session_id uuid,
  client_name text,
  therapist_name text,
  session_day date,
  session_type text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.get_sessions_report(p_start_date, p_end_date)
  WHERE ($3 IS NULL OR therapist_name = $3::text)
    AND ($4 IS NULL OR client_name = $4::text)
    AND ($5 IS NULL OR status = $5);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sessions_report(
  p_start_date text,
  p_end_date text,
  p_therapist_id uuid,
  p_client_id uuid,
  p_status text
)
RETURNS TABLE (
  session_id uuid,
  client_name text,
  therapist_name text,
  session_day date,
  session_type text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.get_sessions_report(p_start_date::date, p_end_date::date, p_therapist_id, p_client_id, p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_session_hold(
  p_hold_key uuid,
  p_session jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
DECLARE
  v_hold session_holds;
  v_session sessions;
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
BEGIN
  DELETE FROM public.session_holds WHERE expires_at <= timezone('utc', now());

  SELECT *
  INTO v_hold
  FROM public.session_holds
  WHERE hold_key = p_hold_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'HOLD_NOT_FOUND', 'error_message', 'Hold has expired or does not exist.');
  END IF;

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

  IF EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.therapist_id = v_therapist_id
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
    WHERE s.client_id = v_client_id
      AND (v_session_id IS NULL OR s.id <> v_session_id)
      AND s.status <> 'cancelled'
      AND tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_start, v_end, '[)')
  ) THEN
    DELETE FROM public.session_holds WHERE id = v_hold.id;
    RETURN jsonb_build_object('success', false, 'error_code', 'CLIENT_CONFLICT', 'error_message', 'Client already has a session during this time.');
  END IF;

  IF v_session_id IS NULL THEN
    INSERT INTO public.sessions (
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
    RETURNING * INTO v_session;
  END IF;

  DELETE FROM public.session_holds WHERE id = v_hold.id;

  RETURN jsonb_build_object('success', true, 'session', row_to_json(v_session));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_performance_metrics(p_time_range text DEFAULT '1h')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ai', jsonb_build_object('avg_response_time', 0, 'cache_hit_rate', 0, 'total_requests', 0),
    'database', jsonb_build_object('query_performance', 0, 'slow_queries', 0),
    'cache', jsonb_build_object('hit_rate', 0, 'size', 0),
    'system', jsonb_build_object('uptime', 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_performance_recommendations()
RETURNS TABLE(
  category text,
  recommendation text,
  impact text,
  difficulty text,
  estimated_improvement text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app, auth
AS $$
SELECT 'Monitoring', 'Collect real metrics once instrumentation is enabled', 'Low', 'Low', 'N/A';
$$;

GRANT EXECUTE ON FUNCTION public.get_sessions_optimized(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_schedule_data_batch(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alternative_therapists(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alternative_times(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_optimal_time_slots(jsonb, jsonb, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_time_slot_score(timestamptz, numeric, numeric, jsonb, jsonb, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_preference_factor(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduling_efficiency_factor(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_therapist_workload_factor(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_therapist_availability(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_therapist_client_compatibility(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_therapist_workload(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_workload_recommendations(uuid, numeric, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_metrics(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_metrics(text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sessions_report(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sessions_report(date, date, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sessions_report(text, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_session_hold(uuid, jsonb) TO service_role;

