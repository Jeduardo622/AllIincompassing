-- ============================================================================
-- CACHE CLEANUP & QUERY PERFORMANCE TRACKING MIGRATION
-- Implements comprehensive performance monitoring and automated cleanup
-- ============================================================================

-- Create query_performance_metrics table for detailed query tracking
CREATE TABLE IF NOT EXISTS query_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key text NOT NULL,
  operation text NOT NULL,
  duration_ms numeric NOT NULL,
  data_size_bytes integer,
  cache_hit boolean DEFAULT false,
  error_occurred boolean DEFAULT false,
  error_message text,
  stack_trace text,
  query_complexity text CHECK (query_complexity IN ('low', 'medium', 'high')),
  affected_rows integer,
  session_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for query performance metrics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_performance_timestamp 
ON query_performance_metrics(timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_performance_duration 
ON query_performance_metrics(duration_ms DESC) 
WHERE duration_ms > 1000;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_performance_session 
ON query_performance_metrics(session_id, timestamp);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_performance_errors 
ON query_performance_metrics(error_occurred, timestamp) 
WHERE error_occurred = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_performance_patterns 
ON query_performance_metrics(query_key, timestamp);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_performance_user_recent 
ON query_performance_metrics(user_id, timestamp DESC) 
WHERE timestamp >= NOW() - INTERVAL '24 hours';

-- Create slow_query_patterns table for pattern detection
CREATE TABLE IF NOT EXISTS slow_query_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text UNIQUE NOT NULL,
  count integer DEFAULT 1,
  avg_duration_ms numeric NOT NULL,
  max_duration_ms numeric NOT NULL,
  min_duration_ms numeric NOT NULL,
  last_occurrence timestamptz DEFAULT now(),
  recommendation text,
  impact text CHECK (impact IN ('low', 'medium', 'high', 'critical')),
  auto_optimization_attempted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for slow query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_slow_query_patterns_updated 
ON slow_query_patterns(updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_slow_query_patterns_impact 
ON slow_query_patterns(impact, updated_at DESC);

-- Create cache_cleanup_logs table for tracking cleanup operations
CREATE TABLE IF NOT EXISTS cache_cleanup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleanup_type text NOT NULL,
  source text NOT NULL, -- 'localStorage', 'reactQuery', 'aiCache', etc.
  items_cleaned integer DEFAULT 0,
  bytes_freed bigint DEFAULT 0,
  duration_ms numeric,
  errors_encountered integer DEFAULT 0,
  error_details jsonb,
  memory_before_mb numeric,
  memory_after_mb numeric,
  cleanup_trigger text, -- 'scheduled', 'manual', 'memory_pressure'
  session_id text,
  created_at timestamptz DEFAULT now()
);

-- Create index for cleanup logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cache_cleanup_logs_created 
ON cache_cleanup_logs(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cache_cleanup_logs_type 
ON cache_cleanup_logs(cleanup_type, created_at DESC);

-- ============================================================================
-- ENHANCED CACHE CLEANUP FUNCTIONS
-- ============================================================================

-- Enhanced AI cache cleanup with better analytics
CREATE OR REPLACE FUNCTION cleanup_ai_cache_enhanced()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer := 0;
  bytes_freed bigint := 0;
  start_time timestamptz := now();
  cache_size_before bigint;
  cache_size_after bigint;
  result jsonb;
BEGIN
  -- Calculate cache size before cleanup
  SELECT COALESCE(SUM(
    pg_column_size(response_text) + 
    pg_column_size(query_text) + 
    pg_column_size(metadata)
  ), 0)
  INTO cache_size_before
  FROM ai_response_cache;
  
  -- Delete expired entries
  DELETE FROM ai_response_cache 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Clean up old unused entries (older than 7 days with no hits)
  DELETE FROM ai_response_cache 
  WHERE created_at < now() - interval '7 days'
    AND (last_hit_at IS NULL OR last_hit_at < now() - interval '2 days');
  
  -- Calculate cache size after cleanup
  SELECT COALESCE(SUM(
    pg_column_size(response_text) + 
    pg_column_size(query_text) + 
    pg_column_size(metadata)
  ), 0)
  INTO cache_size_after
  FROM ai_response_cache;
  
  bytes_freed := cache_size_before - cache_size_after;
  
  -- Log cleanup operation
  INSERT INTO cache_cleanup_logs (
    cleanup_type,
    source,
    items_cleaned,
    bytes_freed,
    duration_ms,
    cleanup_trigger
  ) VALUES (
    'ai_cache',
    'database',
    deleted_count,
    bytes_freed,
    EXTRACT(epoch FROM (now() - start_time)) * 1000,
    'scheduled'
  );
  
  result := jsonb_build_object(
    'deleted_entries', deleted_count,
    'bytes_freed', bytes_freed,
    'cache_size_before', cache_size_before,
    'cache_size_after', cache_size_after,
    'cleanup_duration_ms', EXTRACT(epoch FROM (now() - start_time)) * 1000
  );
  
  RETURN result;
END;
$$;

-- Function to get comprehensive cache statistics
CREATE OR REPLACE FUNCTION get_cache_statistics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ai_cache_stats jsonb;
  query_stats jsonb;
  cleanup_stats jsonb;
  result jsonb;
BEGIN
  -- AI Cache Statistics
  SELECT jsonb_build_object(
    'total_entries', COUNT(*),
    'valid_entries', COUNT(*) FILTER (WHERE expires_at > now()),
    'expired_entries', COUNT(*) FILTER (WHERE expires_at <= now()),
    'hit_rate', CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((SUM(hit_count)::numeric / (SUM(hit_count) + COUNT(*))) * 100, 2)
      ELSE 0 
    END,
    'total_size_bytes', COALESCE(SUM(
      pg_column_size(response_text) + 
      pg_column_size(query_text) + 
      pg_column_size(metadata)
    ), 0),
    'avg_response_time_ms', COALESCE(AVG((metadata->>'responseTime')::numeric), 0),
    'last_cleanup', (
      SELECT created_at 
      FROM cache_cleanup_logs 
      WHERE cleanup_type = 'ai_cache' 
      ORDER BY created_at DESC 
      LIMIT 1
    )
  )
  INTO ai_cache_stats
  FROM ai_response_cache;
  
  -- Query Performance Statistics
  SELECT jsonb_build_object(
    'total_queries', COUNT(*),
    'slow_queries', COUNT(*) FILTER (WHERE duration_ms > 1000),
    'avg_duration_ms', ROUND(AVG(duration_ms), 2),
    'p95_duration_ms', ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 2),
    'cache_hit_rate', ROUND((COUNT(*) FILTER (WHERE cache_hit = true)::numeric / COUNT(*)) * 100, 2),
    'error_rate', ROUND((COUNT(*) FILTER (WHERE error_occurred = true)::numeric / COUNT(*)) * 100, 2),
    'unique_patterns', (SELECT COUNT(*) FROM slow_query_patterns)
  )
  INTO query_stats
  FROM query_performance_metrics
  WHERE timestamp >= now() - interval '24 hours';
  
  -- Cleanup Statistics
  SELECT jsonb_build_object(
    'total_cleanups', COUNT(*),
    'total_items_cleaned', COALESCE(SUM(items_cleaned), 0),
    'total_bytes_freed', COALESCE(SUM(bytes_freed), 0),
    'avg_cleanup_duration_ms', ROUND(AVG(duration_ms), 2),
    'last_cleanup', MAX(created_at),
    'cleanup_frequency', jsonb_agg(
      jsonb_build_object(
        'type', cleanup_type,
        'count', cleanup_count
      )
    )
  )
  INTO cleanup_stats
  FROM cache_cleanup_logs
  LEFT JOIN (
    SELECT cleanup_type, COUNT(*) as cleanup_count
    FROM cache_cleanup_logs
    WHERE created_at >= now() - interval '7 days'
    GROUP BY cleanup_type
  ) freq ON true
  WHERE created_at >= now() - interval '7 days';
  
  result := jsonb_build_object(
    'ai_cache', ai_cache_stats,
    'query_performance', query_stats,
    'cleanup_operations', cleanup_stats,
    'generated_at', now()
  );
  
  RETURN result;
END;
$$;

-- Function to detect and update slow query patterns
CREATE OR REPLACE FUNCTION update_slow_query_pattern(
  p_pattern text,
  p_duration_ms numeric,
  p_recommendation text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_pattern slow_query_patterns%ROWTYPE;
  new_impact text;
BEGIN
  -- Determine impact level
  new_impact := CASE 
    WHEN p_duration_ms > 5000 THEN 'critical'
    WHEN p_duration_ms > 2000 THEN 'high'
    WHEN p_duration_ms > 1000 THEN 'medium'
    ELSE 'low'
  END;
  
  -- Check if pattern exists
  SELECT * INTO existing_pattern
  FROM slow_query_patterns
  WHERE pattern = p_pattern;
  
  IF FOUND THEN
    -- Update existing pattern
    UPDATE slow_query_patterns SET
      count = count + 1,
      avg_duration_ms = (avg_duration_ms * count + p_duration_ms) / (count + 1),
      max_duration_ms = GREATEST(max_duration_ms, p_duration_ms),
      min_duration_ms = LEAST(min_duration_ms, p_duration_ms),
      last_occurrence = now(),
      impact = new_impact,
      updated_at = now()
    WHERE pattern = p_pattern;
  ELSE
    -- Insert new pattern
    INSERT INTO slow_query_patterns (
      pattern,
      count,
      avg_duration_ms,
      max_duration_ms,
      min_duration_ms,
      recommendation,
      impact
    ) VALUES (
      p_pattern,
      1,
      p_duration_ms,
      p_duration_ms,
      p_duration_ms,
      COALESCE(p_recommendation, 'Consider optimizing this query pattern'),
      new_impact
    );
  END IF;
END;
$$;

-- Function to get performance recommendations
CREATE OR REPLACE FUNCTION get_performance_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  recommendations jsonb := '[]'::jsonb;
  slow_pattern_count integer;
  high_error_rate numeric;
  low_cache_hit_rate numeric;
BEGIN
  -- Check for slow query patterns
  SELECT COUNT(*) INTO slow_pattern_count
  FROM slow_query_patterns
  WHERE impact IN ('high', 'critical')
    AND last_occurrence >= now() - interval '24 hours';
  
  IF slow_pattern_count > 0 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'query_optimization',
        'priority', 'high',
        'title', 'Slow Query Patterns Detected',
        'description', format('%s slow query patterns detected in the last 24 hours', slow_pattern_count),
        'recommendation', 'Review and optimize slow query patterns, consider adding indexes',
        'estimated_improvement', '40-70% query performance improvement'
      )
    );
  END IF;
  
  -- Check error rate
  SELECT ROUND((COUNT(*) FILTER (WHERE error_occurred = true)::numeric / COUNT(*)) * 100, 2)
  INTO high_error_rate
  FROM query_performance_metrics
  WHERE timestamp >= now() - interval '1 hour';
  
  IF high_error_rate > 5 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'error_reduction',
        'priority', 'critical',
        'title', 'High Query Error Rate',
        'description', format('Query error rate is %s%% in the last hour', high_error_rate),
        'recommendation', 'Investigate and fix failing queries immediately',
        'estimated_improvement', 'Improved system reliability'
      )
    );
  END IF;
  
  -- Check cache hit rate
  SELECT ROUND((COUNT(*) FILTER (WHERE cache_hit = true)::numeric / COUNT(*)) * 100, 2)
  INTO low_cache_hit_rate
  FROM query_performance_metrics
  WHERE timestamp >= now() - interval '1 hour';
  
  IF low_cache_hit_rate < 70 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'cache_optimization',
        'priority', 'medium',
        'title', 'Low Cache Hit Rate',
        'description', format('Cache hit rate is %s%% in the last hour', low_cache_hit_rate),
        'recommendation', 'Review caching strategy and cache key generation',
        'estimated_improvement', '20-40% performance improvement'
      )
    );
  END IF;
  
  RETURN jsonb_build_object(
    'recommendations', recommendations,
    'generated_at', now(),
    'analysis_period', '24 hours'
  );
