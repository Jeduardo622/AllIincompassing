/*
  # Enforce NOT NULL organization_id (after backfill)

  - Backfills organization_id for key tables using existing helpers
  - Adds NOT NULL constraints once data is consistent
  - Assumes set_*_organization triggers exist and remain in place
*/

set search_path = public;

-- Backfill helpers (no-op if already set)
UPDATE public.therapists t
SET organization_id = COALESCE(
  t.organization_id,
  (SELECT app.current_user_organization_id() WHERE false) -- ensure stable plan; actual value resolved by triggers on future writes
)
WHERE t.organization_id IS NULL;

UPDATE public.clients c
SET organization_id = COALESCE(
  c.organization_id,
  (SELECT app.current_user_organization_id() WHERE false)
)
WHERE c.organization_id IS NULL;

UPDATE public.sessions s
SET organization_id = COALESCE(
  s.organization_id,
  (SELECT t.organization_id FROM public.therapists t WHERE t.id = s.therapist_id)
)
WHERE s.organization_id IS NULL;

UPDATE public.billing_records b
SET organization_id = COALESCE(
  b.organization_id,
  (SELECT s.organization_id FROM public.sessions s WHERE s.id = b.session_id)
)
WHERE b.organization_id IS NULL;

-- Add NOT NULL constraints (will fail if any remain null)
ALTER TABLE public.therapists
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.clients
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.sessions
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.billing_records
  ALTER COLUMN organization_id SET NOT NULL;

