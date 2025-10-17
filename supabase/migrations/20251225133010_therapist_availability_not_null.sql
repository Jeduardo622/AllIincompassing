/*
  # Enforce organization scoping on therapist availability

  1. Data backfill
    - Populate any lingering null organization_id values from parent therapists.
  2. Constraint hardening
    - Require organization_id going forward now that the trigger is in place.
*/

-- 1. Data backfill
UPDATE public.therapist_availability AS ta
SET organization_id = t.organization_id
FROM public.therapists AS t
WHERE ta.organization_id IS NULL
  AND t.id = ta.therapist_id
  AND t.organization_id IS NOT NULL;

-- 2. Constraint hardening
ALTER TABLE public.therapist_availability
  ALTER COLUMN organization_id SET NOT NULL;