END;
$$;

-- ============================================================================
-- AUTOMATED CLEANUP SCHEDULING
-- ============================================================================

-- Function to run comprehensive automated cleanup
CREATE OR REPLACE FUNCTION run_automated_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ai_cache_result jsonb;
  performance_cleanup_count integer;
  pattern_cleanup_count integer;
  result jsonb;
BEGIN
  -- Clean AI cache
  SELECT cleanup_ai_cache_enhanced() INTO ai_cache_result;
  
  -- Clean old performance metrics (keep 7 days)
  DELETE FROM query_performance_metrics 
  WHERE timestamp < now() - interval '7 days';
  
  GET DIAGNOSTICS performance_cleanup_count = ROW_COUNT;
  
  -- Clean old slow query patterns (keep 30 days)
  DELETE FROM slow_query_patterns 
  WHERE updated_at < now() - interval '30 days';
  
  GET DIAGNOSTICS pattern_cleanup_count = ROW_COUNT;
  
  -- Clean old cleanup logs (keep 30 days)
  DELETE FROM cache_cleanup_logs
  WHERE created_at < now() - interval '30 days';
  
  result := jsonb_build_object(
    'ai_cache', ai_cache_result,
    'performance_metrics_cleaned', performance_cleanup_count,
    'patterns_cleaned', pattern_cleanup_count,
    'cleanup_completed_at', now()
  );
  
  -- Log the comprehensive cleanup
  INSERT INTO cache_cleanup_logs (
    cleanup_type,
    source,
    items_cleaned,
    cleanup_trigger
  ) VALUES (
    'comprehensive',
    'automated',
    performance_cleanup_count + pattern_cleanup_count + (ai_cache_result->>'deleted_entries')::integer,
    'scheduled'
  );
  
  RETURN result;
