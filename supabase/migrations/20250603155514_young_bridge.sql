/*
  # Create Function Performance Logs Table

  1. New Tables
    - `function_performance_logs` - Tracks performance of database functions
      - `id` (uuid, primary key)
      - `function_name` (text)
      - `execution_time_ms` (double precision)
      - `parameters` (jsonb)
      - `result_size` (integer)
      - `executed_by` (uuid)
      - `executed_at` (timestamptz)
  
  2. Indexes
    - Add indexes for efficient lookups
*/

-- Create function_performance_logs table
CREATE TABLE IF NOT EXISTS function_performance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  execution_time_ms DOUBLE PRECISION NOT NULL,
  parameters JSONB,
  result_size INTEGER,
  executed_by UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_function_performance_logs_function_name ON function_performance_logs(function_name);
CREATE INDEX IF NOT EXISTS idx_function_performance_logs_executed_at ON function_performance_logs(executed_at);

-- Disable RLS for this table as it's an internal system table
ALTER TABLE function_performance_logs DISABLE ROW LEVEL SECURITY;