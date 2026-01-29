BEGIN;

UPDATE public.therapists
SET status = lower(status)
WHERE status IS NOT NULL;

UPDATE public.therapists
SET status = 'inactive'
WHERE status IS NULL
   OR status = ''
   OR status NOT IN ('active', 'inactive');

ALTER TABLE public.therapists
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.therapists
  ADD CONSTRAINT therapists_status_check
  CHECK (status IN ('active', 'inactive'));

COMMIT;