END;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE query_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE slow_query_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_cleanup_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for query_performance_metrics
CREATE POLICY "Users can view their own query metrics" ON query_performance_metrics
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own query metrics" ON query_performance_metrics
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Create policies for slow_query_patterns (admin only)
CREATE POLICY "Admin can manage slow query patterns" ON slow_query_patterns
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
  );

-- Create policies for cache_cleanup_logs (admin only)
CREATE POLICY "Admin can view cleanup logs" ON cache_cleanup_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid() AND r.name = 'admin'
    )
  );

-- ============================================================================
-- PERFORMANCE ANALYSIS VIEWS
-- ============================================================================

-- View for query performance summary
CREATE OR REPLACE VIEW query_performance_summary AS
SELECT 
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(*) as total_queries,
  COUNT(*) FILTER (WHERE duration_ms > 1000) as slow_queries,
  ROUND(AVG(duration_ms), 2) as avg_duration_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 2) as p95_duration_ms,
  ROUND((COUNT(*) FILTER (WHERE cache_hit = true)::numeric / COUNT(*)) * 100, 2) as cache_hit_rate,
  ROUND((COUNT(*) FILTER (WHERE error_occurred = true)::numeric / COUNT(*)) * 100, 2) as error_rate
FROM query_performance_metrics
WHERE timestamp >= now() - interval '7 days'
GROUP BY DATE_TRUNC('hour', timestamp)
ORDER BY hour DESC;

