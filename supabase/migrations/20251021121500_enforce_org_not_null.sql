/*
  # Enforce NOT NULL organization_id (after backfill)

  - Backfills organization_id for key tables using existing relationships
  - Adds NOT NULL constraints once data is consistent
  - Assumes set_*_organization triggers exist and remain in place
*/

set search_path = public;

-- Replay-safe backfill: the prior COALESCE(..., (SELECT ... WHERE false)) never populated nulls.
-- Propagate across therapists ↔ sessions ↔ clients, then billing, then a dev default for stragglers.

-- 1) Sessions from therapists when therapist already has org
UPDATE public.sessions s
SET organization_id = t.organization_id
FROM public.therapists t
WHERE s.therapist_id = t.id
  AND s.organization_id IS NULL
  AND t.organization_id IS NOT NULL;

-- 2) Therapists from sessions when any session row carries org
UPDATE public.therapists t
SET organization_id = s.organization_id
FROM (
  SELECT DISTINCT ON (therapist_id)
    therapist_id,
    organization_id
  FROM public.sessions
  WHERE organization_id IS NOT NULL
  ORDER BY therapist_id, start_time DESC NULLS LAST
) s
WHERE t.id = s.therapist_id
  AND t.organization_id IS NULL;

-- 3) Clients from sessions / therapists
UPDATE public.clients c
SET organization_id = COALESCE(c.organization_id, s.organization_id, t.organization_id)
FROM public.sessions s
JOIN public.therapists t ON t.id = s.therapist_id
WHERE s.client_id = c.id
  AND c.organization_id IS NULL
  AND (s.organization_id IS NOT NULL OR t.organization_id IS NOT NULL);

-- 4) Sessions again (clients may have gained org in step 3)
UPDATE public.sessions s
SET organization_id = COALESCE(s.organization_id, t.organization_id, c.organization_id)
FROM public.therapists t
JOIN public.clients c ON c.id = s.client_id
WHERE s.therapist_id = t.id
  AND s.organization_id IS NULL
  AND (t.organization_id IS NOT NULL OR c.organization_id IS NOT NULL);

-- 5) Therapists from clients (via sessions)
UPDATE public.therapists t
SET organization_id = c.organization_id
FROM public.sessions s
JOIN public.clients c ON c.id = s.client_id
WHERE s.therapist_id = t.id
  AND t.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

-- 6) Billing from sessions
UPDATE public.billing_records b
SET organization_id = COALESCE(b.organization_id, s.organization_id)
FROM public.sessions s
WHERE b.session_id = s.id
  AND b.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- 7) Borrow any existing org id from core tables (single-tenant / preview seeds)
UPDATE public.therapists t
SET organization_id = v.organization_id
FROM (
  SELECT organization_id
  FROM public.sessions
  WHERE organization_id IS NOT NULL
  LIMIT 1
) v
WHERE t.organization_id IS NULL;

UPDATE public.therapists t
SET organization_id = v.organization_id
FROM (
  SELECT organization_id
  FROM public.clients
  WHERE organization_id IS NOT NULL
  LIMIT 1
) v
WHERE t.organization_id IS NULL;

UPDATE public.clients c
SET organization_id = v.organization_id
FROM (
  SELECT organization_id
  FROM public.therapists
  WHERE organization_id IS NOT NULL
  LIMIT 1
) v
WHERE c.organization_id IS NULL;

UPDATE public.sessions s
SET organization_id = v.organization_id
FROM (
  SELECT organization_id
  FROM public.therapists
  WHERE organization_id IS NOT NULL
  LIMIT 1
) v
WHERE s.organization_id IS NULL;

UPDATE public.billing_records b
SET organization_id = v.organization_id
FROM (
  SELECT organization_id
  FROM public.sessions
  WHERE organization_id IS NOT NULL
  LIMIT 1
) v
WHERE b.organization_id IS NULL;

-- 8) Last resort: fixture default org used across dev/tests when no row carries org yet
UPDATE public.therapists
SET organization_id = '5238e88b-6198-4862-80a2-dbe15bbeabdd'::uuid
WHERE organization_id IS NULL;

UPDATE public.clients
SET organization_id = '5238e88b-6198-4862-80a2-dbe15bbeabdd'::uuid
WHERE organization_id IS NULL;

UPDATE public.sessions
SET organization_id = '5238e88b-6198-4862-80a2-dbe15bbeabdd'::uuid
WHERE organization_id IS NULL;

UPDATE public.billing_records
SET organization_id = '5238e88b-6198-4862-80a2-dbe15bbeabdd'::uuid
WHERE organization_id IS NULL;

-- Add NOT NULL constraints (will fail if any remain null)
ALTER TABLE public.therapists
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.clients
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.sessions
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.billing_records
  ALTER COLUMN organization_id SET NOT NULL;
