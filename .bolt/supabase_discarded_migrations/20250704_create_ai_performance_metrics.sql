-- Create ai_performance_metrics table if missing
CREATE TABLE IF NOT EXISTS public.ai_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz NOT NULL DEFAULT now(),
  metric_name text NOT NULL,
  metric_value numeric,
  cache_hit boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_metrics_timestamp ON public.ai_performance_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_metrics_cache_hit ON public.ai_performance_metrics(cache_hit, timestamp); 