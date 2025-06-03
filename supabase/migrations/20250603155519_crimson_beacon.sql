/*
  # Create AI Helper Functions

  1. Functions
    - `generate_semantic_cache_key` - Generates a semantic cache key for AI responses
    - `cache_ai_response` - Caches an AI response
    - `get_cached_ai_response` - Retrieves a cached AI response
    - `get_ai_cache_metrics` - Gets metrics about the AI cache
    - `cleanup_ai_cache` - Cleans up expired cache entries
    - `get_recent_chat_history` - Gets recent chat history for a conversation
*/

-- Function to generate a semantic cache key
CREATE OR REPLACE FUNCTION generate_semantic_cache_key(
  p_query_text TEXT,
  p_context_hash TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_normalized_query TEXT;
  v_hash TEXT;
BEGIN
  -- Normalize the query text (lowercase, trim whitespace)
  v_normalized_query := lower(trim(p_query_text));
  
  -- Generate a hash based on the query and context
  v_hash := encode(sha256((v_normalized_query || p_context_hash)::bytea), 'hex');
  
  RETURN 'ai_' || v_hash;
END;
$$;

-- Function to cache an AI response
CREATE OR REPLACE FUNCTION cache_ai_response(
  p_cache_key TEXT,
  p_query_text TEXT,
  p_response_text TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ai_response_cache (
    cache_key,
    query_text,
    response_text,
    metadata,
    expires_at,
    created_at
  ) VALUES (
    p_cache_key,
    p_query_text,
    p_response_text,
    p_metadata,
    COALESCE(p_expires_at, now() + interval '1 hour'),
    now()
  )
  ON CONFLICT (cache_key) 
  DO UPDATE SET
    response_text = EXCLUDED.response_text,
    metadata = EXCLUDED.metadata,
    expires_at = EXCLUDED.expires_at,
    hit_count = ai_response_cache.hit_count + 1,
    last_hit_at = now(),
    updated_at = now();
END;
$$;

-- Function to get a cached AI response
CREATE OR REPLACE FUNCTION get_cached_ai_response(
  p_cache_key TEXT
) RETURNS TABLE (
  cache_key TEXT,
  query_text TEXT,
  response_text TEXT,
  metadata JSONB,
  hit_count INTEGER,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE ai_response_cache
  SET 
    hit_count = hit_count + 1,
    last_hit_at = now()
  WHERE 
    cache_key = p_cache_key
    AND expires_at > now()
  RETURNING 
    cache_key,
    query_text,
    response_text,
    metadata,
    hit_count,
    expires_at;
END;
$$;

-- Function to get AI cache metrics
CREATE OR REPLACE FUNCTION get_ai_cache_metrics()
RETURNS TABLE (
  total_entries INTEGER,
  valid_entries INTEGER,
  expired_entries INTEGER,
  hit_rate NUMERIC,
  average_response_time NUMERIC,
  cache_size_mb NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total INTEGER;
  v_valid INTEGER;
  v_expired INTEGER;
  v_hit_rate NUMERIC;
  v_avg_response_time NUMERIC;
  v_cache_size_mb NUMERIC;
BEGIN
  -- Count entries
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE expires_at > now()),
    COUNT(*) FILTER (WHERE expires_at <= now())
  INTO v_total, v_valid, v_expired
  FROM ai_response_cache;
  
  -- Calculate hit rate (if metadata contains response_time)
  SELECT 
    COALESCE(AVG((metadata->>'responseTime')::numeric), 0)
  INTO v_avg_response_time
  FROM ai_response_cache
  WHERE metadata ? 'responseTime';
  
  -- Calculate hit rate
  SELECT 
    CASE 
      WHEN SUM(hit_count) > 0 THEN 
        SUM(hit_count)::numeric / (SUM(hit_count) + COUNT(*))::numeric
      ELSE 0
    END
  INTO v_hit_rate
  FROM ai_response_cache;
  
  -- Estimate cache size
  SELECT 
    COALESCE(SUM(
      pg_column_size(response_text) + 
      pg_column_size(query_text) + 
      pg_column_size(metadata)
    ) / (1024 * 1024.0), 0)
  INTO v_cache_size_mb
  FROM ai_response_cache;
  
  RETURN QUERY SELECT 
    v_total,
    v_valid,
    v_expired,
    v_hit_rate,
    v_avg_response_time,
    v_cache_size_mb;
END;
$$;

-- Function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_ai_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM ai_response_cache
  WHERE expires_at <= now()
  RETURNING COUNT(*) INTO v_deleted_count;
  
  RETURN v_deleted_count;
END;
$$;

-- Function to get recent chat history
CREATE OR REPLACE FUNCTION get_recent_chat_history(
  p_conversation_id UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  role TEXT,
  content TEXT,
  context JSONB,
  action_type TEXT,
  action_data JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ch.id,
    ch.role,
    ch.content,
    ch.context,
    ch.action_type,
    ch.action_data,
    ch.created_at
  FROM chat_history ch
  WHERE ch.conversation_id = p_conversation_id
  ORDER BY ch.created_at DESC
  LIMIT p_limit;
END;
$$;