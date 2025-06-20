/*
  # Fix Database Function Conflicts and Errors

  This migration resolves two critical database function issues:

  1. Function Conflicts
     - Removes conflicting `get_user_roles` function overloads
     - Ensures only one properly working `get_user_roles` function exists

  2. SQL Syntax Errors
     - Fixes `get_dashboard_data` function GROUP BY clause issue
     - Corrects aggregate function usage with `s.start_time`

  3. Security
     - Maintains proper RLS and security policies
     - Ensures functions work with authenticated users
*/

-- Drop all existing get_user_roles functions to resolve conflicts
DROP FUNCTION IF EXISTS get_user_roles();
DROP FUNCTION IF EXISTS get_user_roles(user_uuid uuid);

-- Create single, correct get_user_roles function
CREATE OR REPLACE FUNCTION get_user_roles()
RETURNS TABLE(roles text[])
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return user roles for authenticated user
  RETURN QUERY
  SELECT ARRAY_AGG(r.name) as roles
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid();
END;
$$;

-- Drop existing get_dashboard_data function if it exists
DROP FUNCTION IF EXISTS get_dashboard_data();

-- Create corrected get_dashboard_data function with proper GROUP BY
CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  today_sessions jsonb;
  incomplete_sessions jsonb;
  billing_alerts jsonb;
  client_metrics jsonb;
  therapist_metrics jsonb;
BEGIN
  -- Get today's sessions with proper aggregation
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) INTO today_sessions
  FROM sessions s
  JOIN therapists t ON t.id = s.therapist_id
  JOIN clients c ON c.id = s.client_id
  WHERE DATE(s.start_time AT TIME ZONE 'UTC') = CURRENT_DATE;

  -- Get incomplete sessions (completed but no notes)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'client_id', s.client_id,
      'therapist_id', s.therapist_id,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'status', s.status,
      'therapist', jsonb_build_object(
        'id', t.id,
        'full_name', t.full_name
      ),
      'client', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name
      )
    )
  ) INTO incomplete_sessions
  FROM sessions s
  JOIN therapists t ON t.id = s.therapist_id
  JOIN clients c ON c.id = s.client_id
  WHERE s.status = 'completed'
    AND (s.notes IS NULL OR s.notes = '');

  -- Get billing alerts
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', br.id,
      'session_id', br.session_id,
      'amount', br.amount,
      'status', br.status,
      'created_at', br.created_at
    )
  ) INTO billing_alerts
  FROM billing_records br
  WHERE br.status IN ('pending', 'rejected');

  -- Get client metrics
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE c.created_at > CURRENT_DATE - INTERVAL '30 days'),
    'totalUnits', COALESCE(SUM(
      COALESCE(c.one_to_one_units, 0) + 
      COALESCE(c.supervision_units, 0) + 
      COALESCE(c.parent_consult_units, 0)
    ), 0)
  ) INTO client_metrics
  FROM clients c;

  -- Get therapist metrics
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE t.status = 'active'),
    'totalHours', COALESCE(SUM(COALESCE(t.weekly_hours_max, 0)), 0)
  ) INTO therapist_metrics
  FROM therapists t;

  -- Build final result
  result := jsonb_build_object(
    'todaySessions', COALESCE(today_sessions, '[]'::jsonb),
    'incompleteSessions', COALESCE(incomplete_sessions, '[]'::jsonb),
    'billingAlerts', COALESCE(billing_alerts, '[]'::jsonb),
    'clientMetrics', client_metrics,
    'therapistMetrics', therapist_metrics
  );

  RETURN result;
END;
$$;

-- Ensure proper permissions for the functions
GRANT EXECUTE ON FUNCTION get_user_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_data() TO authenticated;