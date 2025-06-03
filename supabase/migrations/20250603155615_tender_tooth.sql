/*
  # Create Optimized Query Functions

  1. Functions
    - `get_sessions_optimized` - Optimized session fetching with joins
    - `get_schedule_data_batch` - Batched schedule data fetching
    - `get_dropdown_data` - Lightweight dropdown data
    - `get_session_metrics` - Database-level aggregations for reports
    - `get_dashboard_data` - Batched dashboard metrics
*/

-- Function to get optimized sessions with joins
CREATE OR REPLACE FUNCTION get_sessions_optimized(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_therapist_id UUID DEFAULT NULL,
  p_client_id UUID DEFAULT NULL
)
RETURNS TABLE (
  session_data JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', s.id,
    'start_time', s.start_time,
    'end_time', s.end_time,
    'status', s.status,
    'notes', s.notes,
    'created_at', s.created_at,
    'therapist_id', s.therapist_id,
    'client_id', s.client_id,
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
  ) as session_data
  FROM sessions s
  JOIN therapists t ON s.therapist_id = t.id
  JOIN clients c ON s.client_id = c.id
  WHERE s.start_time >= p_start_date
    AND s.start_time <= p_end_date
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
  ORDER BY s.start_time;
END;
$$;

-- Function to get batched schedule data
CREATE OR REPLACE FUNCTION get_schedule_data_batch(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sessions JSONB;
  v_therapists JSONB;
  v_clients JSONB;
BEGIN
  -- Get sessions
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'notes', s.notes,
      'created_at', s.created_at,
      'therapist_id', s.therapist_id,
      'client_id', s.client_id,
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
  JOIN therapists t ON s.therapist_id = t.id
  JOIN clients c ON s.client_id = c.id
  WHERE s.start_time >= p_start_date
    AND s.start_time <= p_end_date;
  
  -- Get therapists
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
  WHERE t.status = 'active';
  
  -- Get clients
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
  FROM clients c;
  
  -- Return combined data
  RETURN jsonb_build_object(
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb)
  );
END;
$$;

-- Function to get dropdown data
CREATE OR REPLACE FUNCTION get_dropdown_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_therapists JSONB;
  v_clients JSONB;
  v_locations JSONB;
  v_service_lines JSONB;
BEGIN
  -- Get therapists for dropdowns
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'full_name', t.full_name
    )
  )
  INTO v_therapists
  FROM therapists t
  WHERE t.status = 'active'
  ORDER BY t.full_name;
  
  -- Get clients for dropdowns
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'full_name', c.full_name
    )
  )
  INTO v_clients
  FROM clients c
  ORDER BY c.full_name;
  
  -- Get locations for dropdowns
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name
    )
  )
  INTO v_locations
  FROM locations l
  WHERE l.is_active = true
  ORDER BY l.name;
  
  -- Get service lines for dropdowns
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sl.id,
      'name', sl.name
    )
  )
  INTO v_service_lines
  FROM service_lines sl
  WHERE sl.is_active = true
  ORDER BY sl.name;
  
  -- Return combined data
  RETURN jsonb_build_object(
    'therapists', COALESCE(v_therapists, '[]'::jsonb),
    'clients', COALESCE(v_clients, '[]'::jsonb),
    'locations', COALESCE(v_locations, '[]'::jsonb),
    'service_lines', COALESCE(v_service_lines, '[]'::jsonb)
  );
END;
$$;