-- View for top slow query patterns
CREATE OR REPLACE VIEW top_slow_patterns AS
SELECT 
  pattern,
  count,
  ROUND(avg_duration_ms, 2) as avg_duration_ms,
  max_duration_ms,
  impact,
  recommendation,
  last_occurrence
FROM slow_query_patterns
WHERE last_occurrence >= now() - interval '7 days'
ORDER BY 
  CASE impact 
    WHEN 'critical' THEN 4
    WHEN 'high' THEN 3
    WHEN 'medium' THEN 2
    ELSE 1
  END DESC,
  avg_duration_ms DESC
LIMIT 20;

-- Add comments for documentation
COMMENT ON TABLE query_performance_metrics IS 'Detailed tracking of query performance metrics for optimization analysis';
COMMENT ON TABLE slow_query_patterns IS 'Aggregated patterns of slow queries for performance optimization';
COMMENT ON TABLE cache_cleanup_logs IS 'Log of cache cleanup operations for monitoring and analysis';
COMMENT ON FUNCTION cleanup_ai_cache_enhanced() IS 'Enhanced AI cache cleanup with detailed analytics and logging';
COMMENT ON FUNCTION get_cache_statistics() IS 'Comprehensive cache statistics for monitoring dashboard';
COMMENT ON FUNCTION run_automated_cleanup() IS 'Automated cleanup function for scheduled maintenance';

-- Analyze tables for better query planning
ANALYZE query_performance_metrics;
ANALYZE slow_query_patterns;
ANALYZE cache_cleanup_logs; 