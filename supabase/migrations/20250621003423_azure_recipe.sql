-- # Improve conversation handling
--
-- 1. New Tables
--   - None (using existing tables)
-- 2. Security
--   - No changes to security policies
-- 3. Changes
--   - Added get_recent_chat_history function
--   - Improved chat message retention

-- Function to get recent chat history for a conversation
CREATE OR REPLACE FUNCTION get_recent_chat_history(
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

-- Create another function with different signature in case it's used in the code
CREATE OR REPLACE FUNCTION get_recent_chat_history(
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

-- Ensure proper permissions
GRANT EXECUTE ON FUNCTION get_recent_chat_history(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_chat_history(text, integer) TO authenticated;