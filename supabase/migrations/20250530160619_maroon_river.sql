-- ============================================================================
-- AI RESPONSE CACHING SYSTEM
-- ============================================================================

-- Create AI response cache table
CREATE TABLE IF NOT EXISTS ai_response_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text UNIQUE NOT NULL,
  query_text text NOT NULL,
  response_text text NOT NULL,
  metadata jsonb DEFAULT '{}',
  query_hash text GENERATED ALWAYS AS (encode(sha256(query_text::bytea), 'hex')) STORED,
  hit_count integer DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_hit_at timestamptz
);

-- Indexes for cache performance
CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_response_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON ai_response_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_response_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_created ON ai_response_cache(created_at);

-- Cache AI response with intelligent key generation
CREATE OR REPLACE FUNCTION cache_ai_response(
  p_cache_key text,
  p_query_text text,
  p_response_text text,
  p_metadata jsonb DEFAULT '{}',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ai_response_cache (
    cache_key,
    query_text,
    response_text,
    metadata,
    expires_at
  ) VALUES (
    p_cache_key,
    p_query_text,
    p_response_text,
    p_metadata,
    COALESCE(p_expires_at, now() + interval '1 hour')
  )
  ON CONFLICT (cache_key) 
  DO UPDATE SET
    response_text = EXCLUDED.response_text,
    metadata = EXCLUDED.metadata,
    expires_at = EXCLUDED.expires_at,
    updated_at = now(),
    hit_count = ai_response_cache.hit_count + 1;
END;
$$;

-- Get cached AI response with hit tracking
CREATE OR REPLACE FUNCTION get_cached_ai_response(
  p_cache_key text
)
RETURNS TABLE (
  response_text text,
  metadata jsonb,
  created_at timestamptz,
  hit_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update hit count and last hit time
  UPDATE ai_response_cache 
  SET 
    hit_count = hit_count + 1,
    last_hit_at = now()
  WHERE cache_key = p_cache_key 
    AND expires_at > now();
  
  RETURN QUERY
  SELECT 
    arc.response_text,
    arc.metadata,
    arc.created_at,
    arc.hit_count
  FROM ai_response_cache arc
  WHERE arc.cache_key = p_cache_key 
    AND arc.expires_at > now();
END;
$$;

-- Generate semantic cache key for similar queries
CREATE OR REPLACE FUNCTION generate_semantic_cache_key(
  p_query_text text,
  p_context_hash text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  normalized_query text;
  semantic_key text;
BEGIN
  -- Normalize query text (remove extra spaces, convert to lowercase)
  normalized_query := lower(trim(regexp_replace(p_query_text, '\s+', ' ', 'g')));
  
  -- Create semantic key combining query hash and context
  semantic_key := encode(
    sha256((normalized_query || COALESCE(p_context_hash, ''))::bytea), 
    'hex'
  );
  
  RETURN 'ai_' || left(semantic_key, 16);
END;
$$;

-- Cache cleanup for expired entries
CREATE OR REPLACE FUNCTION cleanup_ai_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM ai_response_cache 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Also clean up old unused entries (older than 7 days with no hits)
  DELETE FROM ai_response_cache 
  WHERE created_at < now() - interval '7 days'
    AND (last_hit_at IS NULL OR last_hit_at < now() - interval '2 days');
  
  RETURN deleted_count;
END;
$$;

-- ============================================================================
-- CONFLICT DETECTION & RESOLUTION
-- ============================================================================

-- Intelligent conflict detection with resolution suggestions
CREATE OR REPLACE FUNCTION detect_scheduling_conflicts(
  p_start_date date,
  p_end_date date,
  p_include_suggestions boolean DEFAULT true
)
RETURNS TABLE (
  conflict_id uuid,
  conflict_type text,
  severity integer,
  affected_sessions jsonb,
  suggested_resolutions jsonb,
  auto_resolvable boolean
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
      s2.therapist_id as s2_therapist_id,
      s2.client_id as s2_client_id,
      CASE 
        WHEN s1.therapist_id = s2.therapist_id THEN 'therapist_double_booking'
        WHEN s1.client_id = s2.client_id THEN 'client_double_booking'
        ELSE 'resource_conflict'
      END as conflict_type
    FROM sessions s1
    JOIN sessions s2 ON s1.id != s2.id
    WHERE s1.start_time >= p_start_date 
      AND s1.start_time <= p_end_date
      AND s1.status = 'scheduled'
      AND s2.status = 'scheduled'
      AND (
        (s1.therapist_id = s2.therapist_id AND 
         s1.start_time < s2.end_time AND s1.end_time > s2.start_time)
        OR
        (s1.client_id = s2.client_id AND 
         s1.start_time < s2.end_time AND s1.end_time > s2.start_time)
      )
  ),
  conflict_resolutions AS (
    SELECT 
      os.*,
      CASE 
        WHEN os.conflict_type = 'therapist_double_booking' THEN
          get_alternative_therapists(os.client_id, os.start_time, os.end_time)
        WHEN os.conflict_type = 'client_double_booking' THEN  
          get_alternative_times(os.therapist_id, os.client_id, os.start_time)
        ELSE jsonb_build_array()
      END as resolutions,
      CASE
        WHEN os.conflict_type = 'client_double_booking' THEN false
        ELSE true
      END as can_auto_resolve
    FROM overlapping_sessions os
  )
  SELECT 
    gen_random_uuid() as conflict_id,
    cr.conflict_type,
    CASE cr.conflict_type
      WHEN 'therapist_double_booking' THEN 3
      WHEN 'client_double_booking' THEN 2
      ELSE 1
    END as severity,
    jsonb_build_array(
      jsonb_build_object(
        'session_id', cr.session1_id, 
        'start_time', cr.start_time,
        'therapist_id', cr.therapist_id,
        'client_id', cr.client_id
      ),
      jsonb_build_object(
        'session_id', cr.session2_id, 
        'start_time', cr.start_time,
        'therapist_id', cr.s2_therapist_id,
        'client_id', cr.s2_client_id
      )
    ) as affected_sessions,
    CASE 
      WHEN p_include_suggestions THEN cr.resolutions
      ELSE jsonb_build_array()
    END as suggested_resolutions,
    cr.can_auto_resolve as auto_resolvable
  FROM conflict_resolutions cr;
END;
$$;

-- Get alternative therapists for conflict resolution
CREATE OR REPLACE FUNCTION get_alternative_therapists(
  p_client_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  client_preferences jsonb;
  alternative_therapists jsonb;
BEGIN
  -- Get client service preferences
  SELECT to_jsonb(c) INTO client_preferences
  FROM clients c WHERE c.id = p_client_id;
  
  -- Find available therapists who match client preferences
  SELECT jsonb_agg(
    jsonb_build_object(
      'therapist_id', t.id,
      'therapist_name', t.full_name,
      'compatibility_score', calculate_therapist_client_compatibility(t.id, p_client_id),
      'alternative_times', get_therapist_availability(t.id, p_start_time::date, p_end_time::date)
    )
  ) INTO alternative_therapists
  FROM therapists t
  WHERE t.status = 'active'
    AND t.id != (SELECT therapist_id FROM sessions WHERE client_id = p_client_id AND start_time = p_start_time)
    AND NOT EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.therapist_id = t.id
        AND s.status = 'scheduled'
        AND s.start_time < p_end_time
        AND s.end_time > p_start_time
    );
  
  RETURN COALESCE(alternative_therapists, jsonb_build_array());
END;
$$;

-- Get alternative time slots for existing therapist-client pair
CREATE OR REPLACE FUNCTION get_alternative_times(
  p_therapist_id uuid,
  p_client_id uuid,
  p_original_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  alternative_slots jsonb;
  date_range_start date;
  date_range_end date;
BEGIN
  date_range_start := p_original_time::date;
  date_range_end := p_original_time::date + interval '7 days';
  
  SELECT jsonb_agg(
    jsonb_build_object(
      'suggested_time', slot_time,
      'optimality_score', score,
      'reasoning', reasoning
    )
  ) INTO alternative_slots
  FROM get_optimal_time_slots(
    (SELECT to_jsonb(t) FROM therapists t WHERE t.id = p_therapist_id),
    (SELECT to_jsonb(c) FROM clients c WHERE c.id = p_client_id),
    60,
    jsonb_build_object('start', date_range_start, 'end', date_range_end)
  ) AS slots(slot_time, score, reasoning, availability_data)
  WHERE score > 0.6
  ORDER BY score DESC
  LIMIT 5;
  
  RETURN COALESCE(alternative_slots, jsonb_build_array());
END;
$$;

-- ============================================================================
-- OPTIMAL TIME SLOT SUGGESTIONS
-- ============================================================================

-- Generate optimal scheduling recommendations
CREATE OR REPLACE FUNCTION get_optimal_time_slots(
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
AS $$
DECLARE
  start_date date;
  end_date date;
  therapist_id uuid;
  client_id uuid;
BEGIN
  -- Extract IDs from preferences
  therapist_id := (p_therapist_preferences->>'id')::uuid;
  client_id := (p_client_preferences->>'id')::uuid;
  
  -- Parse date range with smart defaults
  start_date := CASE 
    WHEN p_date_range->>'start' = 'today' THEN CURRENT_DATE
    WHEN p_date_range->>'start' ~ '^\+\d+\s+days?$' THEN 
      CURRENT_DATE + (regexp_replace(p_date_range->>'start', '\+(\d+)\s+days?', '\1'))::integer
    ELSE (p_date_range->>'start')::date
  END;
  
  end_date := CASE
    WHEN p_date_range->>'end' = '+7 days' THEN start_date + interval '7 days'
    WHEN p_date_range->>'end' ~ '^\+\d+\s+days?$' THEN 
      start_date + (regexp_replace(p_date_range->>'end', '\+(\d+)\s+days?', '\1'))::integer
    ELSE (p_date_range->>'end')::date
  END;
  
  RETURN QUERY
  WITH business_hours AS (
    SELECT 
      generate_series(
        start_date::timestamp + interval '8 hours',
        end_date::timestamp + interval '17 hours',
        interval '30 minutes'
      ) AS slot_time
  ),
  available_slots AS (
    SELECT 
      bh.slot_time,
      EXTRACT(dow FROM bh.slot_time) as day_of_week,
      EXTRACT(hour FROM bh.slot_time) as hour_of_day
    FROM business_hours bh
    WHERE bh.slot_time + interval '1 minute' * p_duration <= 
          date_trunc('day', bh.slot_time) + interval '18 hours'
      AND NOT EXISTS (
        SELECT 1 FROM sessions s
        WHERE (s.therapist_id = therapist_id OR s.client_id = client_id)
          AND s.status = 'scheduled'
          AND s.start_time < bh.slot_time + interval '1 minute' * p_duration
          AND s.end_time > bh.slot_time
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
      ) as score
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
    ) as reasoning,
    get_slot_availability_context(ss.slot_time, therapist_id, client_id) as availability_data
  FROM scored_slots ss
  WHERE ss.score > 0.3
  ORDER BY ss.score DESC
  LIMIT 10;
END;
$$;

-- Calculate optimality score for a time slot
CREATE OR REPLACE FUNCTION calculate_time_slot_score(
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
AS $$
DECLARE
  score numeric := 0;
  workload_factor numeric;
  preference_factor numeric;
  efficiency_factor numeric;
BEGIN
  -- Base score for business hours (higher for peak times)
  score := CASE 
    WHEN p_hour_of_day BETWEEN 9 AND 16 THEN 0.8
    WHEN p_hour_of_day BETWEEN 8 AND 17 THEN 0.6
    ELSE 0.3
  END;
  
  -- Day of week preference (higher for weekdays)
  score := score + CASE
    WHEN p_day_of_week BETWEEN 1 AND 5 THEN 0.2
    ELSE 0.0
  END;
  
  -- Therapist workload balance
  SELECT get_therapist_workload_factor(p_therapist_id, p_slot_time) INTO workload_factor;
  score := score + (workload_factor * 0.3);
  
  -- Client scheduling pattern analysis
  SELECT get_client_preference_factor(p_client_id, p_slot_time) INTO preference_factor;
  score := score + (preference_factor * 0.2);
  
  -- Session spacing efficiency
  SELECT get_scheduling_efficiency_factor(p_therapist_id, p_slot_time) INTO efficiency_factor;
  score := score + (efficiency_factor * 0.15);
  
  RETURN LEAST(score, 1.0);
END;
$$;

-- ============================================================================
-- WORKLOAD ANALYSIS & OPTIMIZATION
-- ============================================================================

-- Analyze therapist workload patterns and recommendations
CREATE OR REPLACE FUNCTION analyze_therapist_workload(
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
AS $$
BEGIN
  RETURN QUERY
  WITH therapist_stats AS (
    SELECT 
      t.id,
      t.full_name,
      t.weekly_hours_min,
      t.weekly_hours_max,
      COALESCE(session_hours.total_hours, 0) as actual_hours,
      COALESCE(session_hours.session_count, 0) as session_count,
      session_hours.daily_distribution
    FROM therapists t
    LEFT JOIN (
      SELECT 
        s.therapist_id,
        SUM(EXTRACT(epoch FROM (s.end_time - s.start_time))/3600) as total_hours,
        COUNT(*) as session_count,
        jsonb_object_agg(
          EXTRACT(dow FROM s.start_time),
          COUNT(*)
        ) as daily_distribution
      FROM sessions s
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
    ROUND(
      (ts.actual_hours * 4) / NULLIF((ts.weekly_hours_min + ts.weekly_hours_max), 0) * 100, 
      2
    ) as utilization_rate,
    ts.actual_hours,
    (ts.weekly_hours_min + ts.weekly_hours_max) / 2.0 as target_hours,
    calculate_efficiency_score(ts.id, ts.actual_hours, ts.session_count) as efficiency_score,
    generate_workload_recommendations(
      ts.id, 
      ts.actual_hours, 
      (ts.weekly_hours_min + ts.weekly_hours_max) / 2.0,
      ts.session_count
    ) as recommendations,
    ts.daily_distribution as workload_distribution
  FROM therapist_stats ts;
END;
$$;

-- Generate intelligent workload recommendations
CREATE OR REPLACE FUNCTION generate_workload_recommendations(
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
  utilization_rate := (p_actual_hours / NULLIF(p_target_hours, 0)) * 100;
  avg_session_length := p_actual_hours / NULLIF(p_session_count, 0);
  
  -- Underutilization recommendations
  IF utilization_rate < 70 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'increase_utilization',
        'priority', 'high',
        'message', format('Utilization at %.1f%%. Consider adding %s hours/week', 
                         utilization_rate, 
                         ROUND(p_target_hours - p_actual_hours, 1)),
        'action', 'schedule_more_sessions'
      )
    );
  END IF;
  
  -- Overutilization recommendations  
  IF utilization_rate > 120 THEN
    recommendations := recommendations || jsonb_build_array(
      jsonb_build_object(
        'type', 'reduce_overload',
        'priority', 'critical',
        'message', format('Overutilized at %.1f%%. Consider reducing %s hours/week',
                         utilization_rate,
                         ROUND(p_actual_hours - p_target_hours, 1)),
        'action', 'redistribute_sessions'
      )
    );
  END IF;
  
  -- Session efficiency recommendations
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

-- ============================================================================
-- PERFORMANCE MONITORING & HELPER FUNCTIONS
-- ============================================================================

-- Calculate therapist-client compatibility score
CREATE OR REPLACE FUNCTION calculate_therapist_client_compatibility(
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
  SELECT * INTO therapist_data FROM therapists WHERE id = p_therapist_id;
  SELECT * INTO client_data FROM clients WHERE id = p_client_id;
  
  -- Service type compatibility
  IF therapist_data.service_type && client_data.service_preference THEN
    compatibility_score := compatibility_score + 0.4;
  END IF;
  
  -- Experience and specialization match
  IF therapist_data.specialties && ARRAY[client_data.primary_diagnosis] THEN
    compatibility_score := compatibility_score + 0.3;
  END IF;
  
  -- Historical success rate (if available)
  compatibility_score := compatibility_score + 
    COALESCE(get_historical_success_rate(p_therapist_id, p_client_id), 0.2);
  
  RETURN LEAST(compatibility_score, 1.0);
END;
$$;

-- Get cache performance metrics
CREATE OR REPLACE FUNCTION get_ai_cache_metrics()
RETURNS TABLE (
  total_entries bigint,
  active_entries bigint,
  hit_rate numeric,
  average_hits numeric,
  cache_size_mb numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_entries,
    COUNT(*) FILTER (WHERE expires_at > now()) as active_entries,
    ROUND(
      AVG(hit_count) FILTER (WHERE hit_count > 0) / 
      NULLIF(AVG(hit_count), 0) * 100, 
      2
    ) as hit_rate,
    ROUND(AVG(hit_count), 2) as average_hits,
    ROUND(
      pg_total_relation_size('ai_response_cache'::regclass) / 1024.0 / 1024.0, 
      2
    ) as cache_size_mb
  FROM ai_response_cache;
END;
$$;

-- Grant permissions for all functions
GRANT EXECUTE ON FUNCTION cache_ai_response(text, text, text, jsonb, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION get_cached_ai_response(text) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_semantic_cache_key(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_ai_cache() TO authenticated;
GRANT EXECUTE ON FUNCTION detect_scheduling_conflicts(date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION get_optimal_time_slots(jsonb, jsonb, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION analyze_therapist_workload(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_cache_metrics() TO authenticated;

-- Create periodic cache cleanup job (requires pg_cron extension)
-- SELECT cron.schedule('ai-cache-cleanup', '0 2 * * *', 'SELECT cleanup_ai_cache();');