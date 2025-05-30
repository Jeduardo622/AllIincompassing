/*
  # Fix AI Function Concurrent Indexes

  1. Changes
    - Move all CREATE INDEX CONCURRENTLY statements from Phase 4 AI functions
    - Ensure indexes are created outside transaction blocks
    - Keep the same index names and definitions
    
  2. Security
    - Maintain existing RLS policies
*/

-- Indexes for AI response cache performance
CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_response_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON ai_response_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_response_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_created ON ai_response_cache(created_at);