/*
  # Create Performance Monitoring Functions

  1. Functions
    - `log_function_performance` - Logs performance metrics for function calls
    - `get_performance_metrics` - Gets performance metrics for the system
    - `check_performance_thresholds` - Checks if performance metrics exceed thresholds
    - `detect_scheduling_conflicts` - Detects scheduling conflicts
*/

-- Function to log performance metrics
CREATE OR REPLACE FUNCTION log_function_performance(
  p_function_name TEXT,
  p_execution_time_ms DOUBLE PRECISION,
  p_parameters JSONB DEFAULT NULL,
  p_result_size INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO function_performance_logs (
    function_name,
    execution_time_ms,
    parameters,
    result_size,
    executed_by,
    executed_at
  ) VALUES (
    p_function_name,
    p_execution_time_ms,
    p_parameters,
    p_result_size,
    auth.uid(),
    now()
  );
END;
$$;

-- Function to get performance metrics
CREATE OR REPLACE FUNCTION get_performance_metrics(
  p_time_range TEXT DEFAULT '1h'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_metrics JSONB;
BEGIN
  -- Determine the start time based on the time range
  CASE p_time_range
    WHEN '1h' THEN v_start_time := now() - interval '1 hour';
    WHEN '24h' THEN v_start_time := now() - interval '24 hours';
    WHEN '7d' THEN v_start_time := now() - interval '7 days';
    ELSE v_start_time := now() - interval '1 hour';
  END CASE;
  
  -- AI metrics
  WITH ai_metrics AS (
    SELECT
      COALESCE(AVG((metadata->>'responseTime')::numeric), 0) AS avg_response_time,
      COALESCE(
        SUM(CASE WHEN metadata->>'cacheHit' = 'true' THEN 1 ELSE 0 END)::numeric / 
        NULLIF(COUNT(*), 0), 
        0
      ) AS cache_hit_rate,
      COUNT(*) AS total_requests,
      COALESCE(
        SUM(CASE WHEN metadata->>'error' IS NOT NULL THEN 1 ELSE 0 END)::numeric / 
        NULLIF(COUNT(*), 0),
        0
      ) AS error_rate,
      COALESCE(SUM((metadata->'tokenUsage'->>'total')::numeric), 0) AS token_usage,
      COALESCE(SUM(
        CASE 
          WHEN metadata->>'cacheHit' = 'true' 
          THEN (metadata->'tokenUsage'->>'total')::numeric * 0.00002 
          ELSE 0 
        END
      ), 0) AS cost_savings
    FROM ai_response_cache
    WHERE created_at >= v_start_time
  ),
  
  -- Database metrics
  db_metrics AS (
    SELECT
      COALESCE(AVG(execution_time_ms), 0) AS query_performance,
      COALESCE(
        SUM(CASE WHEN execution_time_ms < 100 THEN 1 ELSE 0 END)::numeric / 
        NULLIF(COUNT(*), 0),
        0
      ) AS cache_efficiency,
      (SELECT COUNT(*) FROM pg_stat_activity) AS connection_pool,
      COUNT(*) FILTER (WHERE execution_time_ms > 1000) AS slow_queries
    FROM function_performance_logs
    WHERE executed_at >= v_start_time
  ),
  
  -- Cache metrics
  cache_metrics AS (
    SELECT
      (SELECT hit_rate FROM get_ai_cache_metrics()) AS hit_rate,
      (SELECT cache_size_mb FROM get_ai_cache_metrics()) AS size,
      (SELECT total_entries FROM get_ai_cache_metrics()) AS entries,
      (SELECT expired_entries FROM get_ai_cache_metrics()) AS cleanup
    FROM (SELECT 1) AS t
  ),
  
  -- System metrics
  system_metrics AS (
    SELECT
      50 AS cpu_usage, -- Placeholder, would be from a monitoring system
      60 AS memory_usage, -- Placeholder
      (SELECT COALESCE(AVG(execution_time_ms), 0) FROM function_performance_logs WHERE executed_at >= v_start_time) AS response_time,
      extract(epoch from (now() - (SELECT MIN(created_at) FROM function_performance_logs))) / 3600 AS uptime
    FROM (SELECT 1) AS t
  )
  
  -- Combine all metrics
  SELECT jsonb_build_object(
    'ai', (SELECT row_to_json(ai_metrics) FROM ai_metrics),
    'database', (SELECT row_to_json(db_metrics) FROM db_metrics),
    'cache', (SELECT row_to_json(cache_metrics) FROM cache_metrics),
    'system', (SELECT row_to_json(system_metrics) FROM system_metrics)
  ) INTO v_metrics;
  
  RETURN v_metrics;
END;
$$;

-- Function to check performance thresholds
CREATE OR REPLACE FUNCTION check_performance_thresholds(
  p_metric_name TEXT,
  p_current_value NUMERIC
)
RETURNS TABLE (
  metric TEXT,
  current_value NUMERIC,
  threshold NUMERIC,
  status TEXT,
  severity TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_threshold NUMERIC;
  v_status TEXT;
  v_severity TEXT;
BEGIN
  -- Define thresholds for different metrics
  CASE p_metric_name
    WHEN 'ai_response_time' THEN
      v_threshold := 750; -- ms
      v_status := CASE WHEN p_current_value > v_threshold THEN 'exceeded' ELSE 'normal' END;
      v_severity := CASE 
        WHEN p_current_value > v_threshold * 2 THEN 'critical'
        WHEN p_current_value > v_threshold THEN 'high'
        ELSE 'normal'
      END;
    
    WHEN 'ai_cache_hit_rate' THEN
      v_threshold := 0.7; -- 70%
      v_status := CASE WHEN p_current_value < v_threshold THEN 'below' ELSE 'normal' END;
      v_severity := CASE 
        WHEN p_current_value < v_threshold * 0.5 THEN 'critical'
        WHEN p_current_value < v_threshold THEN 'high'
        ELSE 'normal'
      END;
    
    WHEN 'db_query_time' THEN
      v_threshold := 300; -- ms
      v_status := CASE WHEN p_current_value > v_threshold THEN 'exceeded' ELSE 'normal' END;
      v_severity := CASE 
        WHEN p_current_value > v_threshold * 2 THEN 'critical'
        WHEN p_current_value > v_threshold THEN 'high'
        ELSE 'normal'
      END;
    
    WHEN 'cache_hit_rate' THEN
      v_threshold := 0.6; -- 60%
      v_status := CASE WHEN p_current_value < v_threshold THEN 'below' ELSE 'normal' END;
      v_severity := CASE 
        WHEN p_current_value < v_threshold * 0.5 THEN 'critical'
        WHEN p_current_value < v_threshold THEN 'high'
        ELSE 'normal'
      END;
    
    ELSE
      v_threshold := 0;
      v_status := 'unknown';
      v_severity := 'unknown';
  END CASE;
  
  -- Log the threshold check if it's not normal
  IF v_status != 'normal' THEN
    INSERT INTO function_performance_logs (
      function_name,
      execution_time_ms,
      parameters,
      executed_at
    ) VALUES (
      'check_performance_thresholds',
      0,
      jsonb_build_object(
        'metric', p_metric_name,
        'value', p_current_value,
        'threshold', v_threshold,
        'status', v_status,
        'severity', v_severity
      ),
      now()
    );
  END IF;
  
  RETURN QUERY SELECT 
    p_metric_name,
    p_current_value,
    v_threshold,
    v_status,
    v_severity;
END;
$$;

-- Function to detect scheduling conflicts
CREATE OR REPLACE FUNCTION detect_scheduling_conflicts(
  p_start_date DATE,
  p_end_date DATE,
  p_include_suggestions BOOLEAN DEFAULT false
)
RETURNS TABLE (
  conflict_id UUID,
  conflict_type TEXT,
  severity INTEGER,
  affected_sessions JSONB,
  suggested_resolutions JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH overlapping_sessions AS (
    SELECT 
      s1.id as session1_id,
      s2.id as session2_id,
      s1.start_time,
      s1.end_time,
      s1.therapist_id,
      s1.client_id,
      s2.therapist_id as therapist2_id,
      s2.client_id as client2_id,
      CASE 
        WHEN s1.therapist_id = s2.therapist_id THEN 'therapist_double_booking'
        WHEN s1.client_id = s2.client_id THEN 'client_double_booking'
        ELSE 'resource_conflict'
      END as conflict_type
    FROM sessions s1
    JOIN sessions s2 ON s1.id != s2.id
    WHERE s1.start_time::date >= p_start_date 
      AND s1.start_time::date <= p_end_date
      AND s1.status = 'scheduled'
      AND s2.status = 'scheduled'
      AND (
        (s1.therapist_id = s2.therapist_id AND 
         s1.start_time < s2.end_time AND s1.end_time > s2.start_time)
        OR
        (s1.client_id = s2.client_id AND 
         s1.start_time < s2.end_time AND s1.end_time > s2.start_time)
      )
  )
  SELECT 
    gen_random_uuid() as conflict_id,
    os.conflict_type,
    CASE os.conflict_type
      WHEN 'therapist_double_booking' THEN 3
      WHEN 'client_double_booking' THEN 2
      ELSE 1
    END as severity,
    jsonb_build_array(
      jsonb_build_object('session_id', os.session1_id, 'start_time', os.start_time),
      jsonb_build_object('session_id', os.session2_id, 'start_time', os.start_time)
    ) as affected_sessions,
    CASE WHEN p_include_suggestions THEN
      jsonb_build_array(
        jsonb_build_object(
          'action', 'reschedule',
          'session_id', os.session1_id,
          'suggested_time', os.start_time + interval '2 hours'
        ),
        jsonb_build_object(
          'action', 'reschedule',
          'session_id', os.session2_id,
          'suggested_time', os.start_time + interval '1 hour'
        )
      )
    ELSE
      '[]'::jsonb
    END as suggested_resolutions
  FROM overlapping_sessions os;
END;
$$;