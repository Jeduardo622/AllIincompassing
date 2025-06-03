/*
  # Create AI Response Cache Table

  1. New Tables
    - `ai_response_cache` - Stores cached AI responses for performance optimization
      - `id` (uuid, primary key)
      - `cache_key` (text, unique)
      - `query_text` (text)
      - `response_text` (text)
      - `metadata` (jsonb)
      - `query_hash` (text)
      - `hit_count` (integer)
      - `expires_at` (timestamptz)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `last_hit_at` (timestamptz)
  
  2. Indexes
    - Add indexes for efficient cache lookups
*/

-- Create ai_response_cache table
CREATE TABLE IF NOT EXISTS ai_response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  query_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  query_hash TEXT GENERATED ALWAYS AS (encode(sha256(query_text::bytea), 'hex')) STORED,
  hit_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_hit_at TIMESTAMPTZ
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_response_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON ai_response_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_response_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_created ON ai_response_cache(created_at);

-- Disable RLS for this table as it's an internal system table
ALTER TABLE ai_response_cache DISABLE ROW LEVEL SECURITY;