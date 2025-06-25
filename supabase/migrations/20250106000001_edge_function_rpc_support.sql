-- Migration: Add RPC functions for edge function support
-- Created for edge functions: generate-report, ai-agent-optimized
-- Date: 2025-01-06

-- ============================================================================
-- DROP EXISTING FUNCTIONS (if they exist with different signatures)
-- ============================================================================
DROP FUNCTION IF EXISTS get_sessions_report(DATE, DATE, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS get_client_metrics(DATE, DATE);
DROP FUNCTION IF EXISTS get_therapist_metrics(DATE, DATE);
DROP FUNCTION IF EXISTS get_authorization_metrics(DATE, DATE);
DROP FUNCTION IF EXISTS get_billing_metrics(DATE, DATE);

-- Also drop any variants that might exist
DROP FUNCTION IF EXISTS get_sessions_report;
DROP FUNCTION IF EXISTS get_client_metrics;
DROP FUNCTION IF EXISTS get_therapist_metrics;
DROP FUNCTION IF EXISTS get_authorization_metrics;
DROP FUNCTION IF EXISTS get_billing_metrics;

-- ============================================================================
-- RPC FUNCTION: get_sessions_report
-- Used by: generate-report edge function
-- ============================================================================
CREATE FUNCTION get_sessions_report(
  p_start_date DATE,
  p_end_date DATE,
  p_therapist_id UUID DEFAULT NULL,
  p_client_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  therapist_id UUID,
  client_id UUID,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status TEXT,
  location_type TEXT,
  therapist_name TEXT,
  client_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.therapist_id,
    s.client_id,
    s.start_time,
    s.end_time,
    s.status,
    s.location_type,
    t.full_name as therapist_name,
    c.full_name as client_name,
    s.created_at,
    s.updated_at
  FROM sessions s
  LEFT JOIN therapists t ON s.therapist_id = t.id
  LEFT JOIN clients c ON s.client_id = c.id
  WHERE s.start_time >= p_start_date::timestamptz
    AND s.start_time <= (p_end_date::timestamptz + interval '1 day - 1 second')
    AND (p_therapist_id IS NULL OR s.therapist_id = p_therapist_id)
    AND (p_client_id IS NULL OR s.client_id = p_client_id)
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY s.start_time ASC;
END;
$$;

-- ============================================================================
-- RPC FUNCTION: get_client_metrics
-- Used by: generate-report edge function
-- ============================================================================
CREATE FUNCTION get_client_metrics(
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE (
  client_id UUID,
  client_name TEXT,
  total_sessions BIGINT,
  completed_sessions BIGINT,
  cancelled_sessions BIGINT,
  no_show_sessions BIGINT,
  completion_rate NUMERIC,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH session_stats AS (
    SELECT 
      s.client_id,
      c.full_name as client_name,
      c.created_at,
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE s.status = 'completed') as completed_sessions,
      COUNT(*) FILTER (WHERE s.status = 'cancelled') as cancelled_sessions,
      COUNT(*) FILTER (WHERE s.status = 'no-show') as no_show_sessions
    FROM sessions s
    LEFT JOIN clients c ON s.client_id = c.id
    WHERE s.start_time >= p_start_date::timestamptz
      AND s.start_time <= (p_end_date::timestamptz + interval '1 day - 1 second')
    GROUP BY s.client_id, c.full_name, c.created_at
  )
  SELECT 
    ss.client_id,
    ss.client_name,
    ss.total_sessions,
    ss.completed_sessions,
    ss.cancelled_sessions,
    ss.no_show_sessions,
    CASE 
      WHEN ss.total_sessions > 0 THEN ROUND((ss.completed_sessions::numeric / ss.total_sessions::numeric) * 100, 2)
      ELSE 0
    END as completion_rate,
    ss.created_at
  FROM session_stats ss
  ORDER BY ss.total_sessions DESC;
END;
$$;

-- ============================================================================
-- RPC FUNCTION: get_therapist_metrics
-- Used by: generate-report edge function
-- ============================================================================
CREATE FUNCTION get_therapist_metrics(
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE (
  therapist_id UUID,
  therapist_name TEXT,
  service_types TEXT[],
  total_sessions BIGINT,
  completed_sessions BIGINT,
  cancelled_sessions BIGINT,
  no_show_sessions BIGINT,
  completion_rate NUMERIC,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH session_stats AS (
    SELECT 
      s.therapist_id,
      t.full_name as therapist_name,
      t.service_type,
      t.created_at,
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE s.status = 'completed') as completed_sessions,
      COUNT(*) FILTER (WHERE s.status = 'cancelled') as cancelled_sessions,
      COUNT(*) FILTER (WHERE s.status = 'no-show') as no_show_sessions
    FROM sessions s
    LEFT JOIN therapists t ON s.therapist_id = t.id
    WHERE s.start_time >= p_start_date::timestamptz
      AND s.start_time <= (p_end_date::timestamptz + interval '1 day - 1 second')
    GROUP BY s.therapist_id, t.full_name, t.service_type, t.created_at
  )
  SELECT 
    ss.therapist_id,
    ss.therapist_name,
    ss.service_type,
    ss.total_sessions,
    ss.completed_sessions,
    ss.cancelled_sessions,
    ss.no_show_sessions,
    CASE 
      WHEN ss.total_sessions > 0 THEN ROUND((ss.completed_sessions::numeric / ss.total_sessions::numeric) * 100, 2)
      ELSE 0
    END as completion_rate,
    ss.created_at
  FROM session_stats ss
  ORDER BY ss.total_sessions DESC;
END;
$$;

-- ============================================================================
-- RPC FUNCTION: get_authorization_metrics
-- Used by: generate-report edge function
-- ============================================================================
CREATE FUNCTION get_authorization_metrics(
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE (
  total_authorizations BIGINT,
  active_authorizations BIGINT,
  expired_authorizations BIGINT,
  pending_authorizations BIGINT,
  expiring_soon BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_authorizations,
    COUNT(*) FILTER (WHERE status = 'active') as active_authorizations,
    COUNT(*) FILTER (WHERE status = 'expired') as expired_authorizations,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_authorizations,
    COUNT(*) FILTER (WHERE status = 'active' AND end_date <= CURRENT_DATE + interval '30 days') as expiring_soon
  FROM authorizations
  WHERE created_at >= p_start_date::timestamptz
    AND created_at <= (p_end_date::timestamptz + interval '1 day - 1 second');
END;
$$;

-- ============================================================================
-- RPC FUNCTION: get_billing_metrics
-- Used by: generate-report edge function
-- ============================================================================
CREATE FUNCTION get_billing_metrics(
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE (
  total_sessions BIGINT,
  billable_sessions BIGINT,
  total_revenue NUMERIC,
  average_session_rate NUMERIC,
  pending_billing BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH billing_data AS (
    SELECT 
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE status = 'completed') as billable_sessions,
      -- Assuming a default rate of $150 per session if no billing rate is set
      SUM(CASE WHEN status = 'completed' THEN COALESCE(150, 150) ELSE 0 END) as total_revenue,
      COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= CURRENT_DATE - interval '30 days') as pending_billing
    FROM sessions
    WHERE start_time >= p_start_date::timestamptz
      AND start_time <= (p_end_date::timestamptz + interval '1 day - 1 second')
  )
  SELECT 
    bd.total_sessions,
    bd.billable_sessions,
    bd.total_revenue,
    CASE 
      WHEN bd.billable_sessions > 0 THEN ROUND(bd.total_revenue / bd.billable_sessions, 2)
      ELSE 0
    END as average_session_rate,
    bd.pending_billing
  FROM billing_data bd;
END;
$$;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_sessions_report(DATE, DATE, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_client_metrics(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_therapist_metrics(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_authorization_metrics(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_billing_metrics(DATE, DATE) TO authenticated;

-- Grant execute permissions to service role (for edge functions)
GRANT EXECUTE ON FUNCTION get_sessions_report(DATE, DATE, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_client_metrics(DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_therapist_metrics(DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_authorization_metrics(DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_billing_metrics(DATE, DATE) TO service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON FUNCTION get_sessions_report IS 'Get detailed session reports with filters for date range, therapist, client, and status';
COMMENT ON FUNCTION get_client_metrics IS 'Get client metrics including session counts and completion rates';
COMMENT ON FUNCTION get_therapist_metrics IS 'Get therapist metrics including session counts and completion rates';
COMMENT ON FUNCTION get_authorization_metrics IS 'Get authorization metrics including counts by status';
COMMENT ON FUNCTION get_billing_metrics IS 'Get billing metrics including revenue and session counts'; 