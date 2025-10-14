/*
  # Harden get_dashboard_data RPC

  - Rewrites get_dashboard_data to run as SECURITY INVOKER and respect RLS via explicit organization filters.
  - Requires callers to provide an organization context; raises if unavailable.
  - Limits EXECUTE to least-privilege roles, creating dashboard_consumer role if needed.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_consumer'
  ) THEN
    CREATE ROLE dashboard_consumer;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org uuid;
  result jsonb;
  today_sessions jsonb;
  incomplete_sessions jsonb;
  billing_alerts jsonb;
  client_metrics jsonb;
  therapist_metrics jsonb;
BEGIN
  SET LOCAL row_security = on;

  v_org := app.current_user_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization context required';
  END IF;

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
  WHERE s.organization_id = v_org
    AND t.organization_id = v_org
    AND c.organization_id = v_org
    AND DATE(s.start_time AT TIME ZONE 'UTC') = CURRENT_DATE;

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
  WHERE s.organization_id = v_org
    AND t.organization_id = v_org
    AND c.organization_id = v_org
    AND s.status = 'completed'
    AND (s.notes IS NULL OR s.notes = '');

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
  WHERE br.organization_id = v_org
    AND br.status IN ('pending', 'rejected');

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE c.created_at > CURRENT_DATE - INTERVAL '30 days'),
    'totalUnits', COALESCE(SUM(
      COALESCE(c.one_to_one_units, 0) +
      COALESCE(c.supervision_units, 0) +
      COALESCE(c.parent_consult_units, 0)
    ), 0)
  ) INTO client_metrics
  FROM clients c
  WHERE c.organization_id = v_org;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE t.status = 'active'),
    'totalHours', COALESCE(SUM(COALESCE(t.weekly_hours_max, 0)), 0)
  ) INTO therapist_metrics
  FROM therapists t
  WHERE t.organization_id = v_org;

  result := jsonb_build_object(
    'todaySessions', COALESCE(today_sessions, '[]'::jsonb),
    'incompleteSessions', COALESCE(incomplete_sessions, '[]'::jsonb),
    'billingAlerts', COALESCE(billing_alerts, '[]'::jsonb),
    'clientMetrics', COALESCE(client_metrics, '{}'::jsonb),
    'therapistMetrics', COALESCE(therapist_metrics, '{}'::jsonb)
  );

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_data() FROM authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_data() TO dashboard_consumer;
GRANT EXECUTE ON FUNCTION get_dashboard_data() TO service_role;
