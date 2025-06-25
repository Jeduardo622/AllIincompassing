/*
  # Performance Monitoring & Alerting System
  
  1. Real-time Performance Metrics Collection
    - AI response time tracking
    - Cache hit rate monitoring
    - Database query performance
    - System resource utilization
    
  2. Alerting & Notification System
    - Threshold-based alerts
    - Performance degradation detection
    - Automated escalation logic
    
  3. Historical Performance Tracking
    - Performance trend analysis
    - Capacity planning metrics
    - SLA compliance monitoring
*/

-- ============================================================================
-- PERFORMANCE METRICS TABLES
-- ============================================================================

-- AI Performance Metrics
CREATE TABLE IF NOT EXISTS ai_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  response_time_ms integer NOT NULL,
  cache_hit boolean DEFAULT false,
  token_usage jsonb DEFAULT '{}',
  function_called text,
  error_occurred boolean DEFAULT false,
  user_id uuid,
  conversation_id text,
  cost_usd decimal(10,4) DEFAULT 0
);

-- Database Performance Metrics
CREATE TABLE IF NOT EXISTS db_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  query_type text NOT NULL,
  execution_time_ms integer NOT NULL,
  rows_affected integer DEFAULT 0,
  cache_hit boolean DEFAULT false,
  table_name text,
  slow_query boolean GENERATED ALWAYS AS (execution_time_ms > 1000) STORED
);

-- System Performance Metrics
CREATE TABLE IF NOT EXISTS system_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  metric_type text NOT NULL, -- 'cpu', 'memory', 'disk', 'network'
  value numeric NOT NULL,
  unit text NOT NULL,
  threshold_breached boolean DEFAULT false
);

-- Performance Alerts
CREATE TABLE IF NOT EXISTS performance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL, -- 'error', 'warning', 'info'
  metric_name text NOT NULL,
  current_value numeric NOT NULL,
  threshold_value numeric NOT NULL,
  message text NOT NULL,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  escalated boolean DEFAULT false
);

