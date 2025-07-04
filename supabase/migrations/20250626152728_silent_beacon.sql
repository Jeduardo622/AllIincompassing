/*
  # Add essential API functions

  1. New Functions
    - `get_recent_chat_history` - Retrieves recent chat messages by conversation ID
    - `generate_semantic_cache_key` - Creates consistent cache keys for AI queries
    - `get_cached_ai_response` - Retrieves cached AI responses
    - `cache_ai_response` - Stores AI responses in cache
    - `update_updated_at_column` - Trigger function to update timestamps

  2. Changes
    - Preserves existing `validate_time_interval` function
    - Grants proper permissions to authenticated users
*/

-- Drop existing functions first to avoid return type change errors
DROP FUNCTION IF EXISTS get_recent_chat_history(uuid, integer);
DROP FUNCTION IF EXISTS get_recent_chat_history(text, integer);
DROP FUNCTION IF EXISTS generate_semantic_cache_key(text, text);
DROP FUNCTION IF EXISTS get_cached_ai_response(text);
DROP FUNCTION IF EXISTS cache_ai_response(text, text, text, jsonb, timestamptz);

-- Function to get recent chat history
CREATE FUNCTION get_recent_chat_history(
  p_conversation_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  role text,
  content text,
  context jsonb,
  action_type text,
  action_data jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ch.id,
    ch.conversation_id,
    ch.role,
    ch.content,
    ch.context,
    ch.action_type,
    ch.action_data,
    ch.created_at
  FROM 
    chat_history ch
  WHERE 
    ch.conversation_id = p_conversation_id
  ORDER BY 
    ch.created_at DESC
  LIMIT 
    p_limit;
END;
$$;

-- Overloaded version with text input
CREATE FUNCTION get_recent_chat_history(
  p_conversation_id text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  role text,
  content text,
  context jsonb,
  action_type text,
  action_data jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ch.id,
    ch.conversation_id,
    ch.role,
    ch.content,
    ch.context,
    ch.action_type,
    ch.action_data,
    ch.created_at
  FROM 
    chat_history ch
  WHERE 
    ch.conversation_id = p_conversation_id::uuid
  ORDER BY 
    ch.created_at DESC
  LIMIT 
    p_limit;
END;
$$;

-- Function to generate semantic cache key
CREATE OR REPLACE FUNCTION generate_semantic_cache_key(
  p_query_text text,
  p_context_hash text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_normalized_query text;
  v_query_hash text;
  v_cache_key text;
BEGIN
  -- Normalize query: lowercase, trim whitespace, remove excess spaces
  v_normalized_query := lower(regexp_replace(trim(p_query_text), '\s+', ' ', 'g'));
  
  -- Generate hash from normalized query
  v_query_hash := encode(sha256(v_normalized_query::bytea), 'hex');
  
  -- Combine with context if provided
  IF p_context_hash IS NOT NULL THEN
    v_cache_key := 'ai_' || v_query_hash || '_' || encode(sha256(p_context_hash::bytea), 'hex');
  ELSE
    v_cache_key := 'ai_' || v_query_hash;
  END IF;
  
  RETURN v_cache_key;
END;
$$;

-- Drop existing function if needed
DROP FUNCTION IF EXISTS get_cached_ai_response(text);

-- Function to get cached AI response
CREATE FUNCTION get_cached_ai_response(
  p_cache_key text
)
RETURNS TABLE (
  response_text text,
  metadata jsonb
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
  RETURNING response_text, metadata;
END;
$$;

-- Function to cache AI response
CREATE OR REPLACE FUNCTION cache_ai_response(
  p_cache_key text,
  p_query_text text,
  p_response_text text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
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
    query_hash,
    metadata,
    expires_at
  ) VALUES (
    p_cache_key,
    p_query_text,
    p_response_text,
    encode(sha256(p_query_text::bytea), 'hex'),
    p_metadata,
    COALESCE(p_expires_at, now() + interval '1 hour')
  )
  ON CONFLICT (cache_key) 
  DO UPDATE SET
    response_text = EXCLUDED.response_text,
    metadata = EXCLUDED.metadata,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();
END;
$$;

-- Create or replace the update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Grant permissions to authenticated users
DO $$
BEGIN
  -- Only grant if the role exists (to avoid errors)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION get_recent_chat_history(uuid, integer) TO authenticated;
    GRANT EXECUTE ON FUNCTION get_recent_chat_history(text, integer) TO authenticated;
    GRANT EXECUTE ON FUNCTION generate_semantic_cache_key(text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION get_cached_ai_response(text) TO authenticated;
    GRANT EXECUTE ON FUNCTION cache_ai_response(text, text, text, jsonb, timestamptz) TO authenticated;
    GRANT EXECUTE ON FUNCTION update_updated_at_column() TO authenticated;
  END IF;
END;
$$;