-- Function to get session metrics for reports
CREATE OR REPLACE FUNCTION get_session_metrics(
  p_start_date TEXT,
  p_end_date TEXT,
  p_therapist_id UUID DEFAULT NULL,
  p_client_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_sessions INTEGER;
  v_completed_sessions INTEGER;
  v_cancelled_sessions INTEGER;
  v_no_show_sessions INTEGER;
  v_sessions_by_therapist JSONB;
  v_sessions_by_client JSONB;
  v_sessions_by_day_of_week JSONB;
  v_raw_data JSONB;
BEGIN
  -- Get total sessions
  SELECT COUNT(*)
  INTO v_total_sessions
  FROM sessions s
  WHERE s.start_time >= p_start_date::timestamptz
    AND s.start_time <= p_end_date::timestamptz
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id);
  
  -- Get completed sessions
  SELECT COUNT(*)
  INTO v_completed_sessions
  FROM sessions s
  WHERE s.start_time >= p_start_date::timestamptz
    AND s.start_time <= p_end_date::timestamptz
    AND s.status = 'completed'
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id);
  
  -- Get cancelled sessions
  SELECT COUNT(*)
  INTO v_cancelled_sessions
  FROM sessions s
  WHERE s.start_time >= p_start_date::timestamptz
    AND s.start_time <= p_end_date::timestamptz
    AND s.status = 'cancelled'
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id);
  
  -- Get no-show sessions
  SELECT COUNT(*)
  INTO v_no_show_sessions
  FROM sessions s
  WHERE s.start_time >= p_start_date::timestamptz
    AND s.start_time <= p_end_date::timestamptz
    AND s.status = 'no-show'
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id);
  
  -- Get sessions by therapist
  SELECT jsonb_object_agg(t.full_name, count)
  INTO v_sessions_by_therapist
  FROM (
    SELECT t.full_name, COUNT(*) as count
    FROM sessions s
    JOIN therapists t ON s.therapist_id = t.id
    WHERE s.start_time >= p_start_date::timestamptz
      AND s.start_time <= p_end_date::timestamptz
      AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
    GROUP BY t.full_name
  ) t;
  
  -- Get sessions by client
  SELECT jsonb_object_agg(c.full_name, count)
  INTO v_sessions_by_client
  FROM (
    SELECT c.full_name, COUNT(*) as count
    FROM sessions s
    JOIN clients c ON s.client_id = c.id
    WHERE s.start_time >= p_start_date::timestamptz
      AND s.start_time <= p_end_date::timestamptz
      AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
    GROUP BY c.full_name
  ) c;
  
  -- Get sessions by day of week
  SELECT jsonb_object_agg(day_of_week, count)
  INTO v_sessions_by_day_of_week
  FROM (
    SELECT 
      to_char(s.start_time, 'Day') as day_of_week,
      COUNT(*) as count
    FROM sessions s
    WHERE s.start_time >= p_start_date::timestamptz
      AND s.start_time <= p_end_date::timestamptz
      AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
    GROUP BY day_of_week
    ORDER BY CASE
      WHEN to_char(s.start_time, 'Day') = 'Monday    ' THEN 1
      WHEN to_char(s.start_time, 'Day') = 'Tuesday   ' THEN 2
      WHEN to_char(s.start_time, 'Day') = 'Wednesday ' THEN 3
      WHEN to_char(s.start_time, 'Day') = 'Thursday  ' THEN 4
      WHEN to_char(s.start_time, 'Day') = 'Friday    ' THEN 5
      WHEN to_char(s.start_time, 'Day') = 'Saturday  ' THEN 6
      WHEN to_char(s.start_time, 'Day') = 'Sunday    ' THEN 7
    END
  ) d;
  
  -- Get raw session data
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object('id', t.id, 'full_name', t.full_name),
      'client', jsonb_build_object('id', c.id, 'full_name', c.full_name)
    )
  )
  INTO v_raw_data
  FROM sessions s
  JOIN therapists t ON s.therapist_id = t.id
  JOIN clients c ON s.client_id = c.id
  WHERE s.start_time >= p_start_date::timestamptz
    AND s.start_time <= p_end_date::timestamptz
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
  ORDER BY s.start_time;
  
  -- Return metrics
  RETURN jsonb_build_object(
    'totalSessions', v_total_sessions,
    'completedSessions', v_completed_sessions,
    'cancelledSessions', v_cancelled_sessions,
    'noShowSessions', v_no_show_sessions,
    'completionRate', CASE WHEN v_total_sessions > 0 THEN 
      (v_completed_sessions::numeric / v_total_sessions::numeric) * 100 
    ELSE 0 END,
    'sessionsByTherapist', COALESCE(v_sessions_by_therapist, '{}'::jsonb),
    'sessionsByClient', COALESCE(v_sessions_by_client, '{}'::jsonb),
    'sessionsByDayOfWeek', COALESCE(v_sessions_by_day_of_week, '{}'::jsonb),
    'rawData', COALESCE(v_raw_data, '[]'::jsonb)
  );
END;
$$;

-- Function to get dashboard data
CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_tomorrow DATE := CURRENT_DATE + 1;
  v_today_sessions JSONB;
  v_incomplete_sessions JSONB;
  v_billing_alerts JSONB;
  v_client_metrics JSONB;
  v_therapist_metrics JSONB;
BEGIN
  -- Get today's sessions
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object('id', t.id, 'full_name', t.full_name),
      'client', jsonb_build_object('id', c.id, 'full_name', c.full_name)
    )
  )
  INTO v_today_sessions
  FROM sessions s
  JOIN therapists t ON s.therapist_id = t.id
  JOIN clients c ON s.client_id = c.id
  WHERE s.start_time::date = v_today
  ORDER BY s.start_time;
  
  -- Get incomplete sessions (completed but no notes)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object('id', t.id, 'full_name', t.full_name),
      'client', jsonb_build_object('id', c.id, 'full_name', c.full_name)
    )
  )
  INTO v_incomplete_sessions
  FROM sessions s
  JOIN therapists t ON s.therapist_id = t.id
  JOIN clients c ON s.client_id = c.id
  WHERE s.status = 'completed'
    AND (s.notes IS NULL OR s.notes = '')
  ORDER BY s.start_time DESC
  LIMIT 10;
  
  -- Get billing alerts
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'amount', b.amount,
      'status', b.status,
      'created_at', b.created_at
    )
  )
  INTO v_billing_alerts
  FROM billing_records b
  WHERE b.status IN ('pending', 'rejected')
  ORDER BY b.created_at DESC
  LIMIT 10;
  
  -- Get client metrics
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE c.created_at >= (CURRENT_DATE - INTERVAL '30 days')),
    'totalUnits', SUM(COALESCE(c.one_to_one_units, 0) + COALESCE(c.supervision_units, 0) + COALESCE(c.parent_consult_units, 0))
  )
  INTO v_client_metrics
  FROM clients c;
  
  -- Get therapist metrics
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE t.status = 'active'),
    'totalHours', SUM(COALESCE(t.weekly_hours_max, 40))
  )
  INTO v_therapist_metrics
  FROM therapists t;
  
  -- Return dashboard data
  RETURN jsonb_build_object(
    'todaySessions', COALESCE(v_today_sessions, '[]'::jsonb),
    'incompleteSessions', COALESCE(v_incomplete_sessions, '[]'::jsonb),
    'billingAlerts', COALESCE(v_billing_alerts, '[]'::jsonb),
    'clientMetrics', COALESCE(v_client_metrics, '{}'::jsonb),
    'therapistMetrics', COALESCE(v_therapist_metrics, '{}'::jsonb)
  );
END;
$$;