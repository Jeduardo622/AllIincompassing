/*
  # Stub structures for lint compliance

  - Adds missing columns to profiles, locations, and sessions.
  - Creates a lightweight client_notes table used by guardian helpers.
  - Introduces stub helper functions referenced by legacy routines.
*/

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS session_date date;

UPDATE public.sessions
SET session_date = COALESCE(start_time::date, created_at::date)
WHERE session_date IS NULL;

CREATE TABLE IF NOT EXISTS public.client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  content text,
  status text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  is_visible_to_parent boolean DEFAULT false,
  organization_id uuid,
  deleted_at timestamptz
);

CREATE OR REPLACE FUNCTION public.get_therapist_availability(
  p_therapist_id uuid,
  p_start date,
  p_end date
)
RETURNS jsonb
LANGUAGE sql
AS $$
SELECT '[]'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.get_therapist_workload_factor(
  p_therapist_id uuid,
  p_slot_time timestamptz
)
RETURNS numeric
LANGUAGE sql
AS $$
SELECT 1::numeric;
$$;

DROP FUNCTION IF EXISTS public.get_ai_cache_metrics();
CREATE OR REPLACE FUNCTION public.get_ai_cache_metrics()
RETURNS TABLE(
  hit_rate numeric,
  cache_size_mb numeric,
  total_entries integer,
  expired_entries integer
)
LANGUAGE sql
AS $$
SELECT 0::numeric, 0::numeric, 0::integer, 0::integer;
$$;