-- Indexes for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_metrics_timestamp ON ai_performance_metrics(timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_metrics_cache_hit ON ai_performance_metrics(cache_hit, timestamp);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_db_metrics_timestamp ON db_performance_metrics(timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_db_metrics_slow ON db_performance_metrics(slow_query, timestamp);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_unresolved ON performance_alerts(resolved, created_at DESC);

-- ============================================================================
-- REAL-TIME PERFORMANCE MONITORING FUNCTIONS
-- ============================================================================

-- Get comprehensive performance metrics for dashboard
CREATE OR REPLACE FUNCTION get_performance_metrics(
  time_range text DEFAULT '1h'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  interval_value interval;
  ai_metrics jsonb;
  db_metrics jsonb;
  cache_metrics jsonb;
  system_metrics jsonb;
BEGIN
  -- Convert time range to interval
  interval_value := CASE time_range
    WHEN '1h' THEN interval '1 hour'
    WHEN '24h' THEN interval '24 hours'
    WHEN '7d' THEN interval '7 days'
    ELSE interval '1 hour'
  END;

  -- AI Performance Metrics
  SELECT jsonb_build_object(
    'averageResponseTime', COALESCE(AVG(response_time_ms)::integer, 0),
    'cacheHitRate', COALESCE(AVG(CASE WHEN cache_hit THEN 1.0 ELSE 0.0 END), 0),
    'totalRequests', COUNT(*),
    'errorRate', COALESCE(AVG(CASE WHEN error_occurred THEN 1.0 ELSE 0.0 END), 0),
    'tokenUsage', COALESCE(AVG((token_usage->>'total')::integer), 0),
    'costSavings', COALESCE(SUM(CASE WHEN cache_hit THEN 0.02 ELSE 0 END), 0)
  ) INTO ai_metrics
  FROM ai_performance_metrics
  WHERE timestamp >= now() - interval_value;

  -- Database Performance Metrics
  SELECT jsonb_build_object(
    'queryPerformance', COALESCE(AVG(execution_time_ms)::integer, 0),
    'cacheEfficiency', COALESCE(AVG(CASE WHEN cache_hit THEN 1.0 ELSE 0.0 END), 0),
    'connectionPool', COALESCE((
      SELECT numbackends 
      FROM pg_stat_database 
      WHERE datname = current_database()
    ), 0),
    'slowQueries', COALESCE(COUNT(*) FILTER (WHERE slow_query), 0)
  ) INTO db_metrics
  FROM db_performance_metrics
  WHERE timestamp >= now() - interval_value;

  -- Cache Performance Metrics
  WITH cache_stats AS (
    SELECT 
      COUNT(*) as total_entries,
      COUNT(*) FILTER (WHERE cache_hit) as cache_hits
    FROM ai_performance_metrics
    WHERE timestamp >= now() - interval_value
  )
  SELECT jsonb_build_object(
    'hitRate', CASE WHEN total_entries > 0 THEN cache_hits::float / total_entries ELSE 0 END,
    'size', 2.1, -- Mock cache size in MB
    'entries', total_entries,
    'cleanup', 25 -- Mock cleanup count
  ) INTO cache_metrics
  FROM cache_stats;

  -- System Metrics (mock data for now)
  SELECT jsonb_build_object(
    'cpuUsage', 45.2,
    'memoryUsage', 67.8,
    'responseTime', COALESCE(AVG(response_time_ms)::integer, 0),
    'uptime', 99.9
  ) INTO system_metrics
  FROM ai_performance_metrics
  WHERE timestamp >= now() - interval_value;

  -- Combine all metrics
  RETURN jsonb_build_object(
    'ai', ai_metrics,
    'database', db_metrics,
    'cache', cache_metrics,
    'system', system_metrics
  );
END;
$$;

-- Log AI performance metrics
CREATE OR REPLACE FUNCTION log_ai_performance(
  p_response_time_ms integer,
  p_cache_hit boolean DEFAULT false,
  p_token_usage jsonb DEFAULT '{}',
  p_function_called text DEFAULT NULL,
  p_error_occurred boolean DEFAULT false,
  p_user_id uuid DEFAULT NULL,
  p_conversation_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cost_per_token numeric := 0.000002; -- $0.000002 per token
  total_tokens integer;
  calculated_cost numeric;
BEGIN
  -- Calculate cost based on token usage
  total_tokens := COALESCE((p_token_usage->>'total')::integer, 0);
  calculated_cost := CASE WHEN p_cache_hit THEN 0 ELSE total_tokens * cost_per_token END;

  INSERT INTO ai_performance_metrics (
    response_time_ms,
    cache_hit,
    token_usage,
    function_called,
    error_occurred,
    user_id,
    conversation_id,
    cost_usd
  ) VALUES (
    p_response_time_ms,
    p_cache_hit,
    p_token_usage,
    p_function_called,
    p_error_occurred,
    p_user_id,
    p_conversation_id,
    calculated_cost
  );
  
  -- Check for performance alerts
  PERFORM check_performance_thresholds('ai_response_time', p_response_time_ms);
END;
$$;

-- Log database performance metrics
CREATE OR REPLACE FUNCTION log_db_performance(
  p_query_type text,
  p_execution_time_ms integer,
  p_rows_affected integer DEFAULT 0,
  p_cache_hit boolean DEFAULT false,
  p_table_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO db_performance_metrics (
    query_type,
    execution_time_ms,
    rows_affected,
    cache_hit,
    table_name
  ) VALUES (
    p_query_type,
    p_execution_time_ms,
    p_rows_affected,
    p_cache_hit,
    p_table_name
  );
  
  -- Check for slow query alerts
  IF p_execution_time_ms > 1000 THEN
    PERFORM check_performance_thresholds('db_query_time', p_execution_time_ms);
  END IF;
END;
$$;

-- Check performance thresholds and create alerts
CREATE OR REPLACE FUNCTION check_performance_thresholds(
  p_metric_name text,
  p_current_value numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  threshold_config record;
  alert_exists boolean;
BEGIN
  -- Define thresholds for different metrics
  FOR threshold_config IN 
    SELECT * FROM (VALUES
      ('ai_response_time', 750, 1000, 'error'),
      ('ai_response_time', 500, 750, 'warning'),
      ('db_query_time', 500, 1000, 'warning'),
      ('db_query_time', 1000, 9999999, 'error'),
      ('cache_hit_rate', 0.6, 0.8, 'warning'),
      ('cache_hit_rate', 0, 0.6, 'error')
    ) AS t(metric, warning_threshold, error_threshold, alert_type)
    WHERE t.metric = p_metric_name
  LOOP
    -- Check if we should create an alert
    IF (threshold_config.alert_type = 'warning' AND 
        p_current_value > threshold_config.warning_threshold AND 
        p_current_value <= threshold_config.error_threshold)
    OR (threshold_config.alert_type = 'error' AND 
        p_current_value > threshold_config.error_threshold) THEN
      
      -- Check if similar alert exists in last 5 minutes
      SELECT EXISTS(
        SELECT 1 FROM performance_alerts
        WHERE metric_name = p_metric_name
        AND alert_type = threshold_config.alert_type
        AND created_at > now() - interval '5 minutes'
        AND NOT resolved
      ) INTO alert_exists;
      
      -- Create alert if none exists
      IF NOT alert_exists THEN
        INSERT INTO performance_alerts (
          alert_type,
          metric_name,
          current_value,
          threshold_value,
          message
        ) VALUES (
          threshold_config.alert_type,
          p_metric_name,
          p_current_value,
          CASE 
            WHEN threshold_config.alert_type = 'error' THEN threshold_config.error_threshold
            ELSE threshold_config.warning_threshold
          END,
          format('%s %s: %s (threshold: %s)',
            CASE threshold_config.alert_type
              WHEN 'error' THEN 'CRITICAL'
              WHEN 'warning' THEN 'WARNING'
              ELSE 'INFO'
            END,
            p_metric_name,
            p_current_value,
            CASE 
              WHEN threshold_config.alert_type = 'error' THEN threshold_config.error_threshold
              ELSE threshold_config.warning_threshold
            END
          )
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Get system alerts for dashboard
CREATE OR REPLACE FUNCTION get_system_alerts(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  alert_type text,
  metric_name text,
  current_value numeric,
  threshold_value numeric,
  message text,
  created_at timestamptz,
  resolved boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pa.id,
    pa.alert_type,
    pa.metric_name,
    pa.current_value,
    pa.threshold_value,
    pa.message,
    pa.created_at,
    pa.resolved
  FROM performance_alerts pa
  ORDER BY pa.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Enhanced AI cache metrics with performance analysis
CREATE OR REPLACE FUNCTION get_ai_cache_metrics()
RETURNS TABLE (
  total_entries bigint,
  valid_entries bigint,
  expired_entries bigint,
  hit_rate numeric,
  average_response_time numeric,
  cache_size_mb numeric,
  daily_requests bigint,
  cost_savings numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH cache_analysis AS (
    SELECT 
      COUNT(*) as total_cache_entries,
      COUNT(*) FILTER (WHERE expires_at > now()) as valid_cache_entries,
      COUNT(*) FILTER (WHERE expires_at <= now()) as expired_cache_entries,
      pg_size_pretty(pg_total_relation_size('ai_response_cache'))::numeric as cache_size
    FROM ai_response_cache
  ),
  performance_analysis AS (
    SELECT
      AVG(CASE WHEN cache_hit THEN 1.0 ELSE 0.0 END) as cache_hit_rate,
      AVG(response_time_ms) as avg_response_time,
      COUNT(*) FILTER (WHERE timestamp >= current_date) as daily_request_count,
      SUM(CASE WHEN cache_hit THEN 0.02 ELSE 0 END) as total_cost_savings
    FROM ai_performance_metrics
    WHERE timestamp >= now() - interval '24 hours'
  )
  SELECT 
    ca.total_cache_entries,
    ca.valid_cache_entries,
    ca.expired_cache_entries,
    COALESCE(pa.cache_hit_rate, 0)::numeric,
    COALESCE(pa.avg_response_time, 0)::numeric,
    COALESCE(ca.cache_size, 0)::numeric,
    COALESCE(pa.daily_request_count, 0),
    COALESCE(pa.total_cost_savings, 0)::numeric
  FROM cache_analysis ca
  CROSS JOIN performance_analysis pa;
END;
$$;

-- Resolve performance alert
CREATE OR REPLACE FUNCTION resolve_performance_alert(
  p_alert_id uuid,
  p_resolution_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE performance_alerts
  SET 
    resolved = true,
    resolved_at = now()
  WHERE id = p_alert_id
  AND NOT resolved;
  
  RETURN FOUND;
END;
$$;

-- Performance optimization recommendations
CREATE OR REPLACE FUNCTION get_performance_recommendations()
RETURNS TABLE (
  category text,
  recommendation text,
  impact text,
  difficulty text,
  estimated_improvement text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH performance_stats AS (
    SELECT 
      AVG(response_time_ms) as avg_ai_response,
      AVG(CASE WHEN cache_hit THEN 1.0 ELSE 0.0 END) as cache_hit_rate,
      COUNT(*) FILTER (WHERE slow_query) as slow_query_count
    FROM ai_performance_metrics apm
    LEFT JOIN db_performance_metrics dpm ON DATE_TRUNC('hour', apm.timestamp) = DATE_TRUNC('hour', dpm.timestamp)
    WHERE apm.timestamp >= now() - interval '24 hours'
  )
  SELECT 
    rec.category,
    rec.recommendation,
    rec.impact,
    rec.difficulty,
    rec.estimated_improvement
  FROM performance_stats ps,
  LATERAL (
    VALUES 
      -- AI Performance Recommendations
      (CASE WHEN ps.avg_ai_response > 1000 THEN 'AI Performance' ELSE NULL END,
       'Optimize AI function schemas and reduce token usage',
       'High', 'Medium', '30-50% response time reduction'),
      
      (CASE WHEN ps.cache_hit_rate < 0.7 THEN 'Caching' ELSE NULL END,
       'Improve semantic cache key generation for better hit rates',
       'High', 'Medium', '20-40% cost reduction'),
       
      -- Database Performance Recommendations  
      (CASE WHEN ps.slow_query_count > 10 THEN 'Database' ELSE NULL END,
       'Add database indexes for frequently queried columns',
       'Medium', 'Low', '40-60% query performance improvement'),
       
      -- General Recommendations
      ('Infrastructure',
       'Implement connection pooling for database connections',
       'Medium', 'Medium', '15-25% overall performance gain'),
       
      ('Monitoring',
       'Set up proactive alerting for performance thresholds',
       'Low', 'Low', 'Faster incident response')
  ) AS rec(category, recommendation, impact, difficulty, estimated_improvement)
  WHERE rec.category IS NOT NULL;
END;
$$;

-- Automated performance cleanup (run daily)
CREATE OR REPLACE FUNCTION cleanup_performance_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  -- Clean up old performance metrics (keep 30 days)
  DELETE FROM ai_performance_metrics 
  WHERE timestamp < now() - interval '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  DELETE FROM db_performance_metrics 
  WHERE timestamp < now() - interval '30 days';
  
  -- Clean up resolved alerts older than 7 days
  DELETE FROM performance_alerts 
  WHERE resolved = true 
  AND resolved_at < now() - interval '7 days';
  
  -- Clean up expired cache entries
  PERFORM cleanup_ai_cache();
  
  RETURN deleted_count;
END;
$$; 