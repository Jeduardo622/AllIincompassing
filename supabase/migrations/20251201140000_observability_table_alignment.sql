/*
  # Observability Tables Alignment

  1. Changes
    - Ensure ai_performance_metrics supports all columns referenced by logging functions.
    - Ensure db_performance_metrics has the columns used by logging utilities.

  2. Security
    - No RLS/policy changes. Only schema alterations in the public schema.
*/

DO $$
BEGIN
  -- ai_performance_metrics adjustments
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ai_performance_metrics'
  ) THEN
    ALTER TABLE public.ai_performance_metrics
      ADD COLUMN IF NOT EXISTS function_name text,
      ADD COLUMN IF NOT EXISTS parameters jsonb DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS token_count integer,
      ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;

  -- db_performance_metrics adjustments
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'db_performance_metrics'
  ) THEN
    ALTER TABLE public.db_performance_metrics
      ADD COLUMN IF NOT EXISTS query_name text,
      ADD COLUMN IF NOT EXISTS query_text text,
      ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

