/*
  # Fix dashboard data function

  1. Changes
     - Drop existing get_dashboard_data function
     - Create new get_dashboard_data function with proper GROUP BY clause
     - Fix SQL error related to column "s.start_time" in GROUP BY
  
  2. Security
     - Maintains SECURITY DEFINER setting
*/

-- First drop the existing function
DROP FUNCTION IF EXISTS get_dashboard_data();

-- Then create the new function with the fixed implementation
CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS TABLE (
  date date,
  total_sessions bigint,
  completed_sessions bigint,
  cancelled_sessions bigint,
  total_hours numeric,
  utilization_rate numeric
) 
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH daily_stats AS (
    SELECT 
      DATE(s.start_time) as session_date,
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE s.status = 'completed') as completed_sessions,
      COUNT(*) FILTER (WHERE s.status = 'cancelled') as cancelled_sessions,
      SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0) as total_hours
    FROM sessions s
    WHERE 
      s.start_time >= CURRENT_DATE - INTERVAL '30 days'
      AND s.start_time < CURRENT_DATE + INTERVAL '1 day'
    GROUP BY DATE(s.start_time)
  )
  SELECT
    ds.session_date as date,
    ds.total_sessions,
    ds.completed_sessions,
    ds.cancelled_sessions,
    ROUND(ds.total_hours::numeric, 2) as total_hours,
    ROUND((ds.completed_sessions::numeric / NULLIF(ds.total_sessions, 0) * 100)::numeric, 2) as utilization_rate
  FROM daily_stats ds
  ORDER BY ds.session_date DESC;
END;
$$;